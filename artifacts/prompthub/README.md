# PromptHub

A personal AI-prompt manager. The web UI lives in this artifact (`@workspace/prompthub`); prompts and categories are persisted in PostgreSQL through `@workspace/db`, and the same data is exposed over the Model Context Protocol (MCP) so external AI editors can pull prompts directly.

## Connect an AI editor (MCP)

The MCP endpoint is served by `@workspace/api-server` over Streamable HTTP at:

```
POST  <your-deployed-origin>/api/mcp
```

It exposes three tools:

- `list_prompts` — list all prompts (title, category, summary)
- `get_prompt_by_title({ title })` — get the full Markdown content of one prompt
- `search_prompts({ query })` — fuzzy search by title or content

Plus a dynamic MCP **prompt** entry per saved prompt.

In the running app, click the **设置** button at the bottom-left of the sidebar to open the install dialog. It contains tabs for Cursor / VS Code / Cline / Windsurf / Trae / 其他, a one-click deep-link button (where supported), and the same JSON snippets shown below.

> 提示：必须安装 Node.js 环境（版本号 >= 18）

### Cursor / Windsurf / Trae / Other

```json
{
  "mcpServers": {
    "prompthub": {
      "url": "https://YOUR-HOST/api/mcp"
    }
  }
}
```

### VS Code

```json
{
  "servers": {
    "prompthub": {
      "type": "http",
      "url": "https://YOUR-HOST/api/mcp"
    }
  }
}
```

### Cline

```json
{
  "mcpServers": {
    "prompthub": {
      "url": "https://YOUR-HOST/api/mcp",
      "transportType": "streamableHttp"
    }
  }
}
```

## Storage

Prompts and categories live in two tables defined in `lib/db/src/schema/prompthub.ts`:

- `prompts(id, title, content, category_id, created_at, updated_at)`
- `prompt_categories(id, name)`

On the api-server's first request, if `prompts` is empty, a default set of 5 starter prompts and 4 categories is seeded automatically.

## Vercel + Supabase（免费方案）部署

### 1) Supabase（free）

1. 新建 Supabase free 项目。
2. 在 Connect 面板复制 **Transaction pooler** 连接串（建议 6543 端口）。
3. 将它配置为 `DATABASE_URL`。
4. 执行一次 schema 初始化（本地）：

```bash
pnpm --filter @workspace/db run push
```

### 2) Vercel 环境变量

至少配置这些：

- `DATABASE_URL`：Supabase transaction pooler 连接串
- `SESSION_SECRET`：随机强密钥（建议 32+ 字符）
- `OWNER_PASSWORD`：管理后台登录密码
- `NODE_ENV=production`

可选：

- `LOG_LEVEL`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`

### 3) 部署

项目已内置：

- `vercel.json`：前端静态输出 + `/api/*` 路由到 Express 入口
- `api/index.ts`：Vercel Function 入口
- cron 保活：定时请求 `/api/keepalive`

直接在 Vercel 导入仓库后部署即可。

### 4) 保活说明

- 保活接口：`/api/keepalive`（会执行一次 `select 1`）
- 已配置 Vercel Cron（生产环境生效）
- 注意：Supabase Free 仍可能因平台策略暂停低活跃项目，保活只能降低概率，不是 SLA 保证

## Local development

```bash
pnpm --filter @workspace/db run push          # apply schema
pnpm --filter @workspace/api-server run dev   # http://localhost:8080/api/...
pnpm --filter @workspace/prompthub run dev    # web UI
```
