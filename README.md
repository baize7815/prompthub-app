# PromptHub

> 一个给 AI 重度用户准备的提示词库：可视化管理 + 分类检索 + MCP 直连 Cursor/VS Code/Cline。  
> **目标：让你把“散落在聊天记录里的 prompt”变成可复用资产。**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/baize7815/prompthub-app)

---

## 在线演示（请替换为你的地址）

- 🌐 Web App: `https://your-project.vercel.app`
- 🔌 MCP Endpoint: `https://your-project.vercel.app/api/mcp`

> 部署完成后，把上面两个地址替换成你自己的 Vercel 域名。

---

## 你会得到什么

- 提示词库管理（分类 / 搜索 / 排序 / 卡片视图）
- 新绘画工作台（模型、尺寸、生成张数、参考图）
- 内置 MCP 接入配置生成器（Cursor / VS Code / Cline / Windsurf / Trae）
- PostgreSQL 持久化存储（Supabase 免费版可用）

---

## 项目截图

### 提示词库主页
![提示词库主页](./ScreenShot/ScreenShot_2026-04-18_103558_361.png)

### 新绘画页面
![新绘画页面](./ScreenShot/ScreenShot_2026-04-18_103521_681.png)

### MCP 设置弹窗
![MCP 设置弹窗](./ScreenShot/ScreenShot_2026-04-18_103502_560.png)

---

## 架构图（Mermaid）

```mermaid
flowchart LR
    U[用户浏览器] --> V[PromptHub Web UI\nVercel Static]
    A[AI 编辑器\nCursor/VS Code/Cline] --> M[/api/mcp]

    V --> API[/api/*\nVercel Function\nExpress]
    M --> API

    API --> DB[(Supabase PostgreSQL)]

    API --> H[/api/healthz]
    API --> K[/api/keepalive]
```

---

## 小白 10 分钟部署指南（Vercel + Supabase 免费方案）

> 你不需要会后端，也不需要会数据库管理。按步骤点就行。

### 0. 准备账号与工具

你只要有这些：

1. GitHub 账号
2. Vercel 账号（可用 GitHub 登录）
3. Supabase 账号（免费）
4. Node.js >= 18（本地初始化数据库时需要）
5. `pnpm`（项目使用 pnpm）

安装 pnpm（如果没有）：

```bash
npm i -g pnpm
```

---

### 1. 创建 Supabase 免费数据库

1. 登录 Supabase，新建一个 **Free** 项目。
2. 等待项目创建完成（通常几分钟）。
3. 进入 **Project Settings → Database → Connection string**。
4. 找到 **Transaction pooler**（推荐）连接串，复制下来（通常是 6543 端口）。

你会拿到一个像这样的 `DATABASE_URL`：

```text
postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-xxx.pooler.supabase.com:6543/postgres
```

---

### 2. 本地初始化数据库表（只做一次）

在你的电脑上执行：

```bash
pnpm install
```

然后设置 `DATABASE_URL` 并推表：

**macOS / Linux（bash）**

```bash
export DATABASE_URL='你的 Supabase 连接串'
pnpm --filter @workspace/db run push
```

**Windows PowerShell**

```powershell
$env:DATABASE_URL='你的 Supabase 连接串'
pnpm --filter @workspace/db run push
```

看到成功输出即可。

---

### 3. 一键部署到 Vercel（免费）

1. 打开本页顶部按钮 **Deploy with Vercel**（或在 Vercel 手动导入仓库）。
2. 进入项目配置后，添加以下环境变量：

| 变量名 | 必填 | 示例 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://...` | Supabase Transaction Pooler 连接串 |
| `SESSION_SECRET` | ✅ | `a-very-long-random-string` | 会话签名密钥，建议 32+ 字符 |
| `OWNER_PASSWORD` | ✅ | `your-admin-password` | 管理后台登录密码 |
| `NODE_ENV` | ✅ | `production` | 生产环境标识 |
| `LOG_LEVEL` | 可选 | `info` | 日志等级 |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | 可选 | `https://api.openai.com/v1` | 兼容 OpenAI 接口地址 |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | 可选 | `sk-...` | AI 生成能力的 API Key |

3. 点击 Deploy，等待完成。

---

### 4. 部署后验证（非常重要）

把 `your-project.vercel.app` 换成你的真实域名：

1. 健康检查：

```text
https://your-project.vercel.app/api/healthz
```

预期返回：

```json
{"status":"ok"}
```

2. 打开首页，使用你设置的 `OWNER_PASSWORD` 登录。
3. 进入左下角 **设置 → MCP**，复制 token 和配置片段。

MCP 快速测试（可选）：

```bash
curl -X POST "https://your-project.vercel.app/api/mcp?token=YOUR_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

如果你看到 tools 列表，就代表 MCP 接入正常。

---

## 在 Cursor / VS Code 里接入 MCP

部署完成后，不用手写配置：

1. 打开 PromptHub 网页
2. 左下角 **设置 → MCP**
3. 选择你的编辑器标签（Cursor / VS Code / Cline / Windsurf / Trae）
4. 直接复制 JSON

---

## 常见问题（新手必看）

### Q1: 打开页面报错“未配置 OWNER_PASSWORD”
**原因**：Vercel 没填 `OWNER_PASSWORD`。  
**解决**：去 Vercel Project Settings → Environment Variables 补上后重新部署。

### Q2: MCP 调用返回 401 或 406
**原因**：
- 401：token 不对或没传。
- 406：请求头缺少 `Accept: application/json, text/event-stream`。  
**解决**：用设置页给的 token，并补齐 Accept 头。

### Q3: 数据库相关报错（表不存在）
**原因**：没有执行 `pnpm --filter @workspace/db run push`。  
**解决**：按上面的第 2 步推表一次。

### Q4: 重启后登录状态丢失
**原因**：`SESSION_SECRET` 变了或未固定。  
**解决**：设置稳定不变的 `SESSION_SECRET`（不要每次重部署都改）。

### Q5: 免费版会不会休眠？
**说明**：Supabase Free 可能休眠。项目内置了 `/api/keepalive` 的 Vercel Cron，只是降低休眠概率，不是 100% 保证。

---

## 本地开发

```bash
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/prompthub run dev
```

常用地址：
- API：`http://localhost:8080/api/...`
- Web：`http://localhost:5173`

---

## Monorepo 结构

```text
artifacts/
  prompthub/        # 前端（Vite + React）
  api-server/       # API + MCP（Express）
lib/
  db/               # 数据库 schema 与访问层
  api-spec/         # OpenAPI 定义
  api-client-react/ # React API 客户端
  api-zod/          # Zod 类型与 schema
```
