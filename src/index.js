const SESSION_COOKIE = "mycat_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const FIXED_LOGIN_ACCOUNTS = Object.freeze({
  paotai: { id: "mycat-user-paotai", name: "炮台" },
  yutou: { id: "mycat-user-yutou", name: "芋头" },
});
const encoder = new TextEncoder();

const DEFAULT_PREFERENCES = {
  push: true,
  email: false,
  internal: true,
  dual: false,
  quiet: true,
  quietFrom: "22:00",
  quietTo: "08:00",
  mail: "",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

function randomToken(size = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
}

function cookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

async function readJson(request, maxBytes = 2_000_000) {
  const raw = await request.text();
  if (encoder.encode(raw).length > maxBytes) throw new Error("请求内容过大，请减少附件或拆分操作");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new Error("请求格式不是有效 JSON");
  }
}

function validateOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function createSession(env, userId) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(uuid(), userId, tokenHash, expiresAt, createdAt).run();
  return token;
}

async function getSession(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT s.id AS session_id, s.user_id, u.email, u.name,
           fm.family_id, fm.role, f.name AS family_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN family_members fm ON fm.user_id = u.id
    JOIN families f ON f.id = fm.family_id
    WHERE s.token_hash = ? AND s.expires_at > ?
    LIMIT 1
  `).bind(tokenHash, nowIso()).first();
  return row || null;
}

async function requireSession(request, env) {
  const session = await getSession(request, env);
  return session;
}

async function login(request, env) {
  const body = await readJson(request, 20_000);
  const accountKey = String(body.account || "");
  const account = FIXED_LOGIN_ACCOUNTS[accountKey];
  const loginKey = String(body.loginKey || "");
  const configuredKey = String(env.MYCAT_LOGIN_KEY || "");

  if (!configuredKey) {
    return error("服务器尚未配置 MYCAT_LOGIN_KEY，请在 Cloudflare Worker 的 Variables and Secrets 中添加密钥", 503);
  }
  if (!account || !loginKey || loginKey.length > 256 || !constantTimeEqual(loginKey, configuredKey)) {
    return error("登录身份或家庭登录密钥不正确", 401);
  }

  const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(account.id).first();
  if (!user) {
    return error("固定账号尚未初始化，请确认已部署 0002_fixed_accounts.sql 数据库迁移", 503);
  }

  // Each successful login creates a fresh 30-day session. Expired sessions are cleaned up.
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(nowIso()).run();
  const token = await createSession(env, user.id);
  return json({ ok: true, expiresIn: SESSION_TTL_SECONDS }, 200, { "Set-Cookie": sessionCookie(token) });
}
async function logout(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) {
    const tokenHash = await sha256(token);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

async function me(request, env) {
  const session = await requireSession(request, env);
  if (!session) return error("请先登录", 401);
  const memberCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM family_members WHERE family_id = ?")
    .bind(session.family_id).first();
  return json({
    user: { id: session.user_id, name: session.name },
    family: { id: session.family_id, name: session.family_name, role: session.role, memberCount: Number(memberCount?.total || 0) },
  });
}

async function getState(session, env) {
  const familyId = session.family_id;
  const [petRows, recordRows, taskRows, changeRows, prefRow, revisionRow, memberRows] = await Promise.all([
    env.DB.prepare("SELECT data_json FROM pets WHERE family_id = ? ORDER BY created_at ASC").bind(familyId).all(),
    env.DB.prepare("SELECT data_json FROM health_records WHERE family_id = ? ORDER BY date DESC, created_at DESC").bind(familyId).all(),
    env.DB.prepare("SELECT data_json FROM care_tasks WHERE family_id = ? ORDER BY date ASC, created_at ASC").bind(familyId).all(),
    env.DB.prepare("SELECT data_json FROM pet_profile_changes WHERE family_id = ? ORDER BY created_at DESC").bind(familyId).all(),
    env.DB.prepare("SELECT settings_json FROM user_preferences WHERE user_id = ?").bind(session.user_id).first(),
    env.DB.prepare("SELECT revision FROM family_state WHERE family_id = ?").bind(familyId).first(),
    env.DB.prepare(`SELECT u.id, u.name, u.email, fm.role
      FROM family_members fm JOIN users u ON u.id = fm.user_id
      WHERE fm.family_id = ? ORDER BY CASE fm.role WHEN 'owner' THEN 0 ELSE 1 END, fm.joined_at ASC`)
      .bind(familyId).all(),
  ]);
  const parseRows = (rows) => (rows?.results || []).map((row) => {
    try { return JSON.parse(row.data_json); } catch { return {}; }
  });
  const members = (memberRows?.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role === "owner" ? "管理员" : "编辑者",
  }));
  let settings = DEFAULT_PREFERENCES;
  try { if (prefRow?.settings_json) settings = { ...DEFAULT_PREFERENCES, ...JSON.parse(prefRow.settings_json) }; } catch { /* keep defaults */ }
  return json({
    revision: Number(revisionRow?.revision || 0),
    state: {
      version: 6,
      demo: false,
      pets: parseRows(petRows),
      records: parseRows(recordRows),
      tasks: parseRows(taskRows),
      changes: parseRows(changeRows),
      settings,
      members,
    },
  });
}

function validateSharedState(state) {
  if (!state || !Array.isArray(state.pets) || !Array.isArray(state.records) || !Array.isArray(state.tasks) || !Array.isArray(state.changes)) {
    return "数据结构不完整，请重新载入页面";
  }
  if (state.pets.length < 1) return "至少需要保留一只小猫档案";
  if (state.pets.length > 30 || state.records.length > 10_000 || state.tasks.length > 10_000 || state.changes.length > 10_000) {
    return "记录数量超出当前版本的安全限制";
  }
  const ids = new Set();
  for (const pet of state.pets) {
    if (!pet?.id || ids.has(String(pet.id))) return "猫咪档案存在重复或缺失的 ID";
    ids.add(String(pet.id));
    if (typeof pet.photo === "string" && pet.photo.startsWith("data:")) return "检测到旧版本地头像，请重新上传头像后再同步";
  }
  for (const [label, items] of [["健康记录", state.records], ["护理待办", state.tasks], ["资料变更", state.changes]]) {
    const seen = new Set();
    for (const item of items) {
      if (!item?.id || seen.has(String(item.id))) return `${label}存在重复或缺失的 ID`;
      seen.add(String(item.id));
      if (!ids.has(String(item.petId))) return `${label}关联的猫咪不存在，请检查数据`;
    }
  }
  return "";
}

async function putState(request, session, env) {
  const body = await readJson(request, 4_000_000);
  const revision = Number(body.revision);
  if (!Number.isInteger(revision) || revision < 0) return error("云端版本号无效，请刷新页面", 400);
  const state = body.state;
  const validationError = validateSharedState(state);
  if (validationError) return error(validationError, 400);
  const familyId = session.family_id;
  const now = nowIso();
  const nonce = uuid();
  const guard = "EXISTS (SELECT 1 FROM family_state WHERE family_id = ? AND sync_nonce = ?)";
  const statements = [
    env.DB.prepare("UPDATE family_state SET revision = revision + 1, sync_nonce = ?, updated_at = ? WHERE family_id = ? AND revision = ?")
      .bind(nonce, now, familyId, revision),
    env.DB.prepare(`DELETE FROM health_records WHERE family_id = ? AND ${guard}`).bind(familyId, familyId, nonce),
    env.DB.prepare(`DELETE FROM care_tasks WHERE family_id = ? AND ${guard}`).bind(familyId, familyId, nonce),
    env.DB.prepare(`DELETE FROM pet_profile_changes WHERE family_id = ? AND ${guard}`).bind(familyId, familyId, nonce),
    env.DB.prepare(`DELETE FROM pets WHERE family_id = ? AND ${guard}`).bind(familyId, familyId, nonce),
    env.DB.prepare(`INSERT INTO pets (id, family_id, name, breed, tone, data_json, created_at, updated_at)
      SELECT json_extract(value, '$.id'), ?, COALESCE(json_extract(value, '$.name'), ''),
        COALESCE(json_extract(value, '$.breed'), ''), COALESCE(json_extract(value, '$.tone'), 'blue'),
        value, COALESCE(json_extract(value, '$.createdAt'), ?), ? FROM json_each(?) WHERE ${guard}`)
      .bind(familyId, now, now, JSON.stringify(state.pets), familyId, nonce),
    env.DB.prepare(`INSERT INTO health_records (id, family_id, pet_id, type, date, data_json, created_at)
      SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.petId'),
        COALESCE(json_extract(value, '$.type'), ''), COALESCE(json_extract(value, '$.date'), ''),
        value, COALESCE(json_extract(value, '$.createdAt'), ?)
      FROM json_each(?) WHERE ${guard}`)
      .bind(familyId, now, JSON.stringify(state.records), familyId, nonce),
    env.DB.prepare(`INSERT INTO care_tasks (id, family_id, pet_id, type, date, status, priority, data_json, created_at)
      SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.petId'),
        COALESCE(json_extract(value, '$.type'), ''), COALESCE(json_extract(value, '$.date'), ''),
        COALESCE(json_extract(value, '$.status'), 'pending'), COALESCE(json_extract(value, '$.priority'), 'normal'),
        value, COALESCE(json_extract(value, '$.createdAt'), ?)
      FROM json_each(?) WHERE ${guard}`)
      .bind(familyId, now, JSON.stringify(state.tasks), familyId, nonce),
    env.DB.prepare(`INSERT INTO pet_profile_changes (id, family_id, pet_id, created_at, data_json)
      SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.petId'),
        COALESCE(json_extract(value, '$.at'), ?), value
      FROM json_each(?) WHERE ${guard}`)
      .bind(familyId, now, JSON.stringify(state.changes), familyId, nonce),
  ];
  const results = await env.DB.batch(statements);
  if (!results[0]?.meta?.changes) {
    const current = await env.DB.prepare("SELECT revision FROM family_state WHERE family_id = ?").bind(familyId).first();
    return json({ error: "家庭数据已在其他设备更新。为避免覆盖，请刷新后重试。", revision: Number(current?.revision || 0) }, 409);
  }
  return json({ ok: true, revision: revision + 1 });
}

async function putPreferences(request, session, env) {
  const body = await readJson(request, 20_000);
  const source = body.settings || {};
  const settings = {
    push: Boolean(source.push),
    email: Boolean(source.email),
    internal: source.internal !== false,
    dual: Boolean(source.dual),
    quiet: Boolean(source.quiet),
    quietFrom: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(source.quietFrom || "")) ? source.quietFrom : "22:00",
    quietTo: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(source.quietTo || "")) ? source.quietTo : "08:00",
    mail: String(source.mail || "").slice(0, 254),
  };
  await env.DB.prepare(`INSERT INTO user_preferences (user_id, settings_json, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`)
    .bind(session.user_id, JSON.stringify(settings), nowIso()).run();
  return json({ ok: true, settings });
}

async function uploadFile(request, session, env) {
  if (!env.FILES) return error("当前部署尚未配置 Cloudflare R2 附件桶；请按部署文档启用可选 R2 配置", 501);
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.stream !== "function") return error("没有收到文件");
  if (file.size > 10 * 1024 * 1024) return error("单个文件不能超过 10 MB", 413);
  const allowed = new Map([
    ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["application/pdf", "pdf"],
  ]);
  const extension = allowed.get(file.type);
  if (!extension) return error("仅支持 JPG、PNG、WebP 图片或 PDF 文件");
  const key = `${session.family_id}/${uuid()}.${extension}`;
  await env.FILES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: "private, no-store" },
    customMetadata: { familyId: session.family_id, uploadedBy: session.user_id, originalName: String(file.name || "file").slice(0, 180) },
  });
  return json({ key, url: `/api/files/${encodeURIComponent(key)}`, name: String(file.name || "file").slice(0, 180) }, 201);
}

async function getFile(request, session, env, key) {
  if (!env.FILES) return error("当前部署尚未配置 Cloudflare R2 附件桶", 501);
  if (!key.startsWith(`${session.family_id}/`)) return error("无权访问此附件", 403);
  const object = await env.FILES.get(key);
  if (!object) return error("附件不存在", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !validateOrigin(request)) return error("请求来源校验失败", 403);

  if (path === "/api/health" && method === "GET") {
    const row = await env.DB.prepare("SELECT 1 AS ok").first();
    return json({ ok: row?.ok === 1, service: "mycat-api", version: "1.1.2" });
  }
  if (path === "/api/auth/register" && method === "POST") return error("当前为固定双账号模式，不开放自助注册", 403);
  if (path === "/api/auth/login" && method === "POST") return login(request, env);
  if (path === "/api/auth/join" && method === "POST") return error("当前为固定双账号模式，不支持邀请码加入", 403);
  if (path === "/api/auth/logout" && method === "POST") return logout(request, env);

  const session = await requireSession(request, env);
  if (!session) return error("登录状态已失效，请重新登录", 401);
  if (path === "/api/me" && method === "GET") return me(request, env);
  if (path === "/api/state" && method === "GET") return getState(session, env);
  if (path === "/api/state" && method === "PUT") return putState(request, session, env);
  if (path === "/api/preferences" && method === "PUT") return putPreferences(request, session, env);
  if (path === "/api/invitations" && method === "POST") return error("当前为固定双账号模式，无需生成邀请码", 403);
  if (path === "/api/files" && method === "POST") return uploadFile(request, session, env);
  if (path.startsWith("/api/files/") && method === "GET") {
    let key = "";
    try { key = decodeURIComponent(path.slice("/api/files/".length)); } catch { return error("附件地址无效"); }
    return getFile(request, session, env, key);
  }
  return error("API 路径不存在", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env);
      } catch (err) {
        const message = String(err?.message || "服务器暂时不可用");
        if (message.includes("UNIQUE constraint failed: users.email")) return error("这个邮箱已经注册，请直接登录", 409);
        return error(message, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
