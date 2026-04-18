#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法：
  bash scripts/deploy-vercel-prod.sh \
    --scope <vercel-scope> \
    --base-url <生产域名URL> \
    --database-url '<postgresql://...>' \
    --session-secret '<SESSION_SECRET>' \
    --owner-password '<OWNER_PASSWORD>'

可选参数：
  --project-dir <目录>    默认当前目录
  --skip-db-push         跳过 drizzle schema push
  --help                 显示帮助

示例（请替换成你自己的项目参数）：
  bash scripts/deploy-vercel-prod.sh \
    --scope your-vercel-scope \
    --base-url https://your-domain.example.com \
    --database-url 'postgresql://postgres.<your-project-ref>:<your-db-password>@aws-<x>-<region>.pooler.supabase.com:6543/postgres' \
    --session-secret 'replace-with-32+-chars' \
    --owner-password 'replace-with-admin-password'

说明：
  DATABASE_URL 必须从你自己的 Supabase 控制台复制：Connect -> Transaction pooler
  不要复用他人的 project-ref、密码或 pooler 主机。
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[错误] 缺少命令: $cmd" >&2
    exit 1
  fi
}

set_env_prod() {
  local name="$1"
  local value="$2"

  npx vercel env rm "$name" production --yes --scope "$SCOPE" >/dev/null 2>&1 || true
  npx vercel env add "$name" production --value "$value" --yes --scope "$SCOPE" >/dev/null
}

check_endpoint() {
  local path="$1"
  local must_contain="$2"
  local url="${BASE_URL%/}$path"
  local tmp
  tmp="$(mktemp)"

  local status
  status="$(curl -sS -o "$tmp" -w "%{http_code}" "$url")"
  local body
  body="$(cat "$tmp")"
  rm -f "$tmp"

  if [[ "$status" != "200" ]]; then
    echo "[失败] $url 返回 $status" >&2
    echo "$body" >&2
    return 1
  fi

  if [[ -n "$must_contain" && "$body" != *"$must_contain"* ]]; then
    echo "[失败] $url 返回 200 但内容不符合预期，缺少: $must_contain" >&2
    echo "$body" >&2
    return 1
  fi

  echo "[通过] $url"
}

PROJECT_DIR="$(pwd)"
SKIP_DB_PUSH="false"
SCOPE=""
BASE_URL=""
DATABASE_URL=""
SESSION_SECRET=""
OWNER_PASSWORD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope)
      SCOPE="$2"
      shift 2
      ;;
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --database-url)
      DATABASE_URL="$2"
      shift 2
      ;;
    --session-secret)
      SESSION_SECRET="$2"
      shift 2
      ;;
    --owner-password)
      OWNER_PASSWORD="$2"
      shift 2
      ;;
    --project-dir)
      PROJECT_DIR="$2"
      shift 2
      ;;
    --skip-db-push)
      SKIP_DB_PUSH="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[错误] 未知参数: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$SCOPE" || -z "$BASE_URL" || -z "$DATABASE_URL" || -z "$SESSION_SECRET" || -z "$OWNER_PASSWORD" ]]; then
  echo "[错误] 缺少必填参数" >&2
  usage
  exit 1
fi

require_cmd npx
require_cmd pnpm
require_cmd curl
require_cmd python

cd "$PROJECT_DIR"

echo "[1/5] 更新 Vercel Production 环境变量..."
set_env_prod DATABASE_URL "$DATABASE_URL"
set_env_prod SESSION_SECRET "$SESSION_SECRET"
set_env_prod OWNER_PASSWORD "$OWNER_PASSWORD"
set_env_prod NODE_ENV "production"

echo "[2/5] 拉取生产环境变量做快照..."
npx vercel env pull .env.vercel.production.live --environment=production --yes --scope "$SCOPE" >/dev/null

if [[ "$SKIP_DB_PUSH" != "true" ]]; then
  echo "[3/5] 下发数据库 schema (drizzle push)..."
  DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run push
else
  echo "[3/5] 跳过数据库 schema push"
fi

echo "[4/5] 生产重部署 (archive=tgz，规避 15000+ 文件上传限制)..."
DEPLOY_LOG="$(mktemp)"
npx vercel deploy --prod --yes --archive=tgz --scope "$SCOPE" | tee "$DEPLOY_LOG"

DEPLOYMENT_URL="$(python - "$DEPLOY_LOG" <<'PY'
import re
import sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding='utf-8', errors='ignore')
m = re.findall(r'Production:\s+(https://[^\s]+)', text)
if m:
    print(m[-1])
    raise SystemExit(0)
m = re.findall(r'"url"\s*:\s*"(https://[^"]+)"', text)
if m:
    print(m[-1])
PY
)"
rm -f "$DEPLOY_LOG"

if [[ -n "${DEPLOYMENT_URL:-}" ]]; then
  echo "[信息] 本次部署 URL: $DEPLOYMENT_URL"
fi

echo "[5/5] 验证关键接口..."
check_endpoint "/api/healthz" '"status":"ok"'
check_endpoint "/api/keepalive" '"db":"up"'
check_endpoint "/api/prompts" '"items"'

echo "[完成] 部署与验证成功。"
