import { Archive, ArchiveRestore, ArrowDown, ArrowUp, ArrowUpDown, BookOpen, ChevronDown, ChevronRight, Copy, Edit, LayoutGrid, LayoutList, Library, Lock, LogOut, MoreHorizontal, Palette, Plus, Search, Settings, Trash, MessageSquare, X, Check } from "lucide-react";
import { PaintingPanel } from "@/components/painting-panel";
import { usePromptStore } from "../lib/store";
import { useAutoBackup } from "../lib/auto-backup";
import { useState, useMemo, useEffect } from "react";
import { ChatPanel } from "@/components/chat-panel";
import { NewChatDialog } from "@/components/new-chat-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { LoginDialog } from "@/components/login-dialog";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";

type SortKey = "title" | "category" | "updatedAt" | "usageCount";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = {
  updatedAt: "更新时间",
  title: "标题",
  category: "分类",
  usageCount: "使用次数",
};

function formatUsageFooter(usageCount: number, lastUsedAt: number | null): string {
  const count = usageCount ?? 0;
  if (count === 0 || !lastUsedAt) return "尚未被 AI 调用";
  const when = formatDistanceToNow(lastUsedAt, { addSuffix: true, locale: zhCN });
  return `已使用 ${count} 次 · 最近 ${when}`;
}

