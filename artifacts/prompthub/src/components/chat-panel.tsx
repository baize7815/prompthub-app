import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, BookOpen, Copy, GripHorizontal, History, Loader2, Paperclip, Pencil, RefreshCw, Trash, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  messageImages,
  messageText,
  type Conversation,
  type ChatMessage,
  type ChatSettings,
  type ContentPart,
  type Prompt,
  type Category,
  type PromptChange,
  type PromptChangeKind,
} from "@/lib/store";
import { EditSystemPromptDialog } from "./edit-system-prompt-dialog";
import { MarkdownMessage } from "@/components/markdown-message";
import { ChatImage } from "@/components/chat-image";

type Props = {
  conversation: Conversation;
  settings: ChatSettings;
  prompts: Prompt[];
  categories: Category[];
  onUpdateConversation: (
    id: string,
    updater: (prev: Conversation) => Conversation,
  ) => void;
  onDelete: () => void;
};

function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return "新对话";
  return trimmed.length > 24 ? trimmed.slice(0, 24) + "…" : trimmed;
}

function describePromptKind(kind: PromptChangeKind, title: string | null): string {
  if (kind === "prompt") return title ?? "已保存提示词";
  if (kind === "custom") return "自定义";
  return "无";
}

function formatChangeTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

function classifyPrompt(
  promptId: string | null,
  promptTitle: string | null,
  systemPrompt: string,
): { kind: PromptChangeKind; title: string | null } {
  if (promptId && promptTitle) return { kind: "prompt", title: promptTitle };
  if (systemPrompt.trim()) return { kind: "custom", title: null };
  return { kind: "none", title: null };
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB per image

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function ChatPanel({
  conversation,
  settings,
  prompts,
  categories,
  onUpdateConversation,
  onDelete,
}: Props) {
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [editPromptOpen, setEditPromptOpen] = useState(false);
  const [composerHeight, setComposerHeight] = useState(140);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragStateRef = useRef<{ startY: number; startH: number } | null>(null);

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStateRef.current = { startY: e.clientY, startH: composerHeight };
    const onMove = (ev: PointerEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      // dragging the handle UP should grow the box, so subtract delta
      const next = s.startH + (s.startY - ev.clientY);
      const clamped = Math.max(96, Math.min(window.innerHeight * 0.7, next));
      setComposerHeight(clamped);
    };
    const onUp = () => {
      dragStateRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation.messages, isStreaming]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const addImageFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) return;
    const accepted: string[] = [];
    for (const f of arr) {
      if (f.size > MAX_IMAGE_BYTES) {
        toast.error(`图片 ${f.name} 超过 8MB，已跳过`);
        continue;
      }
      try {
        accepted.push(await fileToDataUrl(f));
      } catch {
        toast.error(`无法读取图片 ${f.name}`);
      }
    }
    if (accepted.length > 0) setPendingImages((prev) => [...prev, ...accepted]);
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f && f.type.startsWith("image/")) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      await addImageFiles(files);
    }
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) await addImageFiles(files);
    e.target.value = "";
  };

  const removePendingImage = (idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  };

  type ApiMessage = {
    role: "system" | "user" | "assistant";
    content: string | ContentPart[];
  };

  const runAssistantStream = async (
    apiMessages: ApiMessage[],
    assistantMsgId: string,
  ) => {
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          model: settings.model,
          baseURL: settings.baseURL,
          apiKey: settings.apiKey,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`请求失败：${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      const assistantImages: string[] = [];
      let errorText: string | null = null;

      const buildContent = (): string | ContentPart[] => {
        if (assistantImages.length === 0) return assistantText;
        const parts: ContentPart[] = [];
        if (assistantText) parts.push({ type: "text", text: assistantText });
        for (const url of assistantImages) {
          parts.push({ type: "image_url", image_url: { url } });
        }
        return parts;
      };

      const flush = () => {
        const snapshot = buildContent();
        onUpdateConversation(conversation.id, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantMsgId ? { ...m, content: snapshot } : m,
          ),
          updatedAt: Date.now(),
        }));
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const obj = JSON.parse(payload);
            if (obj.error) {
              errorText = obj.error;
            } else if (typeof obj.content === "string" && obj.content) {
              assistantText += obj.content;
              flush();
            } else if (typeof obj.image === "string" && obj.image) {
              assistantImages.push(obj.image);
              flush();
            }
          } catch {
            // ignore malformed line
          }
        }
      }

      if (errorText) {
        const err = errorText;
        onUpdateConversation(conversation.id, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: `⚠️ ${err}` }
              : m,
          ),
          updatedAt: Date.now(),
        }));
        toast.error(errorText);
      } else if (!assistantText && assistantImages.length === 0) {
        onUpdateConversation(conversation.id, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: "（空响应）" }
              : m,
          ),
        }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络错误";
      if (controller.signal.aborted) {
        onUpdateConversation(conversation.id, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantMsgId && !messageText(m.content)
              ? { ...m, content: "（已停止）" }
              : m,
          ),
        }));
      } else {
        onUpdateConversation(conversation.id, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: `⚠️ ${msg}` }
              : m,
          ),
        }));
        toast.error(msg);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    const images = pendingImages;
    if ((!text && images.length === 0) || isStreaming) return;

    const userContent: ContentPart[] | string =
      images.length > 0
        ? [
            ...(text ? [{ type: "text" as const, text }] : []),
            ...images.map(
              (url) =>
                ({ type: "image_url" as const, image_url: { url } }) as ContentPart,
            ),
          ]
        : text;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: userContent,
      createdAt: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };

    const isFirstUserMessage = conversation.messages.length === 0;
    const titleSeed = text || "图片消息";

    onUpdateConversation(conversation.id, (prev) => ({
      ...prev,
      title: isFirstUserMessage ? deriveTitle(titleSeed) : prev.title,
      messages: [...prev.messages, userMsg, assistantMsg],
      updatedAt: Date.now(),
    }));

    setInput("");
    setPendingImages([]);

    const apiMessages: ApiMessage[] = [];
    if (conversation.systemPrompt.trim()) {
      apiMessages.push({ role: "system", content: conversation.systemPrompt });
    }
    for (const m of conversation.messages) {
      apiMessages.push({ role: m.role, content: m.content });
    }
    apiMessages.push({ role: "user", content: userContent });

    await runAssistantStream(apiMessages, assistantMsg.id);
  };

  const handleCopyMessage = async (m: ChatMessage) => {
    const text = messageText(m.content);
    if (!text) {
      toast.error("没有可复制的文本");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  const handleRegenerate = async (assistantMsgId: string) => {
    if (isStreaming) return;
    const idx = conversation.messages.findIndex((m) => m.id === assistantMsgId);
    if (idx < 0) return;
    const priorMessages = conversation.messages.slice(0, idx);

    const apiMessages: ApiMessage[] = [];
    if (conversation.systemPrompt.trim()) {
      apiMessages.push({ role: "system", content: conversation.systemPrompt });
    }
    for (const m of priorMessages) {
      apiMessages.push({ role: m.role, content: m.content });
    }

    onUpdateConversation(conversation.id, (prev) => {
      const i = prev.messages.findIndex((m) => m.id === assistantMsgId);
      if (i < 0) return prev;
      const kept = prev.messages.slice(0, i);
      const reset: ChatMessage = {
        ...prev.messages[i],
        content: "",
        createdAt: Date.now(),
      };
      return {
        ...prev,
        messages: [...kept, reset],
        updatedAt: Date.now(),
      };
    });

    await runAssistantStream(apiMessages, assistantMsgId);
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="flex flex-col h-full">
      <header className="px-8 py-4 border-b bg-card/50 backdrop-blur sticky top-0 z-10 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold truncate">{conversation.title}</h1>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <BookOpen className="h-3 w-3" />
            <span className="truncate">
              系统提示词：
              {conversation.promptTitle ??
                (conversation.systemPrompt.trim()
                  ? "自定义"
                  : "无（默认助手）")}
            </span>
            <button
              type="button"
              onClick={() => setEditPromptOpen(true)}
              className="inline-flex items-center gap-1 text-primary hover:underline shrink-0"
              title="编辑系统提示词"
            >
              <Pencil className="h-3 w-3" />
              编辑
            </button>
            <Badge variant="outline" className="ml-2 font-normal text-[10px] py-0">
              {settings.model}
            </Badge>
            {(conversation.promptChanges?.length ?? 0) > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground shrink-0"
                    title="查看提示词变更历史"
                  >
                    <History className="h-3 w-3" />
                    历史 ({conversation.promptChanges!.length})
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-0">
                  <div className="px-3 py-2 border-b text-xs font-medium">
                    系统提示词变更历史
                  </div>
                  <ScrollArea className="max-h-72">
                    <ul className="p-2 space-y-2">
                      {conversation.promptChanges!.map((c) => (
                        <li
                          key={c.id}
                          className="text-xs border rounded-md p-2 space-y-1"
                        >
                          <div className="text-muted-foreground">
                            {formatChangeTime(c.at)}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium truncate max-w-[120px]">
                              {describePromptKind(c.fromKind, c.fromTitle)}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="font-medium truncate max-w-[120px]">
                              {describePromptKind(c.toKind, c.toTitle)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive shrink-0"
        >
          <Trash className="h-4 w-4 mr-1" />
          删除对话
        </Button>
      </header>

      <EditSystemPromptDialog
        open={editPromptOpen}
        onOpenChange={setEditPromptOpen}
        conversation={conversation}
        prompts={prompts}
        categories={categories}
        onSave={({ promptId, promptTitle, systemPrompt }) => {
          onUpdateConversation(conversation.id, (prev) => {
            const from = classifyPrompt(
              prev.promptId,
              prev.promptTitle,
              prev.systemPrompt,
            );
            const to = classifyPrompt(promptId, promptTitle, systemPrompt);
            const changed =
              from.kind !== to.kind ||
              from.title !== to.title ||
              prev.systemPrompt !== systemPrompt;
            const now = Date.now();
            const lastMsg =
              prev.messages.length > 0
                ? prev.messages[prev.messages.length - 1]
                : null;
            const nextChanges = changed
              ? [
                  ...(prev.promptChanges ?? []),
                  {
                    id: crypto.randomUUID(),
                    at: now,
                    fromKind: from.kind,
                    fromTitle: from.title,
                    toKind: to.kind,
                    toTitle: to.title,
                    afterMessageId: lastMsg?.id ?? null,
                  } satisfies PromptChange,
                ]
              : prev.promptChanges;
            return {
              ...prev,
              promptId,
              promptTitle,
              systemPrompt,
              updatedAt: now,
              promptChanges: nextChanges,
            };
          });
          toast.success("系统提示词已更新");
        }}
      />

      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="px-8 py-6 max-w-3xl mx-auto space-y-6">
          {conversation.messages.length === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 mx-auto">
                <BookOpen className="h-6 w-6 text-primary" />
              </div>
              <p className="font-medium">开始你的对话</p>
              <p className="text-sm mt-1">
                {conversation.promptTitle
                  ? `已使用「${conversation.promptTitle}」作为系统提示词`
                  : conversation.systemPrompt.trim()
                    ? "已使用自定义系统提示词"
                    : "未使用任何提示词作为系统提示"}
              </p>
            </div>
          )}

          {(conversation.promptChanges ?? [])
            .filter((c) => c.afterMessageId === null)
            .map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 text-[11px] text-muted-foreground"
                role="note"
                aria-label="系统提示词已更改"
              >
                <div className="flex-1 h-px bg-border" />
                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border bg-muted/40">
                  <BookOpen className="h-3 w-3" />
                  <span>系统提示词：</span>
                  <span className="font-medium text-foreground truncate max-w-[120px]">
                    {describePromptKind(c.fromKind, c.fromTitle)}
                  </span>
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-medium text-foreground truncate max-w-[120px]">
                    {describePromptKind(c.toKind, c.toTitle)}
                  </span>
                  <span className="text-muted-foreground">
                    · {formatChangeTime(c.at)}
                  </span>
                </div>
                <div className="flex-1 h-px bg-border" />
              </div>
            ))}

          <AnimatePresence initial={false}>
            {conversation.messages.map((m) => {
              const text = messageText(m.content);
              const images = messageImages(m.content);
              const empty = !text && images.length === 0;
              const changesAfter = (conversation.promptChanges ?? []).filter(
                (c) => c.afterMessageId === m.id,
              );
              return (
                <div key={m.id} className="space-y-6">
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className={
                      m.role === "user"
                        ? "flex justify-end group/msg"
                        : "flex justify-start group/msg"
                    }
                  >
                    <div className="max-w-[85%] flex flex-col gap-1.5 items-stretch">
                      <div
                        className={
                          m.role === "user"
                            ? "rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-3 text-sm leading-relaxed shadow-sm space-y-2"
                            : "rounded-2xl rounded-bl-sm bg-card border px-4 py-3 text-sm leading-relaxed shadow-sm space-y-2"
                        }
                      >
                        {empty ? (
                          <span className="inline-flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> 思考中…
                          </span>
                        ) : (
                          <>
                            {images.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {images.map((src, i) => (
                                  <ChatImage
                                    key={i}
                                    src={src}
                                    className="max-h-64 max-w-full rounded-md border border-white/10"
                                  />
                                ))}
                              </div>
                            )}
                            {text && (
                              m.role === "assistant" ? (
                                <MarkdownMessage content={text} />
                              ) : (
                                <div className="whitespace-pre-wrap">{text}</div>
                              )
                            )}
                          </>
                        )}
                      </div>
                      {m.role === "assistant" && !empty && (
                        <div className="flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopyMessage(m)}
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                            title="复制整条回复"
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            复制
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRegenerate(m.id)}
                            disabled={isStreaming}
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                            title="使用此前对话重新生成"
                          >
                            <RefreshCw className="h-3 w-3 mr-1" />
                            重新生成
                          </Button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                  {changesAfter.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 text-[11px] text-muted-foreground"
                      role="note"
                      aria-label="系统提示词已更改"
                    >
                      <div className="flex-1 h-px bg-border" />
                      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border bg-muted/40">
                        <BookOpen className="h-3 w-3" />
                        <span>系统提示词：</span>
                        <span className="font-medium text-foreground truncate max-w-[120px]">
                          {describePromptKind(c.fromKind, c.fromTitle)}
                        </span>
                        <ArrowRight className="h-3 w-3" />
                        <span className="font-medium text-foreground truncate max-w-[120px]">
                          {describePromptKind(c.toKind, c.toTitle)}
                        </span>
                        <span className="text-muted-foreground">
                          · {formatChangeTime(c.at)}
                        </span>
                      </div>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  ))}
                </div>
              );
            })}
          </AnimatePresence>
        </div>
      </ScrollArea>

      <div className="border-t bg-card/50 backdrop-blur px-8 py-4">
        <div className="max-w-3xl mx-auto">
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {pendingImages.map((src, i) => (
                <div key={i} className="relative group">
                  <img
                    src={src}
                    className="h-16 w-16 object-cover rounded-md border"
                    alt=""
                  />
                  <button
                    type="button"
                    onClick={() => removePendingImage(i)}
                    className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-background border shadow-sm flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
                    title="移除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div
            className="relative rounded-2xl border bg-background shadow-sm flex flex-col overflow-hidden"
            style={{ height: composerHeight }}
          >
            <div
              onPointerDown={onResizeStart}
              className="absolute top-0 left-0 right-0 h-3 cursor-ns-resize flex items-center justify-center group z-10"
              title="拖拽调整高度"
            >
              <GripHorizontal className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
            </div>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行（可粘贴或上传图片，可拖拽顶部边缘调整高度）"
              className="flex-1 resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none bg-transparent rounded-none pt-4 px-3"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={handleFilePicked}
            />
            <div className="flex items-center justify-between px-2 py-2 border-t bg-background/60">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                className="h-9 w-9 rounded-full"
                title="上传图片"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              {isStreaming ? (
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={handleStop}
                  className="h-7 w-8 rounded-md"
                  title="停止"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!input.trim() && pendingImages.length === 0}
                  className="h-7 w-8 rounded-md"
                  title="发送"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
