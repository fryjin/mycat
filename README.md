# 三喵健康簿 · Cloudflare D1 初始化版

这是基于现有 V1.0 交互原型整理的可部署 Web 项目。前端保留原有五个主要入口和交互流程，并接入 Cloudflare Worker API、D1 数据库与账号/家庭空间能力。

> GitHub 仓库 `fryjin/mycat` 在本次读取时为空。本项目仅在本地打包，不会自动写入 GitHub。

## 1. 当前版本包含什么

### 前端
- 首页：家庭健康日程、待办/历史已办、逾期与近期统计。
- 健康日历：按月查看护理计划和历史记录。
- 添加：新增已办记录、创建待办、按 1/3/6 个月或自定义日期生成下一次待办。
- 猫咪档案：基础资料、健康记录、体重趋势、资料变化历史。
- 系统设置：账号独立的提醒偏好、家庭成员、JSON 导入/导出。
- 新主视觉作为独立静态资源，桌面端与移动端共用响应式布局。

### 账号与家庭协作
- 邮箱 + 密码注册/登录。
- 首个账号创建家庭空间，并自动建立蓝猫、银点、奶牛猫三份空白档案；不会写入虚构的体重、驱虫、疫苗或就诊记录。
- 家庭最多两位账号。管理员生成一次性邀请码，第二位成员使用邀请码加入。
- 两位成员共享猫咪档案、健康记录、护理待办和资料变更历史。
- 通知偏好按账号分别保存。
- 登录态使用 HttpOnly、Secure、SameSite=Lax Cookie；密码使用 Web Crypto PBKDF2-SHA256 派生哈希，不保存明文密码。

### 数据层
- Cloudflare D1 保存用户、家庭、成员、会话、邀请码、猫咪档案、健康记录、护理待办、资料变更和用户偏好。
- 家庭共享数据使用 revision + sync nonce 做乐观并发控制，避免两台设备同时编辑时静默覆盖。
- JSON 导入/导出保留为人工备份入口。
- 可选 R2 私有桶用于头像、病历图片和 PDF；未启用 R2 时，核心档案与记录仍可使用。

## 2. 当前明确未接入的能力

以下功能不会被伪装成已完成：

1. **真实通知发送**：目前保存每个账号的推送/邮件偏好与免打扰时段，但尚未接入 Web Push、邮件服务或定时任务。
2. **附件上传**：需要创建 R2 Bucket 并启用 `wrangler.toml` 中的可选 R2 绑定。D1 不存储文件二进制内容。
3. **账号安全增强**：当前没有邮箱验证码、密码找回、MFA 和登录限流。建议先作为私人家庭应用使用，不要在未补齐这些能力前开放公开注册推广。
4. **自动备份策略**：当前提供 JSON 手动导出；Cloudflare D1 的自动备份与恢复策略需要在 Cloudflare 控制台进一步确认。
5. **旧版头像迁移**：V0.6/V1.0 原型中的本地 Base64 头像不会直接写入 D1。导入旧 JSON 时会跳过 Base64 头像，需要在启用 R2 后重新上传。

本应用是宠物健康信息记录工具，不提供兽医诊断或治疗建议。

## 3. 项目结构

```text
mycat-cloudflare-d1-v1.0/
├── migrations/
│   └── 0001_init.sql          # D1 初始表结构
├── public/
│   ├── index.html             # 页面入口
│   ├── manifest.webmanifest   # PWA 基础配置
│   └── assets/
│       ├── app.css            # 原型样式 + 登录页/响应式样式
│       ├── app.js             # 页面交互、登录与云端同步
│       ├── hero-spring-picnic.png
│       ├── pet-blue.webp
│       ├── pet-silver.webp
│       ├── pet-tux.webp
│       └── app-icon.svg
├── src/
│   └── index.js               # Cloudflare Worker API
├── wrangler.toml              # Worker、静态资源、D1 绑定
├── package.json
└── README.md
```

## 4. 首次部署（推荐顺序）

### 第一步：解压并安装依赖

在电脑安装 Node.js LTS。解压项目后，在项目根目录打开终端：

```bash
npm install
```

### 第二步：登录 Cloudflare

```bash
npx wrangler login
```

