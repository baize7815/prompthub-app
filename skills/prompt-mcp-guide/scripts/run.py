#!/usr/bin/env python
"""PromptHub MCP 半自动调用脚本（可复用）

用法示例：
  python run.py tools --url "https://prompt.878896.xyz/api/mcp" --token "<token>"
  python run.py categories --url "https://prompt.878896.xyz/api/mcp" --token "<token>"
  python run.py get-in-category --category "生图" --title "摄影" --url "..." --token "..."
  python run.py create --category "生图" --title "我的提词" --content-file "./prompt.md" --url "..." --token "..."

环境变量（可选）：
  PROMPTHUB_MCP_URL
  PROMPTHUB_MCP_TOKEN
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List
from urllib import error, parse, request


def build_endpoint(url: str, token: str | None) -> str:
  if not token:
    return url
  parsed = parse.urlparse(url)
  q = dict(parse.parse_qsl(parsed.query, keep_blank_values=True))
  if "token" not in q:
    q["token"] = token
    new_query = parse.urlencode(q)
    parsed = parsed._replace(query=new_query)
    return parse.urlunparse(parsed)
  return url


def parse_mcp_response(raw: str) -> Dict[str, Any]:
  text = raw.strip()
  if not text:
    raise RuntimeError("MCP 返回为空")

  if text.startswith("{"):
    obj = json.loads(text)
    if obj.get("error"):
      raise RuntimeError(f"MCP 错误: {obj['error']}")
    return obj

  # Streamable HTTP 常见返回：event/data 行
  events: List[Dict[str, Any]] = []
  for line in raw.splitlines():
    if not line.startswith("data:"):
      continue
    payload = line[len("data:") :].strip()
    if not payload:
      continue
    try:
      events.append(json.loads(payload))
    except json.JSONDecodeError:
      continue

  if not events:
    preview = raw[:500].replace("\n", "\\n")
    raise RuntimeError(f"无法解析 MCP 响应: {preview}")

  last = events[-1]
  if last.get("error"):
    raise RuntimeError(f"MCP 错误: {last['error']}")
  return last


def mcp_post(url: str, token: str | None, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
  endpoint = build_endpoint(url, token)
  body = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": method,
    "params": params,
  }
  data = json.dumps(body, ensure_ascii=False).encode("utf-8")
  headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
  }
  if token:
    headers["authorization"] = f"Bearer {token}"

  req = request.Request(endpoint, data=data, headers=headers, method="POST")
  try:
    with request.urlopen(req, timeout=60) as resp:
      raw = resp.read().decode("utf-8", errors="replace")
  except error.HTTPError as e:
    detail = e.read().decode("utf-8", errors="replace")
    raise RuntimeError(f"HTTP {e.code}: {detail}") from e
  except error.URLError as e:
    raise RuntimeError(f"网络错误: {e}") from e

  return parse_mcp_response(raw)


def tools_list(url: str, token: str | None) -> Dict[str, Any]:
  return mcp_post(url, token, "tools/list", {})


def call_tool(url: str, token: str | None, tool: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
  return mcp_post(
    url,
    token,
    "tools/call",
    {"name": tool, "arguments": arguments},
  )


def extract_text_content(obj: Dict[str, Any]) -> str:
  result = obj.get("result") if "result" in obj else obj
  content = result.get("content") if isinstance(result, dict) else None
  if not isinstance(content, list):
    return json.dumps(result, ensure_ascii=False, indent=2)
  parts: List[str] = []
  for item in content:
    if isinstance(item, dict) and item.get("type") == "text":
      parts.append(str(item.get("text", "")))
  return "\n\n".join(parts).strip() or json.dumps(result, ensure_ascii=False, indent=2)


def parse_args() -> argparse.Namespace:
  p = argparse.ArgumentParser(description="PromptHub MCP 半自动调用脚本")
  p.add_argument("--url", default=os.getenv("PROMPTHUB_MCP_URL"), help="MCP URL")
  p.add_argument("--token", default=os.getenv("PROMPTHUB_MCP_TOKEN"), help="MCP token")

  sub = p.add_subparsers(dest="cmd", required=True)

  sub.add_parser("tools", help="列出 MCP tools")
  sub.add_parser("categories", help="列出分类")

  s = sub.add_parser("search", help="全库搜索 prompt")
  s.add_argument("--query", required=True)

  g = sub.add_parser("get", help="按标题读取 prompt")
  g.add_argument("--title", required=True)

  gc = sub.add_parser("get-in-category", help="分类内按标题读取 prompt")
  gc.add_argument("--category", required=True)
  gc.add_argument("--title", required=True)
  gc.add_argument("--match", choices=["exact", "contains"], default="contains")

  c = sub.add_parser("create", help="创建 prompt（会先确认）")
  c.add_argument("--category", required=True)
  c.add_argument("--title", required=True)
  c.add_argument("--content", default=None)
  c.add_argument("--content-file", default=None)
  c.add_argument("--yes", action="store_true", help="跳过确认")

  i = sub.add_parser("intent", help="按意图做轻量路由（通用入口）")
  i.add_argument("--text", required=True, help="用户原话")
  i.add_argument("--category", default="生图")

  return p.parse_args()


def ensure_url(url: str | None) -> str:
  if not url:
    raise RuntimeError("缺少 MCP URL。请传 --url 或设置 PROMPTHUB_MCP_URL")
  return url


def read_content_arg(content: str | None, content_file: str | None) -> str:
  if content and content_file:
    raise RuntimeError("--content 与 --content-file 二选一")
  if content_file:
    return Path(content_file).read_text(encoding="utf-8")
  if content:
    return content
  raise RuntimeError("缺少内容。请传 --content 或 --content-file")


def run() -> int:
  args = parse_args()
  url = ensure_url(args.url)
  token = args.token

  if args.cmd == "tools":
    obj = tools_list(url, token)
    tools = (obj.get("result") or {}).get("tools", [])
    print(f"Tools: {len(tools)}")
    for t in tools:
      print(f"- {t.get('name')} | {t.get('title', '')}")
    return 0

  if args.cmd == "categories":
    obj = call_tool(url, token, "list_prompt_categories", {})
    print(extract_text_content(obj))
    return 0

  if args.cmd == "search":
    obj = call_tool(url, token, "search_prompts", {"query": args.query})
    print(extract_text_content(obj))
    return 0

  if args.cmd == "get":
    obj = call_tool(url, token, "get_prompt_by_title", {"title": args.title})
    print(extract_text_content(obj))
    return 0

  if args.cmd == "get-in-category":
    obj = call_tool(
      url,
      token,
      "get_prompt_in_category",
      {
        "category": args.category,
        "title": args.title,
        "match": args.match,
      },
    )
    print(extract_text_content(obj))
    return 0

  if args.cmd == "create":
    content = read_content_arg(args.content, args.content_file)
    preview = content.strip().replace("\n", " ")[:180]
    print("准备创建 prompt：")
    print(f"- 分类: {args.category}")
    print(f"- 标题: {args.title}")
    print(f"- 内容预览: {preview}{'...' if len(content.strip()) > 180 else ''}")

    if not args.yes:
      ans = input("确认创建？[y/N] ").strip().lower()
      if ans not in {"y", "yes"}:
        print("已取消。")
        return 0

    obj = call_tool(
      url,
      token,
      "create_prompt",
      {
        "category": args.category,
        "title": args.title,
        "content": content,
      },
    )
    print(extract_text_content(obj))
    return 0

  if args.cmd == "intent":
    text = args.text

    if any(k in text for k in ["上传", "新建", "保存", "入库"]):
      print("检测到“入库类”意图。请使用 create 子命令，并在创建前完成标题/分类/内容确认。")
      print("示例：python run.py create --category 生图 --title 你的标题 --content-file ./prompt.md")
      return 0

    if "逆向" in text:
      obj = call_tool(url, token, "get_prompt_by_title", {"title": "逆向"})
      print("检测到“模板执行类(逆向)”意图，已读取候选模板：\n")
      print(extract_text_content(obj))
      return 0

    if any(k in text for k in ["摄影", "拍摄", "镜头", "光线", "景深"]):
      obj = call_tool(
        url,
        token,
        "get_prompt_in_category",
        {"category": args.category, "title": "摄影", "match": "contains"},
      )
      print(f"检测到“检索复用类”意图，已在分类“{args.category}”读取摄影相关模板：\n")
      print(extract_text_content(obj))
      return 0

    print("检测到“探索推荐类”意图，先做全库搜索。")
    obj = call_tool(url, token, "search_prompts", {"query": text[:20]})
    print(extract_text_content(obj))
    return 0

  raise RuntimeError(f"未知命令: {args.cmd}")


if __name__ == "__main__":
  try:
    sys.exit(run())
  except Exception as e:
    print(f"[ERROR] {e}", file=sys.stderr)
    sys.exit(1)
