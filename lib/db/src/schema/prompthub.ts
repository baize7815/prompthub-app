import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const promptHubMetaTable = pgTable("prompt_hub_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const promptCategoriesTable = pgTable("prompt_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

export const promptsTable = pgTable(
  "prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    categoryId: uuid("category_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    usageCount: integer("usage_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => ({
    titleLowerUnique: uniqueIndex("prompts_title_lower_unique").on(
      sql`lower(${table.title})`,
    ),
  }),
);

export type Prompt = typeof promptsTable.$inferSelect;
export type Category = typeof promptCategoriesTable.$inferSelect;
