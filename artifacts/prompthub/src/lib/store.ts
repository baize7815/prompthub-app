import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

export type Prompt = {
  id: string;
  title: string;
  content: string;
  categoryId: string | null;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  lastUsedAt: number | null;
};

export type Category = {
  id: string;
  name: string;
};

export type TextPart = { type: "text"; text: string };
export type ImagePart = { type: "image_url"; image_url: { url: string } };
export type ContentPart = TextPart | ImagePart;
export type MessageContent = string | ContentPart[];

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: MessageContent;
  createdAt: number;
};

export type PromptChangeKind = "prompt" | "custom" | "none";

export type PromptChange = {
  id: string;
  at: number;
  fromKind: PromptChangeKind;
  fromTitle: string | null;
  toKind: PromptChangeKind;
  toTitle: string | null;
  // Marker is rendered immediately after this message in the list. When
  // null, the change happened before any messages were sent.
  afterMessageId: string | null;
};

export type Conversation = {
  id: string;
  title: string;
  systemPrompt: string;
  promptId: string | null;
  promptTitle: string | null;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  promptChanges?: PromptChange[];
};

export function messageText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export function messageImages(content: MessageContent): string[] {
  if (typeof content === "string") return [];
  return content
    .filter((p): p is ImagePart => p.type === "image_url")
    .map((p) => p.image_url.url);
}

export type Painting = {
  id: string;
  title: string;
  prompt: string;
  model: string;
  size: string; // "auto" | "1024x1024" | ...
  n: number;
  referenceImages: string[]; // data:image/... URLs
  results: string[]; // generated image URLs (https or data:)
  status: "idle" | "generating" | "done" | "error";
  error?: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
};

export type ChatSettings = {
  model: string;
  baseURL: string;
  apiKey: string;
};

const API_BASE = "/api";
const CACHE_KEY = "prompthub:offline-cache:v1";
const CONVERSATIONS_KEY = "prompthub:conversations";
const SETTINGS_KEY = "prompthub:chat-settings";
const PAINTINGS_KEY = "prompthub:paintings";

const DEFAULT_SETTINGS: ChatSettings = {
  model: "gpt-5.2",
  baseURL: "",
  apiKey: "",
};

type OfflineCache = { prompts: Prompt[]; categories: Category[] };

function readOfflineCache(): OfflineCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineCache;
    if (!Array.isArray(parsed.prompts) || !Array.isArray(parsed.categories))
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeOfflineCache(cache: OfflineCache): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota / privacy mode errors
  }
}

function readConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Conversation[]) : [];
  } catch {
    return [];
  }
}

function readPaintings(): Painting[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PAINTINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Painting[]) : [];
  } catch {
    return [];
  }
}