浏览器会打开 Cloudflare 授权页面，使用你准备部署的 Cloudflare 账号授权。

### 第三步：创建 D1 数据库

```bash
npx wrangler d1 create mycat-db
```

命令成功后会返回数据库信息，其中包含 `database_id`。打开项目根目录的 `wrangler.toml`，找到：

```toml
database_id = "00000000-0000-0000-0000-000000000000"
```

将它替换成刚刚返回的真实 ID，保留双引号。这个全零 ID 只是初始化占位值，**不替换就不能正常连接远程 D1**。不要把账号密码写进前端代码。

如果你已经有名为 `mycat-db` 的 D1 数据库，不要重复创建；先在 Cloudflare 控制台确认现有数据库 ID，再填入配置。

### 第四步：初始化本地 D1

```bash
npm run db:migrate:local
```

这一步会在本地 Wrangler 数据目录中创建表，便于本地开发测试。

### 第五步：本地运行

```bash
npm run dev
```

终端会显示本地访问地址，通常是 `http://localhost:8787`。首次打开应看到登录页；选择「创建家庭」即可创建第一个账号和家庭空间。

停止本地服务按 `Ctrl + C`。

### 第六步：初始化 Cloudflare 远程 D1

确认 `wrangler.toml` 中的 `database_id` 正确后执行：

```bash
npm run db:migrate:remote
```

看到 `0001_init.sql` 应用成功后，远程数据库表结构就初始化完成了。

### 第七步：部署 Worker + 静态资源

```bash
npm run deploy
```

Wrangler 会一起发布 Worker API 和 `public/` 静态文件。部署完成后，终端会返回 `workers.dev` 地址。

## 5. 上传到 GitHub（手动）

仓库目前为空，可以将解压后的项目文件作为仓库根目录内容：

```bash
git clone https://github.com/fryjin/mycat.git
```

把本项目文件复制到 `mycat/` 仓库目录（不要把最外层项目文件夹再套一层），然后：

```bash
git add .
git commit -m "Initialize MyCat Cloudflare D1 app"
git push origin main
```

`.gitignore` 已排除 `node_modules/`、`.wrangler/`、`.dev.vars` 等本地文件。

## 6. 可选：启用 R2 私有附件

核心应用不依赖 R2。需要上传猫咪头像、检查报告或 PDF 时再启用：

1. 创建 Bucket：

   ```bash
   npx wrangler r2 bucket create mycat-private-files
   ```

2. 打开 `wrangler.toml`，取消注释：

   ```toml
   [[r2_buckets]]
   binding = "FILES"
   bucket_name = "mycat-private-files"
   ```

3. 重新部署：

   ```bash
   npm run deploy
   ```

文件使用家庭 ID 作为对象路径前缀，读取附件时 Worker 会验证登录态和家庭归属，不创建公开 R2 URL。

## 7. 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 本地启动 Worker + 静态资源 |
| `npm run test` | 检查 Worker 与前端 JavaScript 语法 |
| `npm run db:migrate:local` | 应用本地 D1 迁移 |
| `npm run db:migrate:remote` | 应用远程 D1 迁移 |
| `npm run db:migrations:list` | 查看远程迁移状态 |
| `npm run deploy` | 部署 Worker 与静态资源 |

## 8. 故障排查

- **页面提示无法连接云端**：先确认 Worker 已部署，且远程 D1 已执行 `npm run db:migrate:remote`。
- **D1 binding not found**：检查 `wrangler.toml` 中 `binding = "DB"`，并确认数据库 ID 填写正确。
- **数据库表不存在**：重新查看 `npm run db:migrations:list`，确认 `0001_init.sql` 已应用到 remote。
- **头像/附件上传提示未配置 R2**：这是预期行为；按第 6 节启用 R2，或暂时不使用附件功能。
- **家庭邀请码无法加入**：邀请码 7 天有效、一次性使用，且家庭成员上限为两人；让管理员重新生成即可。
- **两台设备同时编辑**：若出现并发冲突，页面会切换到云端最新数据，并把未同步的本地快照保存在当前浏览器 localStorage 的冲突备份键中。出现提示后先导出/核对，不要连续重复提交。
