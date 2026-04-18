import { Router, type IRouter } from "express";
import {
  listCategories,
  createCategory,
  deleteCategory,
} from "../lib/promptsStore";
import { requireOwner } from "../lib/auth";

const router: IRouter = Router();

router.get("/categories", async (_req, res) => {
  const items = await listCategories();
  res.json({ items });
});

router.post("/categories", requireOwner, async (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const created = await createCategory(name.trim());
  res.status(201).json(created);
});

router.delete("/categories/:id", requireOwner, async (req, res) => {
  const ok = await deleteCategory((req.params.id as string));
  if (!ok) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).end();
});

export default router;
