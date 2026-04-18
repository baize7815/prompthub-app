import { Router, type IRouter } from "express";
import {
  blockedRedirect,
  makeRequest,
  resolveCredentials,
} from "./chat";

const router: IRouter = Router();

const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB encoded
const ALLOWED_SIZES = new Set([
  "auto",
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "256x256",
  "512x512",
  "1792x1024",
  "1024x1792",
]);

type Body = {
  prompt?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  size?: string;
  n?: number;
  images?: string[]; // data:image/...;base64,... or https URLs
};

function isValidImageRef(s: string): boolean {
  // Reference images must be inline base64 data URLs. Remote URLs are not
  // accepted to keep the upstream multipart contract simple and to avoid
  // having the server fetch arbitrary URLs on the user's behalf (SSRF).
  if (!s) return false;
  if (s.length > MAX_IMAGE_BYTES) return false;
  return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s);
}

function parseDataUrl(
  dataUrl: string,
): { mime: string; ext: string; buffer: Buffer } | null {
  const m = dataUrl.match(/^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const subtype = m[2].toLowerCase();
  const ext = subtype === "jpeg" ? "jpg" : subtype;
  try {
    const buffer = Buffer.from(m[3], "base64");
    return { mime, ext, buffer };
  } catch {
    return null;
  }
}

function buildMultipart(
  fields: Array<{ name: string; value: string }>,
  files: Array<{
    name: string;
    filename: string;
    contentType: string;
    data: Buffer;
  }>,
): { boundary: string; body: Buffer } {
  const boundary =
    "----prompthubFormBoundary" + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const f of fields) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${f.name}"\r\n\r\n` +
          `${f.value}\r\n`,
      ),
    );
  }
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\n` +
          `Content-Type: ${f.contentType}\r\n\r\n`,
      ),
    );
    chunks.push(f.data);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

router.post("/images", async (req, res) => {
  const body = (req.body ?? {}) as Body;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const size = ALLOWED_SIZES.has(body.size ?? "") ? body.size! : "auto";
  const n = Number.isInteger(body.n) ? Math.max(1, Math.min(4, body.n!)) : 1;
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "gpt-image-1";

  const rawImages = Array.isArray(body.images) ? body.images : [];
  const images: string[] = [];
  for (const img of rawImages) {
    if (typeof img === "string" && isValidImageRef(img)) {
      images.push(img);
      if (images.length >= 16) break;
    }
  }

  const resolved = await resolveCredentials(body.baseURL, body.apiKey);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }

  const isEdit = images.length > 0;
  const upstreamPath = isEdit
    ? new URL(resolved.url.baseHref + "/images/edits").pathname
    : new URL(resolved.url.baseHref + "/images/generations").pathname;

  // Build request body. For edits we use multipart; the prompt + images go
  // as form-data parts. For generations we use JSON.
  let reqBody: string | Buffer;
  let contentType: string;
  if (isEdit) {
    const fields: Array<{ name: string; value: string }> = [
      { name: "prompt", value: prompt },
      { name: "model", value: model },
      { name: "n", value: String(n) },
    ];
    if (size !== "auto") fields.push({ name: "size", value: size });
    const files: Array<{
      name: string;
      filename: string;
      contentType: string;
      data: Buffer;
    }> = [];
    for (let i = 0; i < images.length; i++) {
      const parsed = parseDataUrl(images[i]);
      if (!parsed) continue;
      files.push({
        name: "image[]",
        filename: `image-${i}.${parsed.ext}`,
        contentType: parsed.mime,
        data: parsed.buffer,
      });
    }
    if (files.length === 0) {
      res.status(400).json({ error: "no usable reference images" });
      return;
    }
    const multipart = buildMultipart(fields, files);
    reqBody = multipart.body;
    contentType = `multipart/form-data; boundary=${multipart.boundary}`;
  } else {
    const json: Record<string, unknown> = {
      prompt,
      model,
      n,
    };
    if (size !== "auto") json.size = size;
    reqBody = JSON.stringify(json);
    contentType = "application/json";
  }

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
        "Content-Type": contentType,
        "Content-Length": String(
          typeof reqBody === "string"
            ? Buffer.byteLength(reqBody)
            : reqBody.length,
        ),
        Authorization: `Bearer ${resolved.apiKey}`,
        Accept: "application/json",
      },
      body: reqBody,
    },
    (upstream) => {
      const status = upstream.statusCode ?? 0;
      if (blockedRedirect(status)) {
        upstream.resume();
        res.status(502).json({ error: `已拒绝上游重定向 (${status})。` });
        return;
      }
      let buf = "";
      upstream.setEncoding("utf8");
      upstream.on("data", (c: string) => {
        if (aborted) {
          upstream.destroy();
          return;
        }
        buf += c;
      });
      upstream.on("end", () => {
        if (aborted) return;
        if (status < 200 || status >= 300) {
          res
            .status(status)
            .json({ error: `上游错误 (${status}): ${buf.slice(0, 500)}` });
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(buf);
        } catch {
          res.status(502).json({ error: "返回数据不是 JSON。" });
          return;
        }
        const data = (parsed as { data?: Array<Record<string, unknown>> })
          ?.data;
        if (!Array.isArray(data)) {
          res.status(502).json({ error: "响应中找不到 data 数组。" });
          return;
        }
        const urls: string[] = [];
        for (const item of data) {
          if (!item || typeof item !== "object") continue;
          if (typeof item.url === "string" && /^https?:\/\//i.test(item.url)) {
            urls.push(item.url);
          } else if (typeof item.b64_json === "string" && item.b64_json) {
            urls.push(`data:image/png;base64,${item.b64_json}`);
          }
        }
        res.json({ images: urls });
      });
      upstream.on("error", (err) =>
        res.status(500).json({ error: err.message }),
      );
    },
    (err) => res.status(500).json({ error: err.message }),
  );
});

export default router;
