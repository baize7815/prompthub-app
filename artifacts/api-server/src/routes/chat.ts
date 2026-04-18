import { Router, type IRouter, type Response } from "express";
import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import https from "node:https";
import http from "node:http";

const router: IRouter = Router();

const DEFAULT_BASE_URL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const DEFAULT_API_KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const DEFAULT_MODEL = "gpt-5.2";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// ---------------------------------------------------------------------------
// IP / hostname classification
// ---------------------------------------------------------------------------

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function expandIPv6(ip: string): string[] | null {
  // Expand any valid IPv6 string into exactly 8 lower-case hex groups (no
  // padding). Handles "::" compression and a trailing "x.x.x.x" form.
  const lower = ip.toLowerCase();
  if (isIP(lower) !== 6) return null;
  let head = lower;
  let v4Tail: string | null = null;
  const dotIdx = head.lastIndexOf(".");
  if (dotIdx !== -1) {
    const colonIdx = head.lastIndexOf(":");
    if (colonIdx === -1) return null;
    v4Tail = head.slice(colonIdx + 1);
    head = head.slice(0, colonIdx + 1) + "0:0";
  }
  let groups: string[];
  if (head.includes("::")) {
    const [left, right] = head.split("::");
    const l = left ? left.split(":") : [];
    const r = right ? right.split(":") : [];
    const fillCount = 8 - (l.length + r.length);
    if (fillCount < 0) return null;
    groups = [...l, ...new Array(fillCount).fill("0"), ...r];
  } else {
    groups = head.split(":");
  }
  if (groups.length !== 8) return null;
  if (v4Tail) {
    const parts = v4Tail.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return null;
    }
    groups[6] = ((parts[0] << 8) | parts[1]).toString(16);
    groups[7] = ((parts[2] << 8) | parts[3]).toString(16);
  }
  return groups.map((g) => parseInt(g || "0", 16).toString(16));
}

function normalizeIPv6ToIPv4(ip: string): string | null {
  const groups = expandIPv6(ip);
  if (!groups) return null;
  // IPv4-mapped: ::ffff:a.b.c.d  → groups 0..4 are 0, group 5 is ffff
  if (
    groups[0] === "0" &&
    groups[1] === "0" &&
    groups[2] === "0" &&
    groups[3] === "0" &&
    groups[4] === "0" &&
    groups[5] === "ffff"
  ) {
    const hi = parseInt(groups[6], 16);
    const lo = parseInt(groups[7], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  // IPv4-compatible (deprecated): ::a.b.c.d → groups 0..5 are 0
  if (
    groups[0] === "0" &&
    groups[1] === "0" &&
    groups[2] === "0" &&
    groups[3] === "0" &&
    groups[4] === "0" &&
    groups[5] === "0" &&
    !(groups[6] === "0" && groups[7] === "0") &&
    !(groups[6] === "0" && groups[7] === "1")
  ) {
    const hi = parseInt(groups[6], 16);
    const lo = parseInt(groups[7], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (/^0*:0*:0*:0*:0*:0*:0*:0*1$/.test(lower)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // ULA fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
  if (/^ff[0-9a-f]{2}:/.test(lower)) return true; // multicast ff00::/8
  if (lower.startsWith("100::")) return true; // discard
  return false;
}

function isPrivateIP(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) {
    const v4 = normalizeIPv6ToIPv4(ip);
    if (v4) return isPrivateIPv4(v4);
    return isPrivateIPv6(ip);
  }
  return true;
}

function isPrivateHostnameLiteral(host: string): boolean {
  const lower = host.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".lan") ||
    lower.endsWith(".home") ||
    lower.endsWith(".intranet")
  ) {
    return true;
  }
  if (isIP(lower) > 0) return isPrivateIP(lower);
  return false;
}

async function selectPublicIP(hostname: string): Promise<string | null> {
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.length === 0) return null;
    if (records.some((r) => isPrivateIP(r.address))) return null;
    return records[0].address;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// URL validation + credential resolution
// ---------------------------------------------------------------------------

export type Validated = {
  baseHref: string; // e.g. https://api.openai.com/v1 (no trailing slash)
  hostname: string;
  port: number;
  pinnedIP: string | null; // null only for trusted env-default base URL
  protocol: "https:" | "http:";
};

async function validateUserBaseURL(
  input: string,
): Promise<{ ok: true; url: Validated } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: "Base URL 格式不正确。" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Base URL 必须以 http:// 或 https:// 开头。" };
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, error: "Base URL 缺少主机名。" };
  if (isPrivateHostnameLiteral(host)) {
    return { ok: false, error: "Base URL 不能指向本机或内网地址。" };
  }
  let pinnedIP: string;
  if (isIP(host) === 0) {
    const ip = await selectPublicIP(host);
    if (!ip) {
      return {
        ok: false,
        error: "Base URL 解析到的地址为内网/保留地址，已拒绝。",
      };
    }
    pinnedIP = ip;
  } else {
    pinnedIP = host;
  }
  const protocol = parsed.protocol as "https:" | "http:";
  const port = parsed.port
    ? Number(parsed.port)
    : protocol === "https:"
      ? 443
      : 80;
  return {
    ok: true,
    url: {
      baseHref: input.trim().replace(/\/+$/, ""),
      hostname: host,
      port,
      pinnedIP,
      protocol,
    },
  };
}

