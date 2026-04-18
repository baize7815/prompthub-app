import {
  db,
  promptsTable,
  promptCategoriesTable,
  promptHubMetaTable,
} from "@workspace/db";
import { and, desc, eq, ilike, ne, or } from "drizzle-orm";

export class DuplicateTitleError extends Error {
  constructor(public title: string) {
    super(`Duplicate prompt title: ${title}`);
    this.name = "DuplicateTitleError";
  }
}

async function isTitleTaken(title: string, excludeId?: string): Promise<boolean> {
  const trimmed = title.trim();
  if (!trimmed) return false;
  const where = excludeId
    ? and(ilike(promptsTable.title, trimmed), ne(promptsTable.id, excludeId))
    : ilike(promptsTable.title, trimmed);
  const rows = await db
    .select({ id: promptsTable.id })
    .from(promptsTable)
    .where(where)
    .limit(1);
  return rows.length > 0;
}

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

type DbPrompt = typeof promptsTable.$inferSelect;
type DbCategory = typeof promptCategoriesTable.$inferSelect;

function toPrompt(row: DbPrompt): Prompt {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    categoryId: row.categoryId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    usageCount: 0,
    lastUsedAt: null,
  };
}

export async function recordPromptUsage(_ids: string[]): Promise<void> {
  // 当前 prompts schema 未包含 usageCount / lastUsedAt 字段，先保持 no-op，
  // 以确保 MCP 查询链路稳定可用。
}

function toCategory(row: DbCategory): Category {
  return { id: row.id, name: row.name };
}

const SEED_CATEGORIES: { name: string }[] = [
  { name: "写作助手" },
  { name: "编程开发" },
  { name: "小红书文案" },
  { name: "日常生活" },
];

const SEED_PROMPTS: { title: string; content: string; categoryName: string }[] =
  [
    {
      title: "润色文章",
      content:
        "你是一个专业的编辑。请帮我润色以下文章，使其更连贯、专业。保持原意，修正错别字和语法错误：\n\n[在此输入文章]",
      categoryName: "写作助手",
    },
    {
      title: "代码审查",
      content:
        "你是一个高级开发工程师。请审查以下代码，指出潜在的 bug，性能问题，并提供优化后的代码建议：\n\n[在此输入代码]",
      categoryName: "编程开发",
    },
    {
      title: "爆款标题生成",
      content:
        "请帮我生成 5 个小红书爆款标题。主题是：[在此输入主题]。要求：带有情绪价值，吸引眼球，包含适当的数字和悬念。",
      categoryName: "小红书文案",
    },
    {
      title: "一周食谱规划",
      content:
        "请帮我规划接下来一周的健康晚餐食谱。要求：低碳水，高蛋白，做法简单（每顿不超过30分钟），食材常见易买。",
      categoryName: "日常生活",
    },
    {
      title: "正则表达式解释",
      content:
        "请详细解释这个正则表达式的含义，并给出几个匹配和不匹配的示例：\n\n[在此输入正则]",
      categoryName: "编程开发",
    },
  ];

let seedPromise: Promise<void> | null = null;

const SEED_KEY = "seeded_at";

async function ensureSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    // Run the sentinel claim AND the seed insert in one transaction. If
    // either part fails the whole thing rolls back, including the sentinel,
    // so a transient DB error does not permanently leave the tables empty.
    // If the sentinel already exists we simply do nothing — never reseed,
    // even after the user deletes every prompt.
    await db.transaction(async (tx) => {
      const claimed = await tx
        .insert(promptHubMetaTable)
        .values({ key: SEED_KEY, value: new Date().toISOString() })
        .onConflictDoNothing({ target: promptHubMetaTable.key })
        .returning({ key: promptHubMetaTable.key });
      if (claimed.length === 0) return;

      // Belt-and-braces: even if we got the sentinel claim, only insert seed
      // data when the prompts table is genuinely empty. This protects against
      // pre-populated DBs (imports, restores) where the sentinel row may not
      // yet exist but real prompts already do.
      const existing = await tx.select({ id: promptsTable.id }).from(promptsTable).limit(1);
      if (existing.length > 0) return;

      const insertedCats = await tx
        .insert(promptCategoriesTable)
        .values(SEED_CATEGORIES)
        .returning();
      const byName = new Map(insertedCats.map((c) => [c.name, c.id]));
      await tx.insert(promptsTable).values(
        SEED_PROMPTS.map((p) => ({
          title: p.title,
          content: p.content,
          categoryId: byName.get(p.categoryName) ?? null,
        })),
      );
    });
  })();
  try {
    await seedPromise;
  } catch (e) {
    seedPromise = null;
    throw e;
  }
}

export async function listPrompts(): Promise<Prompt[]> {
  await ensureSeeded();
  const rows = await db
    .select()
    .from(promptsTable)
    .orderBy(desc(promptsTable.updatedAt));
  return rows.map(toPrompt);
}

export async function listCategories(): Promise<Category[]> {
  await ensureSeeded();
  const rows = await db.select().from(promptCategoriesTable);
  return rows.map(toCategory);
}

export async function getPromptById(id: string): Promise<Prompt | null> {
  await ensureSeeded();
  if (!isUuid(id)) return null;
  const rows = await db
    .select()
    .from(promptsTable)
    .where(eq(promptsTable.id, id))
    .limit(1);
  return rows[0] ? toPrompt(rows[0]) : null;
}

