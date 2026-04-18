import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ApiError } from "@/lib/store";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerEnabled: boolean;
  onLogin: (password: string) => Promise<unknown>;
};

export function LoginDialog({ open, onOpenChange, ownerEnabled, onLogin }: Props) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!password) {
      toast.error("请输入密码");
      return;
    }
    setSubmitting(true);
    try {
      await onLogin(password);
      toast.success("已登录");
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error("登录失败");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            管理员登录
          </DialogTitle>
          <DialogDescription>
            {ownerEnabled
              ? "输入服务端配置的 OWNER_PASSWORD 后才能新建、编辑或删除提示词。"
              : "服务端尚未配置 OWNER_PASSWORD。请在 Replit Secrets 中添加该密钥并重启服务。"}
          </DialogDescription>
        </DialogHeader>

        {ownerEnabled && (
          <div className="space-y-2 py-2">
            <label className="text-sm font-medium">密码</label>
            <Input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !submitting) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="输入 OWNER_PASSWORD"
              spellCheck={false}
              autoComplete="current-password"
            />
            <p className="text-xs text-muted-foreground">
              密码不会保存到浏览器，只用于验证一次。验证成功后会发放一个有效期 30 天的会话 Cookie。
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !ownerEnabled}>
            {submitting ? "验证中..." : "登录"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