function envDefaultValidated(): Validated | null {
  if (!DEFAULT_BASE_URL) return null;
  let parsed: URL;
  try {
    parsed = new URL(DEFAULT_BASE_URL);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  return {
    baseHref: DEFAULT_BASE_URL.replace(/\/+$/, ""),
    hostname: host,
    port: parsed.port
      ? Number(parsed.port)
      : parsed.protocol === "http:"
        ? 80
        : 443,
    pinnedIP: null, // trusted; no pinning needed
    protocol: parsed.protocol === "http:" ? "http:" : "https:",
  };
}

export type Resolved =
  | { ok: true; url: Validated; apiKey: string }
  | { ok: false; status: number; error: string };

/**
 * Only ever uses the env defaults when BOTH baseURL and apiKey are absent in
 * the request. This prevents leaking the server's default API key to an
 * attacker-supplied baseURL.
 */
export async function resolveCredentials(
  rawBase: unknown,
  rawKey: unknown,
): Promise<Resolved> {
  const userBase = typeof rawBase === "string" ? rawBase.trim() : "";
  const userKey = typeof rawKey === "string" ? rawKey.trim() : "";

  if (!userBase && !userKey) {
    const def = envDefaultValidated();
    if (!def || !DEFAULT_API_KEY) {
      return {
        ok: false,
        status: 400,
        error: "服务端未配置默认 AI 接口，请在设置中填写 Base URL 与 API Key。",
      };
    }
    return { ok: true, url: def, apiKey: DEFAULT_API_KEY };
  }
  if (userBase && !userKey) {
    return {
      ok: false,
      status: 400,
      error: "填写自定义 Base URL 时必须同时填写 API Key。",
    };
  }
  if (userKey && !userBase) {
    return {
      ok: false,
      status: 400,
      error: "填写自定义 API Key 时必须同时填写 Base URL。",
    };
  }

  const validated = await validateUserBaseURL(userBase);
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error };
  }
  return { ok: true, url: validated.url, apiKey: userKey };
}

// ---------------------------------------------------------------------------
// Pinned-IP HTTP request helpers (no auto-redirect)
// ---------------------------------------------------------------------------

export type RequestOptions = {
  url: Validated;
  path: string; // e.g. /chat/completions
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string | Buffer;
};

export function makeRequest(
  opts: RequestOptions,
  cb: (res: http.IncomingMessage) => void,
  onError: (err: Error) => void,
): http.ClientRequest {
  const lib = opts.url.protocol === "http:" ? http : https;
  // When pinnedIP is set we connect directly to that IP (bypassing the
  // socket layer's own DNS lookup that would otherwise re-resolve and
  // could be rebound), and set Host + SNI to the original hostname so
  // virtual hosting and TLS still work.
  const headers = opts.url.pinnedIP
    ? { ...opts.headers, Host: opts.url.hostname }
    : opts.headers;
  const requestOptions: https.RequestOptions = {
    host: opts.url.pinnedIP ?? opts.url.hostname,
    port: opts.url.port,
    path: opts.path,
    method: opts.method,
    headers,
    ...(opts.url.pinnedIP && opts.url.protocol === "https:"
      ? { servername: opts.url.hostname }
      : {}),
  };
  const req = lib.request(requestOptions, cb);
  req.on("error", onError);
  if (opts.body) req.write(opts.body);
  req.end();
  return req;
}