export async function getPromptByTitle(title: string): Promise<Prompt | null> {
  await ensureSeeded();
  const trimmed = title.trim();
  if (!trimmed) return null;
  const exact = await db
    .select()
    .from(promptsTable)
    .where(ilike(promptsTable.title, trimmed))
    .limit(1);
  if (exact[0]) return toPrompt(exact[0]);
  const partial = await db
    .select()
    .from(promptsTable)
    .where(ilike(promptsTable.title, `%${trimmed}%`))
    .limit(1);
  return partial[0] ? toPrompt(partial[0]) : null;
}

export async function getCategoryByName(name: string): Promise<Category | null> {
  await ensureSeeded();
  const trimmed = name.trim();
  if (!trimmed) return null;
  const exact = await db
    .select()
    .from(promptCategoriesTable)
    .where(ilike(promptCategoriesTable.name, trimmed))
    .limit(1);
  if (exact[0]) return toCategory(exact[0]);
  const partial = await db
    .select()
    .from(promptCategoriesTable)
    .where(ilike(promptCategoriesTable.name, `%${trimmed}%`))
    .limit(1);
  return partial[0] ? toCategory(partial[0]) : null;
}

export async function getOrCreateCategoryByName(name: string): Promise<Category> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("category is required");
  const existing = await getCategoryByName(trimmed);
  if (existing) return existing;
  return createCategory(trimmed);
}

export async function getPromptByTitleInCategory(input: {
  categoryId: string;
  title: string;
  match?: "exact" | "contains";
}): Promise<Prompt | null> {
  await ensureSeeded();
  if (!isUuid(input.categoryId)) return null;
  const trimmed = input.title.trim();
  if (!trimmed) return null;
  const titlePattern = input.match === "exact" ? trimmed : `%${trimmed}%`;
  const rows = await db
    .select()
    .from(promptsTable)
    .where(
      and(
        eq(promptsTable.categoryId, input.categoryId),
        ilike(promptsTable.title, titlePattern),
      ),
    )
    .limit(1);
  return rows[0] ? toPrompt(rows[0]) : null;
}

export async function searchPrompts(query: string): Promise<Prompt[]> {
  await ensureSeeded();
  const q = query.trim();
  if (!q) {
    const rows = await db.select().from(promptsTable);
    return rows.map(toPrompt);
  }
  const pattern = `%${q}%`;
  const rows = await db
    .select()
    .from(promptsTable)
    .where(
      or(
        ilike(promptsTable.title, pattern),
        ilike(promptsTable.content, pattern),
      ),
    );
  return rows.map(toPrompt);
}

export async function createPrompt(input: {
  title: string;
  content: string;
  categoryId: string | null;
}): Promise<Prompt> {
  await ensureSeeded();
  if (await isTitleTaken(input.title)) {
    throw new DuplicateTitleError(input.title);
  }
  try {
    const [row] = await db
      .insert(promptsTable)
      .values({
        title: input.title,
        content: input.content,
        categoryId: input.categoryId && isUuid(input.categoryId)
          ? input.categoryId
          : null,
      })
      .returning();
    return toPrompt(row!);
  } catch (e) {
    if (isUniqueViolation(e)) throw new DuplicateTitleError(input.title);
    throw e;
  }
}

export async function updatePrompt(
  id: string,
  updates: Partial<{
    title: string;
    content: string;
    categoryId: string | null;
  }>,
): Promise<Prompt | null> {
  await ensureSeeded();
  if (!isUuid(id)) return null;
  if (typeof updates.title === "string") {
    if (await isTitleTaken(updates.title, id)) {
      throw new DuplicateTitleError(updates.title);
    }
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof updates.title === "string") patch["title"] = updates.title;
  if (typeof updates.content === "string") patch["content"] = updates.content;
  if (updates.categoryId === null) patch["categoryId"] = null;
  else if (typeof updates.categoryId === "string" && isUuid(updates.categoryId))
    patch["categoryId"] = updates.categoryId;
  try {
    const [row] = await db
      .update(promptsTable)
      .set(patch)
      .where(eq(promptsTable.id, id))
      .returning();
    return row ? toPrompt(row) : null;
  } catch (e) {
    if (isUniqueViolation(e))
      throw new DuplicateTitleError(String(updates.title ?? ""));
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "23505"
  );
}

export async function deletePrompt(id: string): Promise<boolean> {
  await ensureSeeded();
  if (!isUuid(id)) return false;
  const rows = await db
    .delete(promptsTable)
    .where(eq(promptsTable.id, id))
    .returning({ id: promptsTable.id });
  return rows.length > 0;
}

export async function createCategory(name: string): Promise<Category> {
  await ensureSeeded();
  const [row] = await db
    .insert(promptCategoriesTable)
    .values({ name })
    .returning();
  return toCategory(row!);
}

export async function deleteCategory(id: string): Promise<boolean> {
  await ensureSeeded();
  if (!isUuid(id)) return false;
  // Detach prompts
  await db
    .update(promptsTable)
    .set({ categoryId: null })
    .where(eq(promptsTable.categoryId, id));
  const rows = await db
    .delete(promptCategoriesTable)
    .where(eq(promptCategoriesTable.id, id))
    .returning({ id: promptCategoriesTable.id });
  return rows.length > 0;
}

export function getCategoryName(
  categories: Category[],
  id: string | null,
): string {
  if (!id) return "未分类";
  return categories.find((c) => c.id === id)?.name ?? "未分类";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
