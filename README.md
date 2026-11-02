# 三喵健康簿 · 固定双账号版 V1.1.0

基于 Cloudflare Workers + Static Assets + D1 的家庭猫咪健康管理应用。

- GitHub：`fryjin/mycat`
- Worker：`mycat`
- D1：`mycat-db`
- 固定登录身份：`炮台`、`芋头`
- 两个身份共享同一个家庭空间及三只猫的健康数据
- 登录会话：30 天；每次成功登录都会重新签发一份完整 30 天有效期的会话

## 本次更新

### 固定双账号登录
- 登录页仅保留「炮台」和「芋头」两个身份。
- 两个身份使用同一个家庭登录密钥 `MYCAT_LOGIN_KEY`。
- 登录密钥仅配置在 Cloudflare Worker Secret 中，不写入前端、不提交到 GitHub，也不包含在本 ZIP。
- 后端验证身份选项及家庭密钥，成功后签发 HttpOnly、Secure、SameSite=Lax Cookie。
- 每次成功登录都会新建 30 天会话；过期会话在登录时清理。
- 自助注册、邀请码加入和邀请码生成入口已关闭。
- 两个身份共享同一家庭空间；提醒偏好仍按登录身份分别保存。

### 猫咪名称可修改
- 进入「宠物」→ 选择猫咪 →「修改资料」→ 编辑「小猫名称」。
- 保存后同步更新猫咪档案和云端家庭数据，并写入资料变化历史。
- 首页筛选、日历、健康记录、待办等位置均使用档案当前名称。

### 横幅图片构图
- 登录页桌面端将横幅图的裁切焦点右移（86%），尽量完整呈现右侧三只猫。
- 登录页移动端使用右对齐。
- 首页横幅在移动端也改为右对齐，避免第三只猫被裁切。
- 桌面端和移动端使用同一张 `hero-spring-picnic.png`，只调整响应式裁切位置，不再叠加第二张猫图。

### D1 数据库
- `0001_init.sql`：基础表结构。
- `0002_fixed_accounts.sql`：初始化固定双账号、共享家庭空间、独立提醒偏好和三只猫的初始档案。
- `npm run deploy` 会先执行远程 D1 migration，再部署 Worker。

## 目录结构

```text
mycat/
├── migrations/
│   ├── 0001_init.sql
│   └── 0002_fixed_accounts.sql
├── public/
│   ├── index.html
│   ├── manifest.webmanifest
│   └── assets/
│       ├── app.css
│       ├── app.js
│       ├── hero-spring-picnic.png
│       ├── pet-blue.webp
│       ├── pet-silver.webp
│       ├── pet-tux.webp
│       └── app-icon.svg
├── src/index.js
├── scripts/
├── package.json
├── wrangler.toml
└── README.md
```

## 上传 GitHub

1. 解压 ZIP。
2. 将 ZIP 内的文件和文件夹直接放到 `fryjin/mycat` 仓库根目录，不要再套一层项目文件夹。
3. 提交到 `main` 分支。

本包已填写现有 D1 ID，不要重新创建数据库：

```toml
[[d1_databases]]
binding = "DB"
database_name = "mycat-db"
database_id = "170dfaf6-ab79-4268-a103-90971940d4f5"
migrations_dir = "migrations"
```

## Cloudflare Workers 网页端配置

### 1. 确认 Git 部署配置

Cloudflare Dashboard → Workers & Pages → `mycat` → Settings → Builds：

| 配置 | 值 |
|---|---|
| GitHub 仓库 | `fryjin/mycat` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | 留空 / None |
| Deploy command | `npm run deploy` |

`npm run deploy` 会依次执行：

```bash
npm run db:migrate:remote
wrangler deploy
```

每次部署先应用尚未执行的 migration，再部署 Worker 和静态资源。D1 migration 会记录执行状态，不会重复应用已完成的 migration。

### 2. 设置家庭登录密钥（必须）

在 Cloudflare Dashboard：

1. 打开 **Workers & Pages → mycat**。
2. 进入 **Settings → Variables and Secrets**。
3. 新增一项，类型选择 **Secret**（不要选普通明文变量）。
4. 名称填写 `MYCAT_LOGIN_KEY`。
5. 值填写单独提供给你的随机长密钥。
6. 保存后触发一次新的部署，让 Worker 运行时读取该 Secret。

**安全要求：**
- 不要把密钥放进 `wrangler.toml`、`app.js`、README、GitHub 或 ZIP。
- 炮台和芋头登录时选择各自身份，并输入同一个家庭登录密钥。
- 如果怀疑密钥泄露，在 Cloudflare Secret 中更换并重新部署；更换后旧密钥无法再登录，但已签发的 30 天会话仍会持续有效，若要立即撤销所有会话，需要另行清理 `sessions` 表。

### 3. D1 migration

现有 D1 已经创建并执行过 `0001_init.sql`。本次新增 `0002_fixed_accounts.sql`，下一次 Cloudflare Git 部署时由 `npm run deploy` 自动应用。

部署成功后，在 D1 → `mycat-db` → Console 执行：

```sql
SELECT name FROM sqlite_master
WHERE type = 'table'
ORDER BY name;
```

再检查固定账号：

```sql
SELECT id, name
FROM users
WHERE id IN ('mycat-user-paotai', 'mycat-user-yutou')
ORDER BY id;
```

检查三只猫：

```sql
SELECT id, name, breed
FROM pets
WHERE family_id = 'mycat-family-fixed'
ORDER BY id;
```

应看到两个固定账号和三只初始猫咪档案。不会自动插入虚构的体重、驱虫、疫苗或就诊记录。

## 本地开发（可选）

需要本地运行时：

```bash
npm install
```

复制 `.dev.vars.example` 为 `.dev.vars`，填入本地开发密钥：

```dotenv
MYCAT_LOGIN_KEY="your-local-long-random-key"
```

然后运行：

```bash
npm run dev
```

`.dev.vars` 已加入 `.gitignore`，不要提交。

## 当前功能边界

- 30 天登录会话、固定双账号和家庭数据共享已实现。
- 猫咪名称修改已支持，并会保存到 D1。
- 通知设置目前保存用户偏好；真实 Web Push、邮件发送和定时提醒尚未接入。
- R2 附件上传需要额外创建 Bucket 并启用 `wrangler.toml` 中的 R2 绑定。
- 当前没有邮箱验证码、密码找回和 MFA。请将家庭登录密钥仅分享给可信家庭成员。
- `0002_fixed_accounts.sql` 会建立一个新的固定家庭空间，不会删除旧用户或旧家庭数据；如果之前已在旧账号中录入真实数据，需要另行迁移，不要手动删除旧数据。

本应用用于宠物健康信息记录，不提供兽医诊断或治疗建议。
