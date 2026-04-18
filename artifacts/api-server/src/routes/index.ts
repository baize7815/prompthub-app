import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import promptsRouter from "./prompts";
import categoriesRouter from "./categories";
import mcpRouter from "./mcp";
import chatRouter from "./chat";
import imagesRouter from "./images";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(promptsRouter);
router.use(categoriesRouter);
router.use(mcpRouter);
router.use(chatRouter);
router.use(imagesRouter);

export default router;
