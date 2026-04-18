# error.md

## 2026-04-18 MCP 功能扩展收尾

- **Task**: 扩展 MCP 功能（懒加载 + 分类检索 + 新建提示词）
- **Error**: `pnpm --filter @workspace/api-server run typecheck` 在 `promptsStore.ts` 报 TS2339/TS2353（`usageCount` / `lastUsedAt` 字段不存在）
- **Status**: ✅ Resolved
- **Cause**: 当前 `prompts` 表 schema 不含 `usageCount` / `lastUsedAt`，但代码仍按存在字段读写，导致类型检查失败。
- **Solution**: 将 `toPrompt` 中这两个字段改为兼容默认值（`0` / `null`），并把 `recordPromptUsage` 调整为 no-op；随后重新通过 `typecheck` 与 `build`。
- **Verification**:
  - `pnpm --filter @workspace/api-server run typecheck` ✅
  - `pnpm --filter @workspace/api-server run build` ✅

## 2026-04-18 生产部署后 MCP 授权验证

- **Task**: 生产环境重新部署后验证 MCP tools 列表
- **Error**: 首次验证 MCP 返回 401 / 406（缺 token、缺 Accept 头）
- **Status**: ✅ Resolved
- **Cause**: 使用了旧 token；且 MCP streamable HTTP 要求 `Accept: application/json, text/event-stream`。
- **Solution**: 使用你提供的新 token（query + bearer），并补齐 Accept 头后调用 `tools/list`，成功返回工具清单。
- **Verification**:
  - `curl ... /api/mcp`（无 token） -> 401（预期）
  - `curl ... tools/list`（有 token 但无 Accept） -> 406（预期）
  - `curl ... tools/list`（有 token + 正确 Accept） -> 返回 6 个 tools ✅

## 2026-04-18 Skill 与脚本固化（prompthub-mcp-guide）

- **Task**: 生成 MCP 使用 skill 与可复用脚本并自测
- **Error**: 首次脚本自测报参数错误（`unrecognized arguments: --url --token`）
- **Status**: ✅ Resolved
- **Cause**: `argparse` 全局参数必须放在子命令前，首次调用顺序写反。
- **Solution**: 改为 `python run.py --url ... --token ... tools`；并按 Windows 控制台设置 UTF-8 环境变量避免中文乱码。
- **Verification**:
  - `python run.py --url ... --token ... tools` ✅
  - `PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python run.py --url ... --token ... categories` ✅

## 2026-04-18 仓库发布（GitHub）

- **Task**: 创建公开仓库并发布当前项目
- **Error**: `create_repository` 返回 422（仓库名已存在）
- **Status**: ✅ Resolved
- **Cause**: 账号下已存在同名仓库（`PromptHub`，GitHub 名称大小写不敏感）。
- **Solution**: 改用新仓库名 `prompthub-app` 创建公开仓库，并继续执行发布流程。
- **Verification**:
  - `create_repository(name=prompthub-app, private=false)` ✅
  - `git commit`（root commit, 212 files）✅
  - `git push -u origin main` ✅

## 2026-04-18 README 对外展示版重写

- **Task**: 将 README 改为对外展示风格，加入小白部署指南（Vercel + Supabase 免费方案）、演示占位、Mermaid 架构图与 FAQ。
- **Error**: 无
- **Status**: ✅ Resolved
- **Cause**: _N/A_
- **Solution**: 完整重写 `README.md`，重点前置“10分钟部署”，补充环境变量表、部署后验证、MCP 调用示例与常见问题。
- **Verification**:
  - `README.md` 已包含 Mermaid 架构图 ✅
  - 截图仍使用相对路径 `./ScreenShot/*.png` ✅
  - Vercel + Supabase 小白步骤已落地 ✅