export default function Home() {
  const store = usePromptStore();
  const autoBackup = useAutoBackup({
    isLoaded: store.isLoaded,
    exportLibrary: store.exportLibrary,
    onBackupCreated: (result) => {
      if (result.snapshot) {
        toast.success(
          `已自动备份 ${result.snapshot.promptCount} 条提示词`,
          { duration: 2500 },
        );
      }
    },
  });
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"card" | "list">("card");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [view, setView] = useState<"library" | "chat" | "painting">("library");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activePaintingId, setActivePaintingId] = useState<string | null>(null);
  const [deletePaintingId, setDeletePaintingId] = useState<string | null>(null);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const isOwner = store.auth.isOwner;
  const [conversationSearch, setConversationSearch] = useState("");
  const [deleteConversationId, setDeleteConversationId] = useState<string | null>(null);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [clearArchiveOpen, setClearArchiveOpen] = useState(false);

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      toast.error("分类名称不能为空");
      return;
    }
    if (store.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      toast.error("分类名称已存在");
      return;
    }
    setCreatingCategory(true);
    try {
      await store.createCategory(name);
      toast.success("分类已创建");
      setNewCategoryName("");
      setIsCategoryDialogOpen(false);
    } catch {
      toast.error("创建分类失败");
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCategoryId) return;
    const id = deleteCategoryId;
    setDeleteCategoryId(null);
    try {
      await store.deleteCategory(id);
      if (activeCategory === id) setActiveCategory("all");
      toast.success("分类已删除");
    } catch {
      toast.error("删除分类失败");
    }
  };

  const activeConversation = useMemo(
    () => store.conversations.find(c => c.id === activeConversationId) ?? null,
    [store.conversations, activeConversationId],
  );

  const { activeConversations, archivedConversations } = useMemo(() => {
    const q = conversationSearch.trim().toLowerCase();
    const matches = (c: typeof store.conversations[number]) =>
      !q ||
      c.title.toLowerCase().includes(q) ||
      (c.promptTitle?.toLowerCase().includes(q) ?? false);
    const active: typeof store.conversations = [];
    const archived: typeof store.conversations = [];
    for (const c of store.conversations) {
      if (!matches(c)) continue;
      if (c.archived) archived.push(c);
      else active.push(c);
    }
    return { activeConversations: active, archivedConversations: archived };
  }, [store.conversations, conversationSearch]);

  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "updatedAt" ? "desc" : "asc");
    }
  };

  const filteredPrompts = useMemo(() => {
    const filtered = store.prompts.filter(p => {
      const matchSearch = p.title.toLowerCase().includes(search.toLowerCase()) || p.content.toLowerCase().includes(search.toLowerCase());
      const matchCategory = activeCategory === "all" || p.categoryId === activeCategory;
      return matchSearch && matchCategory;
    });
    const catName = (id: string | null) =>
      id ? (store.categories.find(c => c.id === id)?.name || "") : "";
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "title") cmp = a.title.localeCompare(b.title, "zh-CN");
      else if (sortKey === "category") cmp = catName(a.categoryId).localeCompare(catName(b.categoryId), "zh-CN");
      else if (sortKey === "usageCount") cmp = (a.usageCount ?? 0) - (b.usageCount ?? 0);
      else cmp = a.updatedAt - b.updatedAt;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [store.prompts, store.categories, search, activeCategory, sortKey, sortDir]);

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 ml-1 inline opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 ml-1 inline text-primary" />
      : <ArrowDown className="h-3 w-3 ml-1 inline text-primary" />;
  };

  const handleCopy = (content: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigator.clipboard.writeText(content);
    toast.success("已复制到剪贴板");
  };

  const handleNotImplemented = () => {
    toast.info("此功能即将上线");
  };

  const handleLogout = async () => {
    await store.logout();
    toast.success("已退出登录");
  };

  const handleStartChatWithPrompt = (
    prompt: { id: string; title: string; content: string },
    e?: React.MouseEvent,
  ) => {
    e?.stopPropagation();
    const conv = store.createConversation({
      promptId: prompt.id,
      promptTitle: prompt.title,
      systemPrompt: prompt.content,
    });
    setActiveConversationId(conv.id);
    setView("chat");
    setSheetOpen(false);
    toast.success(`已使用「${prompt.title}」开始新对话`);
  };

  if (!store.isLoaded) return null;

  const libraryView = (
    <>
      <header className="px-8 py-6 border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">我的提示词库</h1>
            <p className="text-muted-foreground mt-1">
              {isOwner
                ? "管理你的 AI 提示词，随时调用"
                : "只读模式：登录后才能新建、编辑或删除提示词"}
            </p>
          </div>
          <div className="shrink-0">
            {isOwner ? (
              <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1.5">
                <LogOut className="h-3.5 w-3.5" />
                退出登录
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setIsLoginOpen(true)} className="gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                管理员登录
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="搜索提示词..."
                  className="pl-8 bg-card shadow-sm"
                />
              </div>
              <div className="flex items-center border rounded-md bg-card p-1 shadow-sm">
                <Button variant={viewMode === 'card' ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7 rounded-sm" onClick={() => setViewMode('card')}>
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7 rounded-sm" onClick={() => setViewMode('list')}>
                  <LayoutList className="h-4 w-4" />
                </Button>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="bg-card shadow-sm gap-1.5 h-9">
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    <span className="text-xs">按{SORT_LABELS[sortKey]}排序</span>
                    {sortDir === "asc"
                      ? <ArrowUp className="h-3 w-3 opacity-60" />
                      : <ArrowDown className="h-3 w-3 opacity-60" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                    <DropdownMenuItem
                      key={k}
                      onClick={() => toggleSort(k)}
                      className="flex items-center justify-between"
                    >
                      <span>按{SORT_LABELS[k]}排序</span>
                      {sortKey === k && (
                        sortDir === "asc"
                          ? <ArrowUp className="h-3 w-3 text-primary" />
                          : <ArrowDown className="h-3 w-3 text-primary" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {isOwner ? (
              <Button onClick={() => setIsCreateOpen(true)} className="shadow-sm">
                <Plus className="h-4 w-4 mr-2" />
                新建提示词
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setIsLoginOpen(true)} className="shadow-sm gap-2">
                <Lock className="h-4 w-4" />
                登录以管理
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge
              variant={activeCategory === 'all' ? 'default' : 'secondary'}
              className="cursor-pointer px-3 py-1 text-sm font-medium hover:bg-primary/90 transition-colors"
              onClick={() => setActiveCategory('all')}
            >
              全部
            </Badge>
            {store.categories.map(c => (
              <ContextMenu key={c.id}>
                <ContextMenuTrigger asChild>
                  <Badge
                    variant={activeCategory === c.id ? 'default' : 'secondary'}
                    className="cursor-pointer px-3 py-1 text-sm font-medium hover:bg-primary/90 transition-colors"
                    onClick={() => setActiveCategory(c.id)}
                  >
                    {c.name}
                  </Badge>
                </ContextMenuTrigger>
                {isOwner && (
                  <ContextMenuContent>
                    <ContextMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setDeleteCategoryId(c.id)}
                    >
                      <Trash className="h-4 w-4 mr-2" />
                      删除分类
                    </ContextMenuItem>
                  </ContextMenuContent>
                )}
              </ContextMenu>
            ))}
            {isOwner && (
              <Badge
                variant="outline"
                className="cursor-pointer px-3 py-1 text-sm font-medium border-dashed text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setNewCategoryName("");
                  setIsCategoryDialogOpen(true);
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                新建分类
              </Badge>
            )}
          </div>

          {filteredPrompts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center border rounded-xl bg-card/30 border-dashed mt-8">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <BookOpen className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-medium mb-2">没有找到提示词</h3>
              <p className="text-muted-foreground mb-6 max-w-sm">
                {search || activeCategory !== 'all'
                  ? "尝试调整搜索关键词或分类过滤条件。"
                  : "你还没有创建任何提示词，开始建立你的私人提示词库吧。"}
              </p>
              {!(search || activeCategory !== 'all') && isOwner && (
                <Button onClick={() => setIsCreateOpen(true)}>
                  立即创建第一个提示词
                </Button>
              )}
            </div>
          ) : viewMode === 'card' ? (
            <motion.div
              layout
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            >
              <AnimatePresence>
                {filteredPrompts.map((prompt) => (
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    key={prompt.id}
                    onClick={() => {
                      setSelectedPromptId(prompt.id);
                      setSheetOpen(true);
                    }}
                    className="group cursor-pointer bg-card border rounded-xl p-5 hover:shadow-md transition-all duration-200 hover:border-primary/30 flex flex-col min-h-[200px] overflow-hidden min-w-0"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
                          <BookOpen className="h-4 w-4" />
                        </div>
                        <h3 className="font-semibold text-base line-clamp-1" title={prompt.title}>{prompt.title}</h3>
                      </div>
                      <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={(e) => handleCopy(prompt.content, e)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        {isOwner && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditingPromptId(prompt.id); setIsCreateOpen(true); }}>
                                <Edit className="h-4 w-4 mr-2" /> 编辑
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteId(prompt.id); }}>
                                <Trash className="h-4 w-4 mr-2" /> 删除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>

                    <div className="mb-auto">
                      <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed break-all">
                        {prompt.content}
                      </p>
                    </div>

                    <div className="mt-3 text-[11px] text-muted-foreground/80 truncate" title={formatUsageFooter(prompt.usageCount, prompt.lastUsedAt)}>
                      {formatUsageFooter(prompt.usageCount, prompt.lastUsedAt)}
                    </div>

                    <div className="mt-3 pt-3 border-t flex justify-between items-center gap-2 text-xs text-muted-foreground min-w-0">
                      <span className="min-w-0 flex-1 truncate">
                        {prompt.categoryId
                          ? (store.categories.find(c => c.id === prompt.categoryId)?.name || '未分类')
                          : '未分类'}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-3 shrink-0 text-xs gap-1"
                        onClick={(e) => handleStartChatWithPrompt(prompt, e)}
                      >
                        <MessageSquare className="h-3 w-3" />
                        开始对话
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          ) : (
            <div className="border rounded-xl bg-card overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground bg-muted/30 border-b">
                  <tr>
                    <th className="px-6 py-3 font-medium select-none cursor-pointer hover:text-foreground transition-colors" onClick={() => toggleSort("title")}>
                      标题<SortIcon k="title" />
                    </th>
                    <th className="px-6 py-3 font-medium">内容预览</th>
                    <th className="px-6 py-3 font-medium select-none cursor-pointer hover:text-foreground transition-colors" onClick={() => toggleSort("category")}>
                      分类<SortIcon k="category" />
                    </th>
                    <th className="px-6 py-3 font-medium whitespace-nowrap">创建时间</th>
                    <th className="px-6 py-3 font-medium select-none cursor-pointer hover:text-foreground transition-colors whitespace-nowrap" onClick={() => toggleSort("updatedAt")}>
                      更新时间<SortIcon k="updatedAt" />
                    </th>
                    <th className="px-6 py-3 font-medium select-none cursor-pointer hover:text-foreground transition-colors whitespace-nowrap" onClick={() => toggleSort("usageCount")}>
                      使用次数<SortIcon k="usageCount" />
                    </th>
                    <th className="px-6 py-3 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPrompts.map(prompt => (
                    <tr
                      key={prompt.id}
                      onClick={() => { setSelectedPromptId(prompt.id); setSheetOpen(true); }}
                      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-4 font-medium">{prompt.title}</td>
                      <td className="px-6 py-4 text-muted-foreground max-w-xs truncate">{prompt.content}</td>
                      <td className="px-6 py-4">
                        {prompt.categoryId ? (
                          <Badge variant="secondary" className="font-normal text-xs">
                            {store.categories.find(c => c.id === prompt.categoryId)?.name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">未分类</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs whitespace-nowrap">
                        {formatDistanceToNow(prompt.createdAt, { addSuffix: true, locale: zhCN })}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs whitespace-nowrap">
                        {formatDistanceToNow(prompt.updatedAt, { addSuffix: true, locale: zhCN })}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs whitespace-nowrap" title={prompt.lastUsedAt ? `最近 ${formatDistanceToNow(prompt.lastUsedAt, { addSuffix: true, locale: zhCN })}` : "尚未被 AI 调用"}>
                        {(prompt.usageCount ?? 0) === 0 ? "—" : `${prompt.usageCount} 次`}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => handleCopy(prompt.content, e)}>
                            <Copy className="h-4 w-4" />
                          </Button>
                          {isOwner && (
                            <>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); setEditingPromptId(prompt.id); setIsCreateOpen(true); }}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); setDeleteId(prompt.id); }}>
                                <Trash className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[260px] flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="p-4 flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg text-sidebar-foreground">PromptHub</span>
        </div>

        <div className="px-4 pb-3 grid grid-cols-2 gap-2">
          <Button onClick={() => setIsNewChatOpen(true)} className="w-full justify-center gap-1.5 shadow-sm" variant="default">
            <Plus className="h-4 w-4" />
            新对话
          </Button>
          <Button
            onClick={() => {
              setActivePaintingId(null);
              setView("painting");
              setActiveConversationId(null);
            }}
            className="w-full justify-center gap-1.5 shadow-sm bg-purple-600 hover:bg-purple-500 text-white"
          >
            <Palette className="h-4 w-4" />
            新绘画
          </Button>
        </div>

        <div className="px-4 pb-3">
          <Button
            onClick={() => { setView("library"); setActiveConversationId(null); setActivePaintingId(null); }}
            variant="ghost"
            className={
              "w-full justify-start gap-2 hover:bg-white/5 " +
              (view === "library"
                ? "bg-white/10 text-sidebar-foreground"
                : "text-sidebar-foreground/70 hover:text-sidebar-foreground")
            }
          >
            <Library className="h-4 w-4" />
            提示词库
          </Button>
        </div>

        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-sidebar-foreground/60" />
            <Input
              value={conversationSearch}
              onChange={(e) => setConversationSearch(e.target.value)}
              placeholder="搜索对话..."
              className="pl-8 bg-white/5 border-white/10 text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus-visible:border-primary"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 px-2">
          {store.paintings.length > 0 && (
            <div className="space-y-1 pb-2">
              <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-sidebar-foreground/40">
                绘画
              </div>
              {store.paintings.map((p) => {
                const active = view === "painting" && activePaintingId === p.id;
                return (
                  <ContextMenu key={p.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        onClick={() => {
                          setActivePaintingId(p.id);
                          setView("painting");
                          setActiveConversationId(null);
                        }}
                        className={
                          "group px-3 py-2 rounded-md cursor-pointer flex items-start gap-2 transition-colors " +
                          (active ? "bg-white/10" : "hover:bg-white/5")
                        }
                      >
                        <Palette className="h-4 w-4 mt-0.5 shrink-0 text-purple-400" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-sidebar-foreground truncate">
                            {p.title}
                          </div>
                          <div className="text-[11px] text-sidebar-foreground/50 truncate mt-0.5">
                            {p.status === "generating"
                              ? "生成中..."
                              : p.status === "error"
                                ? "失败"
                                : `${p.results.length} 张图片`}
                          </div>
                        </div>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setDeletePaintingId(p.id)}
                      >
                        <Trash className="h-4 w-4 mr-2" /> 删除绘画
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
              <div className="border-t border-sidebar-border/50 mx-3 my-2" />
            </div>
          )}
          {activeConversations.length === 0 && archivedConversations.length === 0 ? (
            <div className="p-4 text-sm text-sidebar-foreground/60 text-center">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
              {store.conversations.length === 0 ? "暂无对话" : "没有匹配的对话"}
            </div>
          ) : (
            <div className="space-y-1 pb-2">
              {activeConversations.map(c => {
                const active = view === "chat" && activeConversationId === c.id;
                return (
                  <ContextMenu key={c.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        onClick={() => { setActiveConversationId(c.id); setView("chat"); }}
                        className={
                          "group px-3 py-2 rounded-md cursor-pointer flex items-start gap-2 transition-colors " +
                          (active ? "bg-white/10" : "hover:bg-white/5")
                        }
                      >
                        <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-sidebar-foreground/60" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-sidebar-foreground truncate">
                            {c.title}
                          </div>
                          <div className="text-[11px] text-sidebar-foreground/50 truncate mt-0.5">
                            {c.promptTitle
                              ? `📌 ${c.promptTitle}`
                              : c.systemPrompt.trim()
                                ? "📌 自定义提示词"
                                : "空白对话"}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 text-sidebar-foreground/60 hover:text-destructive hover:bg-white/5"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConversationId(c.id);
                          }}
                        >
                          <Trash className="h-3 w-3" />
                        </Button>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onSelect={() => {
                          store.updateConversation(c.id, (prev) => ({ ...prev, archived: true }));
                          if (activeConversationId === c.id) {
                            setActiveConversationId(null);
                            setView("library");
                          }
                          setArchiveOpen(true);
                          toast.success("对话已归档");
                        }}
                      >
                        <Archive className="h-4 w-4 mr-2" /> 归档
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setDeleteConversationId(c.id)}
                      >
                        <Trash className="h-4 w-4 mr-2" /> 删除对话
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}

              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setArchiveOpen((v) => !v)}
                    className="w-full mt-2 px-3 py-2 rounded-md flex items-center gap-2 text-sidebar-foreground/70 hover:bg-white/5 hover:text-sidebar-foreground transition-colors"
                  >
                    {archiveOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    <Archive className="h-4 w-4" />
                    <span className="text-sm flex-1 text-left">归档</span>
                    <span className="text-[11px] text-sidebar-foreground/50">
                      {archivedConversations.length}
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    disabled={archivedConversations.length === 0}
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setClearArchiveOpen(true)}
                  >
                    <Trash className="h-4 w-4 mr-2" /> 清空归档（{archivedConversations.length}）
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>

              {archiveOpen && archivedConversations.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-sidebar-foreground/40 text-center">
                  归档为空
                </div>
              )}
              {archiveOpen && archivedConversations.map(c => {
                const active = view === "chat" && activeConversationId === c.id;
                return (
                  <ContextMenu key={c.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        onClick={() => { setActiveConversationId(c.id); setView("chat"); }}
                        className={
                          "group ml-4 px-3 py-1.5 rounded-md cursor-pointer flex items-start gap-2 transition-colors " +
                          (active ? "bg-white/10" : "hover:bg-white/5")
                        }
                      >
                        <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-sidebar-foreground/40" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-sidebar-foreground/80 truncate">
                            {c.title}
                          </div>
                        </div>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onSelect={() => {
                          store.updateConversation(c.id, (prev) => ({ ...prev, archived: false }));
                          toast.success("已取消归档");
                        }}
                      >
                        <ArchiveRestore className="h-4 w-4 mr-2" /> 取消归档
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setDeleteConversationId(c.id)}
                      >
                        <Trash className="h-4 w-4 mr-2" /> 删除对话
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <div className="p-4 border-t border-sidebar-border">
          <Button
            onClick={() => setIsSettingsOpen(true)}
            variant="ghost"
            className="w-full justify-start gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-white/5"
          >
            <Settings className="h-4 w-4" />
            设置
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {view === "chat" && activeConversation ? (
          <ChatPanel
            conversation={activeConversation}
            settings={store.settings}
            prompts={store.prompts}
            categories={store.categories}
            onUpdateConversation={store.updateConversation}
            onDelete={() => setDeleteConversationId(activeConversation.id)}
          />
        ) : view === "painting" ? (
          <PaintingPanel
            painting={
              activePaintingId
                ? store.paintings.find((p) => p.id === activePaintingId) ?? null
                : null
            }
            settings={store.settings}
            onCreate={store.createPainting}
            onUpdate={store.updatePainting}
            onSelect={setActivePaintingId}
            onDelete={(id) => setDeletePaintingId(id)}
          />
        ) : (
          libraryView
        )}
      </main>

      {/* Detail Drawer with inline editing */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { setSheetOpen(open); }}>
        <SheetContent className="w-[400px] sm:w-[600px] border-l sm:max-w-xl p-0 flex flex-col">
          {selectedPromptId && (
            <PromptDetail
              key={selectedPromptId}
              promptId={selectedPromptId}
              store={store}
              onClose={() => setSheetOpen(false)}
              onCopy={handleCopy}
              onDelete={() => {
                setSheetOpen(false);
                setDeleteId(selectedPromptId);
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Create/Edit Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => {
        setIsCreateOpen(open);
        if (!open) setTimeout(() => setEditingPromptId(null), 200);
      }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingPromptId ? '编辑提示词' : '新建提示词'}</DialogTitle>
          </DialogHeader>
          <PromptForm
            store={store}
            promptId={editingPromptId}
            onClose={() => setIsCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除提示词？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作无法撤销。该提示词将从你的提示词库中永久删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deleteId) {
                store.deletePrompt(deleteId)
                  .then(() => toast.success("提示词已删除"))
                  .catch(() => { /* toast handled in store */ });
                setDeleteId(null);
                if (selectedPromptId === deleteId) {
                  setSheetOpen(false);
                }
              }
            }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Category */}
      <Dialog open={isCategoryDialogOpen} onOpenChange={(open) => {
        setIsCategoryDialogOpen(open);
        if (!open) setNewCategoryName("");
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建分类</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">分类名称</label>
            <Input
              autoFocus
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !creatingCategory) {
                  e.preventDefault();
                  handleCreateCategory();
                }
              }}
              placeholder="例如：翻译助手"
              maxLength={30}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCategoryDialogOpen(false)} disabled={creatingCategory}>
              取消
            </Button>
            <Button onClick={handleCreateCategory} disabled={creatingCategory}>
              {creatingCategory ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Category Confirmation */}
      <AlertDialog open={!!deleteCategoryId} onOpenChange={(open) => !open && setDeleteCategoryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除分类？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作无法撤销。该分类将被删除，分类下的提示词不会被删除，将变为「未分类」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCategory}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NewChatDialog
        open={isNewChatOpen}
        onOpenChange={setIsNewChatOpen}
        prompts={store.prompts}
        categories={store.categories}
        onStart={(params) => {
          const conv = store.createConversation(params);
          setActiveConversationId(conv.id);
          setView("chat");
          setIsNewChatOpen(false);
        }}
      />

      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        settings={store.settings}
        onSave={store.saveSettings}
        store={store}
        autoBackup={autoBackup}
      />

      <LoginDialog
        open={isLoginOpen}
        onOpenChange={setIsLoginOpen}
        ownerEnabled={store.auth.ownerEnabled}
        onLogin={store.login}
      />

      <AlertDialog open={!!deletePaintingId} onOpenChange={(open) => !open && setDeletePaintingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除绘画？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作无法撤销。该绘画及其全部生成结果将被永久删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deletePaintingId) {
                store.deletePainting(deletePaintingId);
                if (activePaintingId === deletePaintingId) {
                  setActivePaintingId(null);
                }
                toast.success("绘画已删除");
                setDeletePaintingId(null);
              }
            }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteConversationId} onOpenChange={(open) => !open && setDeleteConversationId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除对话？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作无法撤销。该对话及其全部消息将被永久删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deleteConversationId) {
                store.deleteConversation(deleteConversationId);
                if (activeConversationId === deleteConversationId) {
                  setActiveConversationId(null);
                  setView("library");
                }
                toast.success("对话已删除");
                setDeleteConversationId(null);
              }
            }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearArchiveOpen} onOpenChange={setClearArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空归档？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除归档文件夹中的全部 {archivedConversations.length} 个对话，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // Always clear ALL archived conversations, ignoring the
                // current search filter — the user's intent is "empty the
                // archive folder".
                const allArchivedIds = store.conversations
                  .filter((c) => c.archived)
                  .map((c) => c.id);
                if (
                  activeConversationId &&
                  allArchivedIds.includes(activeConversationId)
                ) {
                  setActiveConversationId(null);
                  setView("library");
                }
                store.deleteConversations(allArchivedIds);
                toast.success(`已清空 ${allArchivedIds.length} 个归档对话`);
                setClearArchiveOpen(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PromptForm({ store, promptId, onClose }: { store: ReturnType<typeof usePromptStore>, promptId: string | null, onClose: () => void }) {
  const existing = promptId ? store.prompts.find(p => p.id === promptId) : null;
  const [title, setTitle] = useState(existing?.title || "");
  const [content, setContent] = useState(existing?.content || "");
  const [categoryId, setCategoryId] = useState<string>(existing?.categoryId || "none");
  const [newCatName, setNewCatName] = useState("");
  const [isCreatingCat, setIsCreatingCat] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("标题和内容不能为空");
      return;
    }

    let finalCategoryId = categoryId === "none" ? null : categoryId;

    try {
      if (categoryId === "new") {
        if (!newCatName.trim()) {
          toast.error("分类名称不能为空");
          return;
        }
        const cat = await store.createCategory(newCatName.trim());
        finalCategoryId = cat.id;
      }

      if (promptId) {
        await store.updatePrompt(promptId, { title, content, categoryId: finalCategoryId });
        toast.success("提示词已更新");
      } else {
        await store.createPrompt({ title, content, categoryId: finalCategoryId });
        toast.success("提示词已创建");
      }
      onClose();
    } catch {
      // error toast is shown by the store; nothing else to do here
    }
  };

  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">标题</label>
        <Input placeholder="输入提示词标题" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">分类</label>
        <Select value={categoryId} onValueChange={(val) => {
          setCategoryId(val);
          setIsCreatingCat(val === "new");
        }}>
          <SelectTrigger>
            <SelectValue placeholder="选择分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">未分类</SelectItem>
            {store.categories.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
            <SelectItem value="new" className="text-primary font-medium border-t rounded-none mt-1 pt-2">
              + 新建分类...
            </SelectItem>
          </SelectContent>
        </Select>
        {isCreatingCat && (
          <Input
            className="mt-2"
            placeholder="输入新分类名称"
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
          />
        )}
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">内容</label>
        <Textarea
          placeholder="输入提示词内容..."
          className="min-h-[200px] resize-y"
          value={content}
          onChange={e => setContent(e.target.value)}
        />
      </div>
      <DialogFooter className="pt-4">
        <Button variant="outline" onClick={onClose}>取消</Button>
        <Button onClick={handleSubmit}>保存</Button>
      </DialogFooter>
    </div>
  );
}

function PromptDetail({
  promptId,
  store,
  onClose,
  onCopy,
  onDelete,
}: {
  promptId: string;
  store: ReturnType<typeof usePromptStore>;
  onClose: () => void;
  onCopy: (content: string) => void;
  onDelete: () => void;
}) {
  const isOwner = store.auth.isOwner;
  const prompt = store.prompts.find(p => p.id === promptId);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(prompt?.title ?? "");
  const [draftContent, setDraftContent] = useState(prompt?.content ?? "");

  useEffect(() => {
    if (prompt) {
      setDraftTitle(prompt.title);
      setDraftContent(prompt.content);
    }
  }, [prompt?.id]);

  if (!prompt) return null;

  const handleSave = () => {
    if (!draftTitle.trim() || !draftContent.trim()) {
      toast.error("标题和内容不能为空");
      return;
    }
    store.updatePrompt(prompt.id, { title: draftTitle.trim(), content: draftContent.trim() })
      .then(() => {
        toast.success("提示词已更新");
        setIsEditing(false);
      })
      .catch(() => { /* error toast handled in store; keep editor open */ });
  };

  const handleCancel = () => {
    setDraftTitle(prompt.title);
    setDraftContent(prompt.content);
    setIsEditing(false);
  };

  return (
    <>
      <div className="p-6 border-b bg-card/50">
        <div className="flex justify-between items-start gap-4 mb-3">
          {isEditing ? (
            <Input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="text-lg font-bold h-10"
              placeholder="提示词标题"
              autoFocus
            />
          ) : (
            <SheetTitle className="text-xl font-bold">{prompt.title}</SheetTitle>
          )}
          {!isEditing && isOwner && (
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              <Edit className="h-4 w-4 mr-2" /> 编辑
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {prompt.categoryId && (
            <Badge variant="secondary" className="font-normal text-xs">
              {store.categories.find(c => c.id === prompt.categoryId)?.name}
            </Badge>
          )}
          <span>更新于 {formatDistanceToNow(prompt.updatedAt, { addSuffix: true, locale: zhCN })}</span>
        </div>
      </div>

      <ScrollArea className="flex-1 p-6">
        {isEditing ? (
          <Textarea
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            className="min-h-[360px] resize-y text-sm leading-relaxed"
            placeholder="提示词内容..."
          />
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground bg-muted/30 p-4 rounded-xl border border-dashed">
            {prompt.content}
          </div>
        )}
      </ScrollArea>

      <div className="p-4 border-t bg-card flex justify-end gap-2">
        {isEditing ? (
          <>
            <Button variant="outline" onClick={handleCancel}>
              <X className="h-4 w-4 mr-2" /> 取消
            </Button>
            <Button onClick={handleSave}>
              <Check className="h-4 w-4 mr-2" /> 保存
            </Button>
          </>
        ) : (
          <>
            {isOwner && (
              <Button variant="destructive" className="mr-auto" onClick={onDelete}>
                <Trash className="h-4 w-4 mr-2" /> 删除
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>关闭</Button>
            <Button onClick={() => onCopy(prompt.content)}>
              <Copy className="h-4 w-4 mr-2" /> 复制内容
            </Button>
          </>
        )}
      </div>
    </>
  );
}
