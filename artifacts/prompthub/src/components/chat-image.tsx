import { Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

type Props = {
  src: string;
  alt?: string;
  className?: string;
};

function inferExt(src: string, contentType?: string): string {
  if (contentType) {
    const m = contentType.match(/image\/([a-z0-9+]+)/i);
    if (m) return m[1] === "jpeg" ? "jpg" : m[1];
  }
  const dataMatch = src.match(/^data:image\/([a-z0-9+]+);/i);
  if (dataMatch) return dataMatch[1] === "jpeg" ? "jpg" : dataMatch[1];
  const urlMatch = src.split("?")[0].match(/\.([a-z0-9]+)$/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  return "png";
}

async function downloadImage(src: string) {
  try {
    let blob: Blob;
    let contentType: string | undefined;
    if (src.startsWith("data:")) {
      const res = await fetch(src);
      blob = await res.blob();
      contentType = blob.type;
    } else {
      const res = await fetch(src, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
      contentType = res.headers.get("content-type") ?? blob.type;
    }
    const ext = inferExt(src, contentType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `image-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    // CORS-blocked or network error: fall back to opening in a new tab so
    // the user can save it manually with the browser's "Save image as".
    toast.message("无法直接下载，已在新标签页打开。请右键另存为。");
    window.open(src, "_blank", "noopener,noreferrer");
  }
}

export function ChatImage({ src, alt, className }: Props) {
  if (!src) return null;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <img
          src={src}
          alt={alt ?? ""}
          className={`cursor-zoom-in ${className ?? ""}`}
          onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void downloadImage(src)}>
          <Download className="h-4 w-4 mr-2" /> 下载图片
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => window.open(src, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink className="h-4 w-4 mr-2" /> 在新标签页打开
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
