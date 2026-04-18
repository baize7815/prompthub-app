import { Router, type IRouter } from "express";
import {
  listPrompts,
  getPromptById,
  createPrompt,
  updatePrompt,
  deletePrompt,
  DuplicateTitleError,
} from "../lib/promptsStore";
import { requireOwner } from "../lib/auth";

const router: IRouter = Router();

router.get("/prompts", async (_req, res) => {
  const items = await listPrompts();
  res.json({ items });
});

router.get("/prompts/:id", async (req, res) => {
  const item = await getPromptById((req.params.id as string));
  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(item);
});

router.post("/prompts", requireOwner, async (req, res) => {
  const { title, content, categoryId } = req.body ?? {};
  if (typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (typeof content !== "string" || !content.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  try {
    const created = await createPrompt({
      title: title.trim(),
      content: content.trim(),
      categoryId: typeof categoryId === "string" ? categoryId : null,
    });
    res.status(201).json(created);
  } catch (e) {
    if (e instanceof DuplicateTitleError) {
      res
        .status(409)
        .json({ error: "标题已存在，请使用不同的标题。", code: "DUPLICATE_TITLE" });
      return;
    }
    throw e;
  }
});

router.patch("/prompts/:id", requireOwner, async (req, res) => {
  const { title, content, categoryId } = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (typeof title === "string") updates["title"] = title;
  if (typeof content === "string") updates["content"] = content;
  if (categoryId === null || typeof categoryId === "string")
    updates["categoryId"] = categoryId;
  try {
    const updated = await updatePrompt((req.params.id as string), updates);
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    if (e instanceof DuplicateTitleError) {
      res
        .status(409)
        .json({ error: "标题已存在，请使用不同的标题。", code: "DUPLICATE_TITLE" });
      return;
    }
    throw e;
  }
});

router.delete("/prompts/:id", requireOwner, async (req, res) => {
  const ok = await deletePrompt((req.params.id as string));
  if (!ok) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).end();
});

export default router;
