import { Router, type IRouter, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  listPrompts,
  listCategories,
  getPromptByTitle,
  searchPrompts,
  getCategoryName,
  recordPromptUsage,
  getCategoryByName,
  getPromptByTitleInCategory,
  getOrCreateCategoryByName,
  createPrompt,
  DuplicateTitleError,
} from "../lib/promptsStore";
import { isMcpAuthorized, isOwnerRequest } from "../lib/auth";

function formatPromptMarkdown(p: {
  title: string;
  content: string;
  categoryId: string | null;
}, categoryName: string): string {
  return `# ${p.title}\n\n**分类**: ${categoryName}\n\n---\n\n${p.content}`;
}

async function buildServer(canWrite: boolean): Promise<McpServer> {
  const server = new McpServer({
    name: "prompthub",
    version: "1.0.0",
  });

  server.registerTool(
    "list_prompts",
    {
      title: "列出全部提示词",
      description:
        "返回 PromptHub 中所有提示词的标题、分类和摘要列表，用于快速浏览。",
      inputSchema: {},
    },
    async () => {
      const [prompts, categories] = await Promise.all([
        listPrompts(),
        listCategories(),
      ]);
      const lines = prompts.map((p) => {
        const cat = getCategoryName(categories, p.categoryId);
        const preview = p.content.replace(/\s+/g, " ").slice(0, 80);
        return `- **${p.title}** （${cat}）— ${preview}${
          p.content.length > 80 ? "…" : ""
        }`;
      });
      const text = lines.length
        ? `共 ${prompts.length} 条提示词：\n\n${lines.join("\n")}`
        : "提示词库为空。";
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "get_prompt_by_title",
    {
      title: "按标题获取提示词",
      description:
        "根据标题（精确或包含匹配）查找一条提示词，并返回完整的 Markdown 格式内容，AI 可直接将其作为 system prompt 使用。",
      inputSchema: {
        title: z.string().describe("要查找的提示词标题，例如 “小红书文案”"),
      },
    },
    async ({ title }) => {
      const prompt = await getPromptByTitle(title);
      if (!prompt) {
        return {
          isError: true,
          content: [
            { type: "text", text: `未找到标题包含 “${title}” 的提示词。` },
          ],
        };
      }
      const categories = await listCategories();
      const cat = getCategoryName(categories, prompt.categoryId);
      await recordPromptUsage([prompt.id]);
      return {
        content: [
          { type: "text", text: formatPromptMarkdown(prompt, cat) },
        ],
      };
    },
  );

  server.registerTool(
    "search_prompts",
    {
      title: "搜索提示词",
      description: "在标题与内容中模糊搜索提示词，返回匹配项的列表。",
      inputSchema: {
        query: z.string().describe("搜索关键词"),
      },
    },
    async ({ query }) => {
      const [matches, categories] = await Promise.all([
        searchPrompts(query),
        listCategories(),
      ]);
      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: `没有匹配 “${query}” 的提示词。` }],
        };
      }
      await recordPromptUsage(matches.map((m) => m.id));
      const text = matches
        .map((p) => {
          const cat = getCategoryName(categories, p.categoryId);
          return `## ${p.title} （${cat}）\n\n${p.content}`;
        })
        .join("\n\n---\n\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "list_prompt_categories",
    {
      title: "列出提示词分类",
      description: "返回 PromptHub 中所有可用分类。",
      inputSchema: {},
    },
    async () => {
      const categories = await listCategories();
      if (categories.length === 0) {
        return { content: [{ type: "text", text: "当前没有可用分类。" }] };
      }
      const text = categories.map((c) => `- ${c.name} (${c.id})`).join("\n");
      return { content: [{ type: "text", text: `共 ${categories.length} 个分类：\n\n${text}` }] };
    },
  );

  server.registerTool(
    "get_prompt_in_category",
    {
      title: "按分类与标题获取提示词",
      description:
        "在指定分类中根据标题（精确或包含匹配）查找一条提示词，并返回完整 Markdown。",
      inputSchema: {
        category: z.string().describe("分类名，例如“编程开发”"),
        title: z.string().describe("提示词标题关键词"),
        match: z
          .enum(["exact", "contains"])
          .optional()
          .describe("匹配方式，默认 contains"),
      },
    },
    async ({ category, title, match }) => {
      const cat = await getCategoryByName(category);
      if (!cat) {
        return {
          isError: true,
          content: [{ type: "text", text: `未找到分类 “${category}”。` }],
        };
      }
      const prompt = await getPromptByTitleInCategory({
        categoryId: cat.id,
        title,
        match,
      });
      if (!prompt) {
        return {
          isError: true,
          content: [{ type: "text", text: `分类 “${cat.name}” 下未找到标题匹配 “${title}” 的提示词。` }],
        };
      }
      await recordPromptUsage([prompt.id]);
      return {
        content: [{ type: "text", text: formatPromptMarkdown(prompt, cat.name) }],
      };
    },
  );

  server.registerTool(
    "create_prompt",
    {
      title: "新建提示词",
      description: "新建一条提示词（分类、标题、完整内容）。",
      inputSchema: {
        category: z.string().describe("分类名，例如“编程开发”"),
        title: z.string().describe("提示词标题"),
        content: z.string().describe("完整提示词内容（Markdown 文本）"),
      },
    },
    async ({ category, title, content }) => {
      if (!canWrite) {
        return {
          isError: true,
          content: [{ type: "text", text: "当前 MCP 会话无写权限，只有 owner 可新建提示词。" }],
        };
      }
      const trimmedTitle = title.trim();
      const trimmedContent = content.trim();
      if (!trimmedTitle) {
        return {
          isError: true,
          content: [{ type: "text", text: "title 不能为空。" }],
        };
      }
      if (!trimmedContent) {
        return {
          isError: true,
          content: [{ type: "text", text: "content 不能为空。" }],
        };
      }

      const targetCategory = await getOrCreateCategoryByName(category);
      try {
        const created = await createPrompt({
          title: trimmedTitle,
          content: trimmedContent,
          categoryId: targetCategory.id,
        });
        return {
          content: [
            {
              type: "text",
              text: `已创建提示词：${created.title}（${targetCategory.name}）\nID: ${created.id}`,
            },
          ],
        };
      } catch (error) {
        if (error instanceof DuplicateTitleError) {
          return {
            isError: true,
            content: [{ type: "text", text: `标题已存在：${error.title}` }],
          };
        }
        throw error;
      }
    },
  );

  return server;
}

const router: IRouter = Router();

async function handle(req: Request, res: Response) {
  if (!isMcpAuthorized(req)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "MCP endpoint requires a token. Add `Authorization: Bearer <token>` or `?token=<token>` (token is shown to the owner in PromptHub Settings → MCP).",
      },
      id: null,
    });
    return;
  }
  try {
    const server = await buildServer(isOwnerRequest(req));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal error" },
        id: null,
      });
    }
  }
}

router.post("/mcp", handle);
router.get("/mcp", handle);
router.delete("/mcp", handle);

export default router;