function readSettings(): ChatSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || res.statusText;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(text) as { error?: string; code?: string };
      if (parsed && typeof parsed.error === "string") message = parsed.error;
      if (parsed && typeof parsed.code === "string") code = parsed.code;
    } catch {
      // not JSON, keep raw text
    }
    throw new ApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function usePromptStore() {
  const initial = readOfflineCache();
  const [prompts, setPrompts] = useState<Prompt[]>(initial?.prompts ?? []);
  const [categories, setCategories] = useState<Category[]>(
    initial?.categories ?? [],
  );
  // First-paint cache: treat as "loaded" immediately if we have any cached
  // data, then refresh in the background.
  const [isLoaded, setIsLoaded] = useState(initial !== null);
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    readConversations(),
  );
  const [settings, setSettings] = useState<ChatSettings>(() => readSettings());
  const [paintings, setPaintings] = useState<Painting[]>(() => readPaintings());
  const [auth, setAuth] = useState<AuthState>({
    checked: false,
    ownerEnabled: false,
    isOwner: false,
    mcpToken: null,
  });

  // Refs for synchronous access inside optimistic helpers
  const promptsRef = useRef(prompts);
  const categoriesRef = useRef(categories);
  const conversationsRef = useRef(conversations);
  const paintingsRef = useRef(paintings);
  promptsRef.current = prompts;
  categoriesRef.current = categories;
  conversationsRef.current = conversations;
  paintingsRef.current = paintings;

  const persist = useCallback((p: Prompt[], c: Category[]) => {
    writeOfflineCache({ prompts: p, categories: c });
  }, []);

  const refresh = useCallback(async () => {
    const [p, c] = await Promise.all([
      api<{ items: Prompt[] }>("/prompts"),
      api<{ items: Category[] }>("/categories"),
    ]);
    setPrompts(p.items);
    setCategories(c.items);
    persist(p.items, c.items);
  }, [persist]);

  useEffect(() => {
    refresh()
      .catch((e) => console.error("Failed to load prompts", e))
      .finally(() => setIsLoaded(true));
  }, [refresh]);

  useEffect(() => {
    api<AuthMeResponse>("/auth/me")
      .then((r) =>
        setAuth({
          checked: true,
          ownerEnabled: !!r.ownerEnabled,
          isOwner: !!r.isOwner,
          mcpToken: typeof r.mcpToken === "string" ? r.mcpToken : null,
        }),
      )
      .catch(() =>
        setAuth({
          checked: true,
          ownerEnabled: false,
          isOwner: false,
          mcpToken: null,
        }),
      );
  }, []);

  const login = useCallback(async (password: string) => {
    const r = await api<{ ok: boolean; isOwner: boolean; mcpToken: string | null }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ password }) },
    );
    setAuth({
      checked: true,
      ownerEnabled: true,
      isOwner: !!r.isOwner,
      mcpToken: r.mcpToken ?? null,
    });
    return r;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api<{ ok: boolean }>("/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setAuth((prev) => ({ ...prev, isOwner: false, mcpToken: null }));
  }, []);

  const createPrompt = useCallback(
    async (input: Omit<Prompt, "id" | "createdAt" | "updatedAt" | "usageCount" | "lastUsedAt">) => {
      const now = Date.now();
      const tempId = `tmp_${now}_${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: Prompt = {
        id: tempId,
        title: input.title,
        content: input.content,
        categoryId: input.categoryId,
        createdAt: now,
        updatedAt: now,
        usageCount: 0,
        lastUsedAt: null,
      };
      const next = [optimistic, ...promptsRef.current];
      setPrompts(next);
      persist(next, categoriesRef.current);
      try {
        const created = await api<Prompt>("/prompts", {
          method: "POST",
          body: JSON.stringify(input),
        });
        setPrompts((prev) => {
          const swapped = prev.map((p) => (p.id === tempId ? created : p));
          persist(swapped, categoriesRef.current);
          return swapped;
        });
        return created;
      } catch (err) {
        setPrompts((prev) => {
          const reverted = prev.filter((p) => p.id !== tempId);
          persist(reverted, categoriesRef.current);
          return reverted;
        });
        if (err instanceof ApiError && err.code === "DUPLICATE_TITLE") {
          toast.error(err.message);
        } else {
          toast.error("创建失败，请重试");
        }
        throw err;
      }
    },
    [persist],
  );

  const updatePrompt = useCallback(
    async (
      id: string,
      updates: Partial<Omit<Prompt, "id" | "createdAt" | "updatedAt" | "usageCount" | "lastUsedAt">>,
    ) => {
      const previous = promptsRef.current.find((p) => p.id === id);
      if (!previous) throw new Error("Prompt not found");
      const optimistic: Prompt = {
        ...previous,
        ...updates,
        updatedAt: Date.now(),
      };
      const next = promptsRef.current.map((p) =>
        p.id === id ? optimistic : p,
      );
      setPrompts(next);
      persist(next, categoriesRef.current);
      try {
        const updated = await api<Prompt>(`/prompts/${id}`, {
          method: "PATCH",
          body: JSON.stringify(updates),
        });
        setPrompts((prev) => {
          const synced = prev.map((p) => (p.id === id ? updated : p));
          persist(synced, categoriesRef.current);
          return synced;
        });
        return updated;
      } catch (err) {
        setPrompts((prev) => {
          const reverted = prev.map((p) => (p.id === id ? previous : p));
          persist(reverted, categoriesRef.current);
          return reverted;
        });
        if (err instanceof ApiError && err.code === "DUPLICATE_TITLE") {
          toast.error(err.message);
        } else {
          toast.error("保存失败，请重试");
        }
        throw err;
      }
    },
    [persist],
  );

  const deletePrompt = useCallback(
    async (id: string) => {
      const previous = promptsRef.current;
      const next = previous.filter((p) => p.id !== id);
      setPrompts(next);
      persist(next, categoriesRef.current);
      try {
        await api<void>(`/prompts/${id}`, { method: "DELETE" });
      } catch (err) {
        setPrompts(previous);
        persist(previous, categoriesRef.current);
        toast.error("删除失败，请重试");
        throw err;
      }
    },
    [persist],
  );

  const createCategory = useCallback(
    async (name: string) => {
      // Categories: the prompt-form needs the real id before assigning, so
      // here we go server-first but still update cache optimistically after.
      const created = await api<Category>("/categories", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setCategories((prev) => {
        const next = [...prev, created];
        persist(promptsRef.current, next);
        return next;
      });
      return created;
    },
    [persist],
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      const prevCats = categoriesRef.current;
      const prevPrompts = promptsRef.current;
      const nextCats = prevCats.filter((c) => c.id !== id);
      const nextPrompts = prevPrompts.map((p) =>
        p.categoryId === id ? { ...p, categoryId: null } : p,
      );
      setCategories(nextCats);
      setPrompts(nextPrompts);
      persist(nextPrompts, nextCats);
      try {
        await api<void>(`/categories/${id}`, { method: "DELETE" });
      } catch (err) {
        setCategories(prevCats);
        setPrompts(prevPrompts);
        persist(prevPrompts, prevCats);
        toast.error("删除分类失败，请重试");
        throw err;
      }
    },
    [persist],
  );

  const persistConversations = (next: Conversation[]) => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
    }
  };

  const saveConversations = (next: Conversation[]) => {
    setConversations(next);
    persistConversations(next);
  };

  const saveSettings = (next: ChatSettings) => {
    setSettings(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
    }
  };

  const createConversation = (params: {
    promptId: string | null;
    promptTitle: string | null;
    systemPrompt: string;
  }): Conversation => {
    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: "新对话",
      systemPrompt: params.systemPrompt,
      promptId: params.promptId,
      promptTitle: params.promptTitle,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveConversations([conv, ...conversationsRef.current]);
    return conv;
  };

  const updateConversation = (
    id: string,
    updater: (prev: Conversation) => Conversation,
  ) => {
    setConversations((prev) => {
      const next = prev.map((c) => (c.id === id ? updater(c) : c));
      persistConversations(next);
      return next;
    });
  };

  const deleteConversation = (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      persistConversations(next);
      return next;
    });
  };

  const persistPaintings = (next: Painting[]) => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(PAINTINGS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
    }
  };

  const createPainting = (params: {
    title?: string;
    prompt: string;
    model: string;
    size: string;
    n: number;
    referenceImages: string[];
  }): Painting => {
    const now = Date.now();
    const p: Painting = {
      id: crypto.randomUUID(),
      title:
        params.title ||
        params.prompt.trim().slice(0, 30) ||
        "新绘画",
      prompt: params.prompt,
      model: params.model,
      size: params.size,
      n: params.n,
      referenceImages: params.referenceImages,
      results: [],
      status: "generating",
      createdAt: now,
      updatedAt: now,
    };
    const next = [p, ...paintingsRef.current];
    setPaintings(next);
    persistPaintings(next);
    return p;
  };

  const updatePainting = (
    id: string,
    updater: (prev: Painting) => Painting,
  ) => {
    setPaintings((prev) => {
      const next = prev.map((p) => (p.id === id ? updater(p) : p));
      persistPaintings(next);
      return next;
    });
  };

  const deletePainting = (id: string) => {
    setPaintings((prev) => {
      const next = prev.filter((p) => p.id !== id);
      persistPaintings(next);
      return next;
    });
  };

  const deleteConversations = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setConversations((prev) => {
      const next = prev.filter((c) => !idSet.has(c.id));
      persistConversations(next);
      return next;
    });
  };

  const exportLibrary = useCallback((): ExportFile => {
    return {
      version: 1,
      exportedAt: Date.now(),
      categories: categoriesRef.current.map((c) => ({ id: c.id, name: c.name })),
      prompts: promptsRef.current.map((p) => ({
        id: p.id,
        title: p.title,
        content: p.content,
        categoryId: p.categoryId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        usageCount: p.usageCount ?? 0,
        lastUsedAt: p.lastUsedAt ?? null,
      })),
    };
  }, []);

  const importLibrary = useCallback(
    async (
      data: ExportFile,
      mode: "merge" | "replace",
    ): Promise<ImportResult> => {
      const result: ImportResult = {
        categoriesCreated: 0,
        categoriesReused: 0,
        promptsCreated: 0,
        promptsSkipped: 0,
        promptsRenamed: 0,
        promptsDeleted: 0,
        categoriesDeleted: 0,
      };

      if (mode === "replace") {
        // Delete everything first (sequentially for predictable failure
        // surface; categories last since deleting a category nulls prompts).
        for (const p of [...promptsRef.current]) {
          try {
            await api<void>(`/prompts/${p.id}`, { method: "DELETE" });
            result.promptsDeleted++;
          } catch (e) {
            console.error("Failed to delete prompt during replace", p.id, e);
          }
        }
        for (const c of [...categoriesRef.current]) {
          try {
            await api<void>(`/categories/${c.id}`, { method: "DELETE" });
            result.categoriesDeleted++;
          } catch (e) {
            console.error("Failed to delete category during replace", c.id, e);
          }
        }
        setPrompts([]);
        setCategories([]);
        promptsRef.current = [];
        categoriesRef.current = [];
      }

      // Map incoming categoryId -> resolved categoryId (after reuse/create)
      const categoryIdMap = new Map<string, string>();
      const existingCatsByName = new Map<string, Category>();
      for (const c of categoriesRef.current) {
        existingCatsByName.set(c.name.toLowerCase(), c);
      }

      for (const incoming of data.categories ?? []) {
        if (!incoming || typeof incoming.name !== "string") continue;
        const key = incoming.name.toLowerCase();
        const existing = existingCatsByName.get(key);
        if (existing) {
          categoryIdMap.set(incoming.id, existing.id);
          result.categoriesReused++;
        } else {
          try {
            const created = await api<Category>("/categories", {
              method: "POST",
              body: JSON.stringify({ name: incoming.name }),
            });
            existingCatsByName.set(key, created);
            categoryIdMap.set(incoming.id, created.id);
            categoriesRef.current = [...categoriesRef.current, created];
            result.categoriesCreated++;
          } catch (e) {
            console.error("Failed to create category", incoming.name, e);
          }
        }
      }

      // Build a lookup of existing prompts by title+content to dedupe.
      // Title comparison is case-insensitive to match the server's unique
      // index on lower(title).
      const existingByKey = new Map<string, Prompt>();
      const existingTitlesLower = new Set<string>();
      for (const p of promptsRef.current) {
        existingByKey.set(`${p.title}\u0000${p.content}`, p);
        existingTitlesLower.add(p.title.toLowerCase());
      }

      const createdPrompts: Prompt[] = [];
      for (const incoming of data.prompts ?? []) {
        if (
          !incoming ||
          typeof incoming.title !== "string" ||
          typeof incoming.content !== "string"
        )
          continue;

        const key = `${incoming.title}\u0000${incoming.content}`;
        if (existingByKey.has(key)) {
          result.promptsSkipped++;
          continue;
        }

        let title = incoming.title;
        if (existingTitlesLower.has(title.toLowerCase())) {
          let i = 2;
          while (existingTitlesLower.has(`${incoming.title} (${i})`.toLowerCase()))
            i++;
          title = `${incoming.title} (${i})`;
          result.promptsRenamed++;
        }

        const resolvedCategoryId =
          incoming.categoryId && categoryIdMap.has(incoming.categoryId)
            ? categoryIdMap.get(incoming.categoryId)!
            : null;

        try {
          const created = await api<Prompt>("/prompts", {
            method: "POST",
            body: JSON.stringify({
              title,
              content: incoming.content,
              categoryId: resolvedCategoryId,
            }),
          });
          createdPrompts.push(created);
          existingByKey.set(`${created.title}\u0000${created.content}`, created);
          existingTitlesLower.add(created.title.toLowerCase());
          result.promptsCreated++;
        } catch (e) {
          console.error("Failed to import prompt", incoming.title, e);
        }
      }

      // Refresh from server to get a single source of truth
      await refresh();
      return result;
    },
    [refresh],
  );

  return {
    prompts,
    categories,
    conversations,
    settings,
    isLoaded,
    refresh,
    createPrompt,
    updatePrompt,
    deletePrompt,
    createCategory,
    deleteCategory,
    createConversation,
    updateConversation,
    deleteConversation,
    deleteConversations,
    paintings,
    createPainting,
    updatePainting,
    deletePainting,
    saveSettings,
    exportLibrary,
    importLibrary,
    auth,
    login,
    logout,
  };
}

export type AuthState = {
  checked: boolean;
  ownerEnabled: boolean;
  isOwner: boolean;
  mcpToken: string | null;
};

type AuthMeResponse = {
  ownerEnabled?: boolean;
  isOwner?: boolean;
  mcpToken?: string | null;
};

export type ExportFile = {
  version: 1;
  exportedAt: number;
  categories: Category[];
  prompts: Prompt[];
  label?: string;
};

export type ImportResult = {
  categoriesCreated: number;
  categoriesReused: number;
  promptsCreated: number;
  promptsSkipped: number;
  promptsRenamed: number;
  promptsDeleted: number;
  categoriesDeleted: number;
};

export function parseExportFile(text: string): ExportFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as ExportFile).prompts) ||
    !Array.isArray((parsed as ExportFile).categories)
  ) {
    throw new Error("备份文件格式不正确");
  }
  const data = parsed as ExportFile;
  if (data.version !== 1) {
    throw new Error(`不支持的备份版本: ${String(data.version)}`);
  }
  return data;
}

export function parseMarkdownLibrary(
  text: string,
  filename?: string,
): ExportFile {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const categories: Category[] = [];
  const prompts: Prompt[] = [];
  const catIdByName = new Map<string, string>();

  let label: string | undefined;
  let currentCategoryId: string | null = null;
  let catCounter = 0;
  let promptCounter = 0;
  let i = 0;

  const ensureCategory = (rawName: string) => {
    const name = rawName.trim();
    if (!name || name === "未分类") {
      currentCategoryId = null;
      return;
    }
    const existing = catIdByName.get(name.toLowerCase());
    if (existing) {
      currentCategoryId = existing;
      return;
    }
    const id = `mdcat_${++catCounter}`;
    categories.push({ id, name });
    catIdByName.set(name.toLowerCase(), id);
    currentCategoryId = id;
  };

  while (i < lines.length) {
    const line = lines[i];
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    const h3 = line.match(/^###\s+(.+?)\s*$/);

    if (h1 && !h2 && !h3 && !label) {
      label = h1[1].trim() || undefined;
      i++;
      continue;
    }

    if (h3) {
      const title = h3[1].trim();
      i++;
      while (i < lines.length && lines[i].trim() === "") i++;

      let content = "";
      const fence = i < lines.length ? lines[i].match(/^(`{3,}|~{3,})/) : null;
      if (fence) {
        const closer = fence[1];
        i++;
        const buf: string[] = [];
        while (i < lines.length && !lines[i].startsWith(closer)) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        content = buf.join("\n");
      } else {
        const buf: string[] = [];
        while (i < lines.length) {
          if (/^#{1,3}\s+/.test(lines[i])) break;
          buf.push(lines[i]);
          i++;
        }
        content = buf.join("\n").trim();
      }

      if (title && content) {
        const now = Date.now();
        prompts.push({
          id: `mdprompt_${++promptCounter}`,
          title,
          content,
          categoryId: currentCategoryId,
          createdAt: now,
          updatedAt: now,
          usageCount: 0,
          lastUsedAt: null,
        });
      }
      continue;
    }

    if (h2) {
      ensureCategory(h2[1]);
      i++;
      continue;
    }

    i++;
  }

  if (prompts.length === 0) {
    throw new Error(
      "未在 Markdown 中找到提示词。请使用 ## 作为分类标题、### 作为提示词标题。",
    );
  }

  if (!label && filename) {
    label = filename.replace(/\.(md|markdown)$/i, "").trim() || undefined;
  }

  return {
    version: 1,
    exportedAt: Date.now(),
    categories,
    prompts,
    ...(label ? { label } : {}),
  };
}

export function libraryToMarkdown(data: ExportFile): string {
  const catName = (id: string | null) =>
    id ? data.categories.find((c) => c.id === id)?.name ?? "未分类" : "未分类";
  const byCat = new Map<string, Prompt[]>();
  for (const p of data.prompts) {
    const key = catName(p.categoryId);
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(p);
  }
  const lines: string[] = [
    "# PromptHub 提示词库",
    "",
    `导出时间: ${new Date(data.exportedAt).toISOString()}`,
    `共 ${data.prompts.length} 条提示词，${data.categories.length} 个分类`,
    "",
  ];
  for (const [cat, items] of byCat) {
    lines.push(`## ${cat}`);
    lines.push("");
    for (const p of items) {
      lines.push(`### ${p.title}`);
      lines.push("");
      lines.push("```");
      lines.push(p.content);
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n");
}
