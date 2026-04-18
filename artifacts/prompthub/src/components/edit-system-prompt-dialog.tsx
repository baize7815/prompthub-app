import { useEffect, useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { Prompt, Category, Conversation } from "@/lib/store";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: Conversation;
  prompts: Prompt[];
  categories: Category[];
  onSave: (params: {
    promptId: string | null;
    promptTitle: string | null;
    systemPrompt: string;
  }) => void;
};

export function EditSystemPromptDialog({
  open,
  onOpenChange,
  conversation,
  prompts,
  categories,
  onSave,
}: Props) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    conversation.promptId,
  );
  const [text, setText] = useState(conversation.systemPrompt);
  const [touched, setTouched] = useState(false);

  // Reset when opening with a different conversation
  useEffect(() => {
    if (open) {
      setSelectedId(conversation.promptId);
      setText(conversation.systemPrompt);
      setSearch("");
      setTouched(false);
    }
  }, [open, conversation.id, conversation.promptId, conversation.systemPrompt]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q),
    );
  }, [prompts, search]);

  const handlePick = (p: Prompt) => {
    setSelectedId(p.id);
    setText(p.content);
    setTouched(true);
  };

  const handleClear = () => {
    setSelectedId(null);
    setText("");
    setTouched(true);
  };

  const handleSave = () => {
    const trimmed = text.trim();
    const matchedPrompt =
      selectedId !== null
        ? prompts.find((p) => p.id === selectedId) ?? null
        : null;
    // If user edited the text away from the picked prompt's content, treat it
    // as a custom system prompt and drop the link to the saved prompt.
    const stillMatches =
      matchedPrompt !== null && matchedPrompt.content === trimmed;
    onSave({
      promptId: stillMatches ? matchedPrompt!.id : null,
      promptTitle: stillMatches ? matchedPrompt!.title : null,
      systemPrompt: trimmed,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>编辑系统提示词</DialogTitle>
          <DialogDescription>
            选择另一个已保存的提示词，或直接修改当前文本。后续消息将使用新的系统提示，已有对话保持不变。
          </DialogDescription>
        </DialogHeader>

        <div className="grid sm:grid-cols-[260px_1fr] gap-0 border-t">
          <div className="border-r flex flex-col min-h-[360px]">
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索提示词..."
                  className="pl-8 h-9"
                />
              </div>
            </div>
            <ScrollArea className="flex-1 h-[320px]">
              <div className="p-2 space-y-1">
                <button
                  type="button"
                  onClick={handleClear}
                  className={
                    "w-full text-left p-2 rounded-md border text-sm transition-colors " +
                    (selectedId === null && text === ""
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:bg-muted/60")
                  }
                >
                  <div className="font-medium">无（默认助手）</div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    清空系统提示词
                  </p>
                </button>
                {filtered.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-8">
                    没有匹配的提示词
                  </div>
                ) : (
                  filtered.map((p) => {
                    const cat = categories.find((c) => c.id === p.categoryId);
                    const active = selectedId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handlePick(p)}
                        className={
                          "w-full text-left p-2 rounded-md border text-sm transition-colors flex gap-2 " +
                          (active
                            ? "border-primary bg-primary/5"
                            : "border-transparent hover:bg-muted/60")
                        }
                      >
                        <BookOpen className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium truncate">
                              {p.title}
                            </div>
                            {cat && (
                              <Badge
                                variant="outline"
                                className="font-normal text-[10px] py-0"
                              >
                                {cat.name}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">
                            {p.content}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="p-4 flex flex-col gap-2 min-h-[360px]">
            <label className="text-xs font-medium text-muted-foreground">
              系统提示词内容
            </label>
            <Textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setTouched(true);
              }}
              placeholder="留空表示不使用系统提示"
              className="flex-1 min-h-[280px] resize-none font-mono text-xs leading-relaxed"
            />
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-muted/30">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !touched && text === conversation.systemPrompt &&
              selectedId === conversation.promptId
            }
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
