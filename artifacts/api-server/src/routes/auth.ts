import { Router, type IRouter } from "express";
import {
  isOwnerEnabled,
  isOwnerRequest,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  getMcpToken,
} from "../lib/auth";

const router: IRouter = Router();

router.get("/auth/me", (req, res) => {
  const ownerEnabled = isOwnerEnabled();
  const isOwner = isOwnerRequest(req);
  res.json({
    ownerEnabled,
    isOwner,
    mcpToken: isOwner ? getMcpToken() : null,
  });
});

router.post("/auth/login", (req, res) => {
  if (!isOwnerEnabled()) {
    res.status(503).json({
      error:
        "服务端未配置 OWNER_PASSWORD，请在 Replit Secrets 中设置后重启服务。",
      code: "OWNER_NOT_CONFIGURED",
    });
    return;
  }
  const { password } = (req.body ?? {}) as { password?: unknown };
  if (typeof password !== "string" || !password) {
    res.status(400).json({ error: "请输入密码。" });
    return;
  }
  if (!verifyPassword(password)) {
    res.status(401).json({ error: "密码不正确。" });
    return;
  }
  setSessionCookie(res);
  res.json({ ok: true, isOwner: true, mcpToken: getMcpToken() });
});

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
