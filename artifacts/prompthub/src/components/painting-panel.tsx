import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModelCombobox } from "@/components/settings-dialog";
import { ChatImage } from "@/components/chat-image";
import {
  ImagePlus,
  Loader2,
  Palette,
  Sparkles,
  Trash,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { ChatSettings, Painting } from "@/lib/store";
import { cn } from "@/lib/utils";

const SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "1024x1024", label: "1024×1024 方形" },
  { value: "1536x1024", label: "1536×1024 横向" },
  { value: "1024x1536", label: "1024×1536 纵向" },
];

const N_OPTIONS = [1, 2, 4];

const DEFAULT_PAINTING_MODEL = "gpt-image-1";

const MAX_REF_BYTES = 8 * 1024 * 1024;

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

type Props = {
  painting: Painting | null;
  settings: ChatSettings;
  onCreate: (params: {
    prompt: string;
    model: string;
    size: string;
    n: number;
    referenceImages: string[];
  }) => Painting;
  onUpdate: (id: string, updater: (prev: Painting) => Painting) => void;
  onSelect: (id: string | null) => void;
  onDelete?: (id: string) => void;
};

export function PaintingPanel({
  painting,
  settings,
  onCreate,
  onUpdate,
  onSelect,
  onDelete,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(DEFAULT_PAINTING_MODEL);
  const [size, setSize] = useState<string>("auto");
  const [n, setN] = useState<number>(1);
  const [refs, setRefs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // When opening an existing painting, hydrate the form.
  useEffect(() => {
    if (painting) {
      setPrompt(painting.prompt);
      setModel(painting.model || DEFAULT_PAINTING_MODEL);
      setSize(painting.size);
      setN(painting.n);
      setRefs(painting.referenceImages);
    } else {
      setPrompt("");
      setModel(DEFAULT_PAINTING_MODEL);
      setSize("auto");
      setN(1);
      setRefs([]);
    }
  }, [painting?.id]);

  const handlePickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.type.startsWith("image/")) continue;
      if (f.size > MAX_REF_BYTES) {
        toast.error(`图片 ${f.name} 超过 8MB，已跳过`);
        continue;
      }
      try {
        next.push(await fileToDataUrl(f));
      } catch {
        toast.error(`读取 ${f.name} 失败`);
      }
    }
    if (next.length > 0) setRefs((prev) => [...prev, ...next].slice(0, 8));
  };

  const removeRef = (i: number) => {
    setRefs((prev) => prev.filter((_, idx) => idx !== i));
  };

  const generate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      toast.error("请输入提示词");
      return;
    }
    if (!model.trim()) {
      toast.error("请选择或输入模型");
      return;
    }
    setSubmitting(true);
    const created = onCreate({
      prompt: trimmed,
      model: model.trim(),
      size,
      n,
      referenceImages: refs,
    });
    onSelect(created.id);

    try {
      const res = await fetch("/api/images", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          model: model.trim(),
          size,
          n,
          images: refs,
          baseURL: settings.baseURL,
          apiKey: settings.apiKey,
        }),
      });
      const text = await res.text();
      let parsed: { images?: string[]; error?: string } = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        // ignore
      }
      if (!res.ok) {
        const msg = parsed.error || text || `HTTP ${res.status}`;
        onUpdate(created.id, (p) => ({
          ...p,
          status: "error",
          error: msg,
          updatedAt: Date.now(),
        }));
        toast.error("生成失败：" + msg);
        return;
      }
      const urls = Array.isArray(parsed.images) ? parsed.images : [];
      onUpdate(created.id, (p) => ({
        ...p,
        status: urls.length > 0 ? "done" : "error",
        error: urls.length > 0 ? undefined : "未收到任何图片",
        results: urls,
        updatedAt: Date.now(),
      }));
      if (urls.length === 0) toast.error("未收到任何图片");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onUpdate(created.id, (p) => ({
        ...p,
        status: "error",
        error: msg,
        updatedAt: Date.now(),
      }));
      toast.error("生成失败：" + msg);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    onSelect(null);
  };

  const isGenerating = submitting || painting?.status === "generating";

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-purple-500" />
          <h2 className="text-lg font-semibold">
            {painting ? painting.title : "新绘画"}
          </h2>
          {painting?.status === "generating" && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> 生成中
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {painting && (
            <Button variant="outline" size="sm" onClick={reset}>
              <Sparkles className="h-4 w-4 mr-1" /> 新建
            </Button>
          )}
          {painting && onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(painting.id)}
            >
              <Trash className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
          {/* Settings */}
          <div className="space-y-4 rounded-xl border bg-card/40 p-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">模型</label>
              <ModelCombobox value={model} onChange={setModel} options={[]} />
              <p className="text-xs text-muted-foreground">
                复用对话设置中的服务器与密钥；模型可单独选择，例如 gpt-image-1。
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">尺寸</label>
              <div className="flex flex-wrap items-center gap-2">
                {SIZE_OPTIONS.map((s) => (
                  <Button
                    key={s.value}
                    type="button"
                    variant={size === s.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSize(s.value)}
                  >
                    {s.label}
                  </Button>
                ))}
                <Input
                  type="text"
                  inputMode="text"
                  placeholder="自定义如 1920x1080"
                  value={
                    SIZE_OPTIONS.some((s) => s.value === size) ? "" : size
                  }
                  onChange={(e) => {
                    const v = e.target.value.trim().toLowerCase();
                    setSize(v || "auto");
                  }}
                  className={cn(
                    "h-8 w-44 text-xs",
                    !SIZE_OPTIONS.some((s) => s.value === size) &&
                      "border-primary ring-1 ring-primary/40",
                  )}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                可在右侧输入自定义尺寸，格式为「宽x高」，例如 1920x1080。
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">生成数量</label>
              <div className="flex gap-2">
                {N_OPTIONS.map((opt) => (
                  <Button
                    key={opt}
                    type="button"
                    variant={n === opt ? "default" : "outline"}
                    size="sm"
                    onClick={() => setN(opt)}
                  >
                    {opt}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  参考图片
                  <span className="ml-2 text-xs text-muted-foreground">
                    {refs.length === 0
                      ? "（不添加为文生图，添加后为图生图/多图生图）"
                      : `（已添加 ${refs.length} 张）`}
                  </span>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4 mr-1" /> 添加图片
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handlePickFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              {refs.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {refs.map((src, i) => (
                    <div
                      key={i}
                      className="relative group rounded-md overflow-hidden border w-20 h-20"
                    >
                      <img
                        src={src}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeRef(i)}
                        className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
                        aria-label="移除"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Prompt */}
          <div className="space-y-2">
            <label className="text-sm font-medium">提示词</label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想生成的画面，例如：一只在赛博朋克城市街头的猫，霓虹光，电影感..."
              className="min-h-[120px] resize-y"
              disabled={isGenerating}
            />
            <div className="flex justify-end">
              <Button
                onClick={generate}
                disabled={isGenerating || !prompt.trim()}
                className={cn(
                  "bg-purple-600 hover:bg-purple-500 text-white",
                  "shadow-sm",
                )}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> 生成中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    {refs.length === 0
                      ? "文生图"
                      : refs.length === 1
                        ? "图生图"
                        : `多图生图 (${refs.length})`}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Results */}
          {painting && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">结果</h3>
              {painting.status === "generating" && (
                <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                  <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
                  正在生成 {painting.n} 张图片，请稍候...
                </div>
              )}
              {painting.status === "error" && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                  {painting.error || "生成失败"}
                </div>
              )}
              {painting.status === "done" && painting.results.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {painting.results.map((src, i) => (
                    <div
                      key={i}
                      className="rounded-xl overflow-hidden border bg-muted/30"
                    >
                      <ChatImage
                        src={src}
                        alt={`result-${i + 1}`}
                        className="w-full h-auto block"
                      />
                    </div>
                  ))}
                  <p className="col-span-full text-xs text-muted-foreground">
                    在图片上右键可下载或在新标签页中打开。
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
