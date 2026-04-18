# PromptHub

PromptHub 是一个用于管理和复用 AI 提示词的全栈项目：
- 前端提供提示词库管理与新绘画工作台
- 后端提供 API 与 MCP（Model Context Protocol）访问
- 数据存储在 PostgreSQL（通过 `@workspace/db`）

## 功能概览

- 提示词库：分类、搜索、排序、卡片视图管理
- 新绘画：选择模型、尺寸、生成数量、参考图后发起生成
- 设置中心：生成 MCP 配置片段，一键接入 Cursor / VS Code / Cline / Windsurf / Trae

## 项目截图

> 使用相对路径引用，GitHub 可直接显示。

### 1) 提示词库主页

![提示词库主页](./ScreenShot/ScreenShot_2026-04-18_103558_361.png)

### 2) 新绘画页面

![新绘画页面](./ScreenShot/ScreenShot_2026-04-18_103521_681.png)

### 3) MCP 设置弹窗

![MCP 设置弹窗](./ScreenShot/ScreenShot_2026-04-18_103502_560.png)

## 本地开发

```bash
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/prompthub run dev
```

常用地址：
- API（开发）：`http://localhost:8080/api/...`
- Web（开发）：`http://localhost:5173`（Vite 默认端口）

## MCP 接入

部署后可通过以下端点接入：

```text
POST https://<your-host>/api/mcp
```

支持的主要能力：
- 列出提示词
- 按标题获取提示词
- 搜索提示词

## Monorepo 结构（节选）

```text
artifacts/
  prompthub/        # 前端应用（Vite + React）
  api-server/       # API / MCP 服务
lib/
  db/               # 数据库 schema 与访问层
  api-spec/         # OpenAPI 定义
  api-client-react/ # React API 客户端
  api-zod/          # Zod 类型与 schema
```
