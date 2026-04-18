import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { Prompt, Category } from "@/lib/store";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompts: Prompt[];
  categories: Category[];
  onStart: (params: {
    promptId: string | null;
    promptTitle: string | null;
    systemPrompt: string;
  }) => void;
};

export function NewChatDialog({
  open,
  onOpenChange,
  prompts,
  categories,
  onStart,
}: Props) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q),
    );
  }, [prompts, search]);

  const handleStart = (mode: "with-prompt" | "blank") => {
    if (mode === "blank") {
      onStart({
        promptId: null,
        promptTitle: null,
        systemPrompt: "",
      });
      reset();
      return;
    }
    const prompt = prompts.find((p) => p.id === selectedId);
    if (!prompt) return;
    onStart({
      promptId: prompt.id,
      promptTitle: prompt.title,
      systemPrompt: prompt.content,
    });
    reset();
  };

  const reset = () => {
    setSearch("");
    setSelectedId(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-[640px] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>开始新对话</DialogTitle>
          <DialogDescription>
            选择一个提示词作为系统提示，或开启一个空白对话。
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索提示词..."
              className="pl-8"
            />
          </div>
        </div>

        <ScrollArea className="h-[360px] px-6">
          <div className="space-y-2 pb-4">
            {filtered.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-12">
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
                    onClick={() => setSelectedId(p.id)}
                    onDoubleClick={() => {
                      setSelectedId(p.id);
                      handleStart("with-prompt");
                    }}
                    className={
                      "w-full text-left p-3 rounded-lg border transition-all flex gap-3 " +
                      (active
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border hover:border-primary/30 hover:bg-muted/40")
                    }
                  >
                    <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
                      <BookOpen className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium truncate">{p.title}</div>
                        {cat && (
                          <Badge
                            variant="outline"
                            className="font-normal text-[10px] py-0"
                          >
                            {cat.name}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                        {p.content}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t bg-muted/30 gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => handleStart("blank")}>
            空白对话
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              onClick={() => handleStart("with-prompt")}
              disabled={!selectedId}
            >
              开始对话
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