export function blockedRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function writeSseError(res: Response, message: string): void {
  res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
  res.end();
}

router.post("/chat", async (req, res) => {
  const { messages, model, baseURL, apiKey } = req.body as {
    messages?: unknown[];
    model?: string;
    baseURL?: string;
    apiKey?: string;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages is required" });
    return;
  }
  const validRoles = new Set(["system", "user", "assistant"]);
  const sanitizeContent = (
    c: unknown,
  ): string | Array<Record<string, unknown>> | null => {
    if (typeof c === "string") return c;
    if (!Array.isArray(c)) return null;
    const parts: Array<Record<string, unknown>> = [];
    for (const part of c) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (p["type"] === "text" && typeof p["text"] === "string") {
        parts.push({ type: "text", text: p["text"] as string });
      } else if (
        p["type"] === "image_url" &&
        p["image_url"] &&
        typeof (p["image_url"] as { url?: unknown }).url === "string"
      ) {
        const url = (p["image_url"] as { url: string }).url;
        // Reject anything that isn't an https URL or an image data URL,
        // and cap each attachment to ~12MB encoded to bound request size.
        if (url.length > 12 * 1024 * 1024) continue;
        const isHttp = /^https?:\/\//i.test(url);
        const isImageDataUrl = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(url);
        if (!isHttp && !isImageDataUrl) continue;
        parts.push({
          type: "image_url",
          image_url: { url },
        });
      }
    }
    return parts.length > 0 ? parts : null;
  };
  const safeMessages: Array<{
    role: string;
    content: string | Array<Record<string, unknown>>;
  }> = [];
  for (const m of messages as Array<Record<string, unknown>>) {
    if (!m || !validRoles.has(m["role"] as string)) continue;
    const sc = sanitizeContent(m["content"]);
    if (sc === null) continue;
    safeMessages.push({ role: m["role"] as string, content: sc });
  }
  if (safeMessages.length === 0) {
    res.status(400).json({ error: "no valid messages" });
    return;
  }

  const resolved = await resolveCredentials(baseURL, apiKey);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const useModel =
    typeof model === "string" && model.trim() ? model.trim() : DEFAULT_MODEL;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const upstreamPath =
    new URL(resolved.url.baseHref + "/chat/completions").pathname;
  const body = JSON.stringify({
    model: useModel,
    max_completion_tokens: 8192,
    messages: safeMessages,
    stream: true,
  });

  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  makeRequest(
    {
      url: resolved.url,
      path: upstreamPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolved.apiKey}`,
        Accept: "text/event-stream",
      },
      body,
    },
    (upstream) => {
      const status = upstream.statusCode ?? 0;
      if (blockedRedirect(status)) {
        upstream.resume();
        writeSseError(res, `已拒绝上游重定向 (${status})。`);
        return;
      }
      if (status < 200 || status >= 300) {
        let errBody = "";
        upstream.setEncoding("utf8");
        upstream.on("data", (c: string) => {
          errBody += c;
        });
        upstream.on("end", () =>
          writeSseError(res, `上游错误 (${status}): ${errBody.slice(0, 300)}`),
        );
        return;
      }
      let buffer = "";
      upstream.setEncoding("utf8");
      upstream.on("data", (chunk: string) => {
        if (aborted) {
          upstream.destroy();
          return;
        }
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === "[DONE]") continue;
          try {
            const obj = JSON.parse(payload);
            const delta = obj?.choices?.[0]?.delta ?? {};
            const message = obj?.choices?.[0]?.message;

            const emitImageUrl = (raw: unknown) => {
              if (typeof raw !== "string" || !raw) return;
              const isHttp = /^https?:\/\//i.test(raw);
              const isImageData =
                /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(raw);
              if (!isHttp && !isImageData) return;
              res.write(`data: ${JSON.stringify({ image: raw })}\n\n`);
            };

            const handleParts = (parts: unknown) => {
              if (!Array.isArray(parts)) return;
              for (const part of parts) {
                if (!part || typeof part !== "object") continue;
                const p = part as Record<string, unknown>;
                if (p.type === "text" && typeof p.text === "string" && p.text) {
                  res.write(
                    `data: ${JSON.stringify({ content: p.text })}\n\n`,
                  );
                } else if (p.type === "image_url" && p.image_url) {
                  const url = (p.image_url as { url?: unknown }).url;
                  emitImageUrl(url);
                } else if (p.type === "output_image" || p.type === "image") {
                  // Some providers use { type: "image", image_url: "..." } or
                  // { type: "output_image", image: "data:..." }.
                  emitImageUrl(p.image_url ?? p.image ?? p.url);
                  const b64 = p.b64_json ?? p.b64;
                  if (typeof b64 === "string" && b64) {
                    emitImageUrl(`data:image/png;base64,${b64}`);
                  }
                }
              }
            };

            // Plain string content (text token)
            if (typeof delta.content === "string" && delta.content.length > 0) {
              res.write(
                `data: ${JSON.stringify({ content: delta.content })}\n\n`,
              );
            } else {
              handleParts(delta.content);
            }
            handleParts(message?.content);

            // Many image-capable providers stream images via a separate
            // `images` array on the delta or message:
            //   delta.images: [{ type:"image_url", image_url:{ url } }]
            //   delta.images: ["data:image/..."]
            const imageArrays: unknown[] = [];
            if (Array.isArray(delta.images)) imageArrays.push(...delta.images);
            if (Array.isArray(message?.images))
              imageArrays.push(...message.images);
            for (const item of imageArrays) {
              if (typeof item === "string") {
                emitImageUrl(item);
              } else if (item && typeof item === "object") {
                const it = item as Record<string, unknown>;
                if (it.image_url && typeof it.image_url === "object") {
                  emitImageUrl((it.image_url as { url?: unknown }).url);
                } else if (typeof it.image_url === "string") {
                  emitImageUrl(it.image_url);
                } else if (typeof it.url === "string") {
                  emitImageUrl(it.url);
                } else if (typeof it.b64_json === "string") {
                  emitImageUrl(`data:image/png;base64,${it.b64_json}`);
                }
              }
            }
          } catch {
            // ignore malformed line
          }
        }
      });
      upstream.on("end", () => {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      });
      upstream.on("error", (err) => writeSseError(res, err.message));
    },
    (err) => writeSseError(res, err.message),
  );
});

router.post("/models", async (req, res) => {
  const { baseURL, apiKey } = req.body as {
    baseURL?: string;
    apiKey?: string;
  };
  const resolved = await resolveCredentials(baseURL, apiKey);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }

  const upstreamPath =
    new URL(resolved.url.baseHref + "/models").pathname;

  makeRequest(
    {
      url: resolved.url,
      path: upstreamPath,
      method: "GET",
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
        Accept: "application/json",
      },
    },
    (upstream) => {
      const status = upstream.statusCode ?? 0;
      if (blockedRedirect(status)) {
        upstream.resume();
        res
          .status(502)
          .json({ error: `已拒绝上游重定向 (${status})。` });
        return;
      }
      let buf = "";
      upstream.setEncoding("utf8");
      upstream.on("data", (c: string) => {
        buf += c;
      });
      upstream.on("end", () => {
        if (status < 200 || status >= 300) {
          res
            .status(status)
            .json({
              error: `获取模型列表失败 (${status}): ${buf.slice(0, 300)}`,
            });
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(buf);
        } catch {
          res
            .status(502)
            .json({ error: "返回数据不是 JSON，无法解析模型列表。" });
          return;
        }
        const data = (parsed as { data?: Array<{ id?: string }> })?.data;
        if (!Array.isArray(data)) {
          res.status(502).json({ error: "响应中找不到 data 数组。" });
          return;
        }
        const models = data
          .map((m) => (typeof m?.id === "string" ? m.id : null))
          .filter((x): x is string => !!x)
          .sort();
        res.json({ models });
      });
      upstream.on("error", (err) =>
        res.status(500).json({ error: err.message }),
      );
    },
    (err) => res.status(500).json({ error: err.message }),
  );
});

export default router;
