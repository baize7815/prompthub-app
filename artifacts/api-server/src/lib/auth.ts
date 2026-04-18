import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

const COOKIE_NAME = "prompthub_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getOwnerPassword(): string | null {
  const v = process.env["OWNER_PASSWORD"];
  if (!v || !v.trim()) return null;
  return v;
}

let cachedSecret: string | null = null;
function getSessionSecret(): string {
  if (cachedSecret) return cachedSecret;
  const env = process.env["SESSION_SECRET"];
  if (env && env.trim()) {
    cachedSecret = env;
  } else {
    cachedSecret = randomBytes(32).toString("hex");
    logger.warn(
      "SESSION_SECRET not set; using ephemeral secret. Owner sessions will not survive a restart.",
    );
  }
  return cachedSecret;
}

function hmac(input: string): string {
  return createHmac("sha256", getSessionSecret()).update(input).digest("hex");
}

function ownerFingerprint(): string {
  const pw = getOwnerPassword();
  if (!pw) return "no-owner";
  // Short fingerprint of the password so changing it invalidates old sessions.
  return hmac(`owner:${pw}`).slice(0, 16);
}

export function isOwnerEnabled(): boolean {
  return getOwnerPassword() !== null;
}

export function verifyPassword(input: unknown): boolean {
  const pw = getOwnerPassword();
  if (!pw) return false;
  if (typeof input !== "string") return false;
  const a = Buffer.from(input);
  const b = Buffer.from(pw);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signSession(): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const fp = ownerFingerprint();
  const payload = `${exp}.${fp}`;
  return `${payload}.${hmac(payload)}`;
}

function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expStr, fp, sig] = parts;
  const expected = hmac(`${expStr}.${fp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (fp !== ownerFingerprint()) return false; // password changed
  return true;
}

export function isOwnerRequest(req: Request): boolean {
  if (!isOwnerEnabled()) return false;
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[
    COOKIE_NAME
  ];
  return verifySession(cookie);
}

export function setSessionCookie(res: Response): void {
  const token = signSession();
  const isProd = process.env["NODE_ENV"] === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function requireOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isOwnerEnabled()) {
    res.status(503).json({
      error:
        "服务端未配置 OWNER_PASSWORD，无法进行写操作。请在 Replit Secrets 中设置后重启服务。",
      code: "OWNER_NOT_CONFIGURED",
    });
    return;
  }
  if (!isOwnerRequest(req)) {
    res.status(401).json({ error: "需要登录后才能执行此操作。", code: "UNAUTHENTICATED" });
    return;
  }
  next();
}

/**
 * Stable per-owner MCP token derived from OWNER_PASSWORD + SESSION_SECRET.
 * Rotating either value rotates the MCP token. Returns null if owner is not
 * configured.
 */
export function getMcpToken(): string | null {
  const pw = getOwnerPassword();
  if (!pw) return null;
  return hmac(`mcp:${pw}`).slice(0, 40);
}

export function isMcpAuthorized(req: Request): boolean {
  // Owner cookie always allowed.
  if (isOwnerRequest(req)) return true;
  const expected = getMcpToken();
  if (!expected) return false; // owner not configured → MCP locked
  const provided = extractBearerToken(req);
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractBearerToken(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m && m[1]) return m[1].trim();
  }
  const q = req.query["token"];
  if (typeof q === "string" && q.trim()) return q.trim();
  return null;
}
