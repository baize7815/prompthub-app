import { useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Clock,
  RotateCcw,
  Trash2,
  Copy,
  Check,
  ChevronsUpDown,
  ExternalLink,
  Download,
  Upload,
  FileText,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  downloadSnapshot,
  frequencyLabel,
  frequencyMs,
  type BackupFrequency,
  type BackupSnapshot,
} from "@/lib/auto-backup";
import type { useAutoBackup } from "@/lib/auto-backup";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  usePromptStore,
  parseExportFile,
  parseMarkdownLibrary,
  libraryToMarkdown,
  type ChatSettings,
  type ExportFile,
  type ImportResult,
} from "@/lib/store";

type ClientId = "cursor" | "vscode" | "cline" | "windsurf" | "trae" | "other";

const CLIENTS: { id: ClientId; label: string }[] = [
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "cline", label: "Cline" },
  { id: "windsurf", label: "Windsurf" },
  { id: "trae", label: "Trae" },
  { id: "other", label: "其他" },
];

function buildConfig(
  client: ClientId,
  mcpUrl: string,
  token: string | null,
): string {
  const serverName = "prompthub";
  // Embed the token in the URL so AI clients that don't support custom
  // headers still authenticate. Clients that do support headers can use
  // `Authorization: Bearer <token>` instead.
  const urlWithToken = token
    ? `${mcpUrl}${mcpUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
    : mcpUrl;
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  switch (client) {
    case "cursor":
    case "windsurf":
    case "trae":
    case "other":
      return JSON.stringify(
        {
          mcpServers: {
            [serverName]: headers
              ? { url: urlWithToken, headers }
              : { url: urlWithToken },
          },
        },
        null,
        2,
      );
    case "vscode":
      return JSON.stringify(
        {
          servers: {
            [serverName]: headers
              ? { type: "http", url: urlWithToken, headers }
              : { type: "http", url: urlWithToken },
          },
        },
        null,
        2,
      );
    case "cline":
      return JSON.stringify(
        {
          mcpServers: {
            [serverName]: headers
              ? {
                  url: urlWithToken,
                  transportType: "streamableHttp",
                  headers,
                }
              : { url: urlWithToken, transportType: "streamableHttp" },
          },
        },
        null,
        2,
      );
  }
}

function buildDeepLink(
  client: ClientId,
  mcpUrl: string,
  token: string | null,
): string | null {
  const name = "prompthub";
  const urlWithToken = token
    ? `${mcpUrl}${mcpUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
    : mcpUrl;
  if (client === "cursor") {
    const cfg = btoa(JSON.stringify({ url: urlWithToken }));
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=${name}&config=${encodeURIComponent(cfg)}`;
  }
  if (client === "vscode") {
    const cfg = encodeURIComponent(
      JSON.stringify({ name, type: "http", url: urlWithToken }),
    );
    return `vscode:mcp/install?${cfg}`;
  }
  return null;
}

function downloadBlob(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ChatSettings;
  onSave: (settings: ChatSettings) => void;
  store: ReturnType<typeof usePromptStore>;
  autoBackup: ReturnType<typeof useAutoBackup>;
};

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSave,
  store,
  autoBackup,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">设置</DialogTitle>
          <DialogDescription className="text-center">
            管理模型、MCP 接入和提示词库备份
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="model" className="mt-2">
          <TabsList className="w-full justify-start gap-1 bg-transparent border-b rounded-none h-auto p-0">
            <TabsTrigger
              value="model"
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary rounded-none px-4 py-2 text-sm"
            >
              模型
            </TabsTrigger>
            <TabsTrigger
              value="mcp"
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary rounded-none px-4 py-2 text-sm"
            >
              MCP
            </TabsTrigger>
            <TabsTrigger
              value="data"
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary rounded-none px-4 py-2 text-sm"
            >
              数据
            </TabsTrigger>
          </TabsList>

          <TabsContent value="model" className="mt-4">
            <ModelSection
              settings={settings}
              onSave={onSave}
              onClose={() => onOpenChange(false)}
            />
          </TabsContent>
          <TabsContent value="mcp" className="mt-4">
            <McpSection store={store} />
          </TabsContent>
          <TabsContent value="data" className="mt-4">
            <DataSection store={store} autoBackup={autoBackup} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ModelSection({
  settings,
  onSave,
  onClose,
}: {
  settings: ChatSettings;
  onSave: (settings: ChatSettings) => void;
  onClose: () => void;
}) {
  const [baseURL, setBaseURL] = useState(settings.baseURL);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState(settings.model);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>(
    settings.model ? [settings.model] : [],
  );
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    setBaseURL(settings.baseURL);
    setApiKey(settings.apiKey);
    setModel(settings.model);
    setModels(settings.model ? [settings.model] : []);
    setShowKey(false);
  }, [settings.baseURL, settings.apiKey, settings.model]);

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseURL, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `请求失败 (${res.status})`);
      }
      const list: string[] = Array.isArray(data?.models) ? data.models : [];
      if (list.length === 0) {
        toast.warning("未获取到任何模型");
      } else {
        setModels(list);
        if (!list.includes(model)) {
          setModel(list[0]);
        }
        toast.success(`已加载 ${list.length} 个模型`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "获取模型列表失败";
      toast.error(msg);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSave = () => {
    if (!model.trim()) {
      toast.error("请填写或选择一个模型");
      return;
    }
    onSave({
      model: model.trim(),
      baseURL: baseURL.trim(),
      apiKey: apiKey.trim(),
    });
    toast.success("设置已保存");
    onClose();
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        兼容 OpenAI 接口规范。填入任意服务商的 Base URL 与 API Key 即可使用。留空则使用 Replit 默认 AI 集成。
      </p>

      <div className="space-y-2">
        <label className="text-sm font-medium">Base URL</label>
        <Input
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          placeholder="https://api.openai.com/v1"
          spellCheck={false}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          OpenAI 兼容接口的地址，例如 https://api.openai.com/v1 、 https://api.deepseek.com/v1 。
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">API Key</label>
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            spellCheck={false}
            autoComplete="off"
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-1 top-1 h-7 w-7 text-muted-foreground"
            title={showKey ? "隐藏" : "显示"}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          密钥仅保存在本地浏览器，发送请求时通过你的服务端转发，不会写入数据库。
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">模型</label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={fetchModels}
            disabled={loadingModels}
            className="h-7 px-2 text-xs"
          >
            {loadingModels ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            从 /v1/models 获取
          </Button>
        </div>
        <ModelCombobox
          value={model}
          onChange={setModel}
          options={models}
        />
        <p className="text-xs text-muted-foreground">
          点击「从 /v1/models 获取」可自动拉取服务端支持的模型列表；也可以直接在下拉框里输入模型 ID 进行筛选或自定义。
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button onClick={handleSave}>保存</Button>
      </div>
    </div>
  );
}

export function ModelCombobox({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const showCustomOption =
    trimmed.length > 0 &&
    !options.some((o) => o.toLowerCase() === trimmed.toLowerCase());

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) setQuery("");
    }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <span className="truncate">{value || "选择或输入模型..."}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[var(--radix-popover-trigger-width)]"
        align="start"
      >
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="输入模型名称搜索或自定义..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {options.length === 0 && !showCustomOption && (
              <CommandEmpty>暂无模型，请先获取列表或直接输入。</CommandEmpty>
            )}
            {options.length === 0 && showCustomOption && (
              <CommandEmpty>按下方按钮使用自定义模型。</CommandEmpty>
            )}
            {options.length > 0 && (
              <CommandEmpty>没有匹配的模型。</CommandEmpty>
            )}
            {options.length > 0 && (
              <CommandGroup heading="模型列表">
                {options.map((m) => (
                  <CommandItem
                    key={m}
                    value={m}
                    onSelect={(v) => {
                      onChange(v);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === m ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{m}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showCustomOption && (
              <CommandGroup heading="自定义">
                <CommandItem
                  value={`__custom__::${trimmed}`}
                  onSelect={() => {
                    onChange(trimmed);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check className="mr-2 h-4 w-4 opacity-0" />
                  使用「{trimmed}」
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function McpSection({ store }: { store: ReturnType<typeof usePromptStore> }) {
  const [client, setClient] = useState<ClientId>("cursor");
  const [copied, setCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const mcpUrl = useMemo(() => {
    if (typeof window === "undefined") return "/api/mcp";
    return `${window.location.origin}/api/mcp`;
  }, []);

  const token = store.auth.mcpToken;
  const isOwner = store.auth.isOwner;

  const config = buildConfig(client, mcpUrl, token);
  const deepLink = buildDeepLink(client, mcpUrl, token);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(config);
      setCopied(true);
      toast.success("已复制 JSON 配置");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("复制失败");
    }
  };

  const handleCopyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopied(true);
      toast.success("已复制访问令牌");
      setTimeout(() => setTokenCopied(false), 1800);
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3">
        助力 AI 编程，让 Cursor 等 AI 编程工具直接访问当前站点的所有提示词
      </p>

      {!isOwner ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-4 mb-4 text-sm text-muted-foreground">
          <div className="font-medium text-foreground mb-1 flex items-center gap-2">
            🔒 MCP 已锁定
          </div>
          请先以管理员身份登录，登录后这里会显示带令牌的接入配置。MCP 接口需要 <code className="text-xs">Authorization: Bearer &lt;token&gt;</code> 或 <code className="text-xs">?token=...</code> 才能访问。
        </div>
      ) : token ? (
        <div className="rounded-lg border bg-muted/30 p-4 mb-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">你的 MCP 访问令牌</div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? "隐藏" : "显示"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={handleCopyToken}
              >
                {tokenCopied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span className="ml-1">{tokenCopied ? "已复制" : "复制"}</span>
              </Button>
            </div>
          </div>
          <code className="block text-xs font-mono break-all bg-slate-900 text-slate-100 rounded p-2">
            {showToken ? token : "•".repeat(Math.min(token.length, 40))}
          </code>
          <p className="text-xs text-muted-foreground">
            令牌已自动嵌入下方 JSON 配置中。复制配置即可直接使用。如需手动构造请求，请在请求头加 <code className="text-xs">Authorization: Bearer &lt;token&gt;</code>，或在 URL 末尾追加 <code className="text-xs">?token=&lt;token&gt;</code>。修改 OWNER_PASSWORD 会让旧令牌失效。
          </p>
        </div>
      ) : null}
      <Tabs value={client} onValueChange={(v) => setClient(v as ClientId)}>
        <TabsList className="w-full justify-start gap-1 bg-transparent border-b rounded-none h-auto p-0">
          {CLIENTS.map((c) => (
            <TabsTrigger
              key={c.id}
              value={c.id}
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary rounded-none px-3 py-2 text-sm"
            >
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {CLIENTS.map((c) => (
          <TabsContent key={c.id} value={c.id} className="mt-4 space-y-4">
            {deepLink && c.id === client && (
              <div>
                <div className="text-sm font-medium mb-2">一键添加</div>
                <a href={deepLink}>
                  <Button variant="default" size="sm" className="gap-2">
                    <ExternalLink className="h-4 w-4" />
                    点击这里添加到 {c.label}
                  </Button>
                </a>
                <div className="text-xs text-muted-foreground mt-2">或</div>
              </div>
            )}

            <div>
              <div className="text-sm font-medium mb-2">手动配置</div>
              <div className="relative">
                <pre className="bg-slate-900 text-slate-100 text-xs rounded-lg p-4 overflow-x-auto leading-relaxed font-mono">
                  {config}
                </pre>
                <Button
                  size="sm"
                  variant="secondary"
                  className="absolute top-2 right-2 h-7 px-2"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1 text-xs">
                    {copied ? "已复制" : "复制"}
                  </span>
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              提示：必须安装 Node.js 环境（版本号 &gt;= 18）
            </div>

            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <span>📋 复制 JSON 后，如何使用 MCP？</span>
              <a
                href="https://modelcontextprotocol.io/docs/clients"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                查看文档
              </a>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function DataSection({
  store,
  autoBackup,
}: {
  store: ReturnType<typeof usePromptStore>;
  autoBackup: ReturnType<typeof useAutoBackup>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingImport, setPendingImport] = useState<ExportFile | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importing, setImporting] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);

  const handleExportJson = () => {
    const data = store.exportLibrary();
    if (data.prompts.length === 0 && data.categories.length === 0) {
      toast.info("提示词库为空，没有可导出的内容");
      return;
    }
    downloadBlob(
      `prompthub-backup-${ts()}.json`,
      "application/json",
      JSON.stringify(data, null, 2),
    );
    toast.success(`已导出 ${data.prompts.length} 条提示词`);
  };

  const handleExportMarkdown = () => {
    const data = store.exportLibrary();
    if (data.prompts.length === 0) {
      toast.info("提示词库为空，没有可导出的内容");
      return;
    }
    downloadBlob(
      `prompthub-export-${ts()}.md`,
      "text/markdown",
      libraryToMarkdown(data),
    );
    toast.success(`已导出 ${data.prompts.length} 条提示词`);
  };

  const handleFileChosen = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const name = file.name.toLowerCase();
      const isMarkdown =
        name.endsWith(".md") ||
        name.endsWith(".markdown") ||
        file.type === "text/markdown";
      const parsed = isMarkdown
        ? parseMarkdownLibrary(text, file.name)
        : parseExportFile(text);
      setPendingImport(parsed);
      setLastResult(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    }
  };

  const runImport = async () => {
    if (!pendingImport) return;
    if (importMode === "replace" && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    setImporting(true);
    try {
      const result = await store.importLibrary(pendingImport, importMode);
      setLastResult(result);
      setPendingImport(null);
      setConfirmReplace(false);
      toast.success(
        `导入完成：新增 ${result.promptsCreated} 条，跳过 ${result.promptsSkipped} 条`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <AutoBackupSection autoBackup={autoBackup} store={store} />

      <div className="border-t" />

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">导出</h3>
          <p className="text-xs text-muted-foreground mt-1">
            将所有提示词和分类备份为文件，可在其他设备恢复或分享给协作者。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleExportJson} className="gap-2">
            <Download className="h-4 w-4" />
            导出为 JSON（可导入）
          </Button>
          <Button
            onClick={handleExportMarkdown}
            variant="outline"
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            导出为 Markdown
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          当前共 {store.prompts.length} 条提示词，{store.categories.length} 个分类
        </p>
      </section>

      <div className="border-t" />

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">导入</h3>
          <p className="text-xs text-muted-foreground mt-1">
            从之前导出的 JSON 备份文件恢复提示词，或导入 Markdown 笔记（## 作为分类、### 作为提示词标题）。
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json,text/markdown,.md,.markdown"
          className="hidden"
          onChange={handleFileChosen}
        />

        {!pendingImport ? (
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            选择备份文件...
          </Button>
        ) : (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            {pendingImport.label && (
              <div className="text-sm">
                来源：
                <span className="font-medium">{pendingImport.label}</span>
              </div>
            )}
            <div className="text-sm">
              已读取备份：
              <span className="font-medium">
                {pendingImport.prompts.length} 条提示词
              </span>
              、
              <span className="font-medium">
                {pendingImport.categories.length} 个分类
              </span>
              {pendingImport.exportedAt && (
                <span className="text-muted-foreground">
                  （导出于{" "}
                  {new Date(pendingImport.exportedAt).toLocaleString("zh-CN")}）
                </span>
              )}
            </div>

            <RadioGroup
              value={importMode}
              onValueChange={(v) => {
                setImportMode(v as "merge" | "replace");
                setConfirmReplace(false);
              }}
              className="space-y-2"
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem value="merge" id="mode-merge" className="mt-0.5" />
                <Label htmlFor="mode-merge" className="font-normal cursor-pointer">
                  <div className="text-sm font-medium">合并到现有库</div>
                  <div className="text-xs text-muted-foreground">
                    保留现有提示词；同名同内容跳过；同名但内容不同的会自动追加 (2)、(3)。
                  </div>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="replace" id="mode-replace" className="mt-0.5" />
                <Label htmlFor="mode-replace" className="font-normal cursor-pointer">
                  <div className="text-sm font-medium text-destructive">
                    替换现有库
                  </div>
                  <div className="text-xs text-muted-foreground">
                    删除当前所有提示词和分类，再从备份恢复。此操作无法撤销。
                  </div>
                </Label>
              </div>
            </RadioGroup>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPendingImport(null);
                  setConfirmReplace(false);
                }}
                disabled={importing}
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={runImport}
                disabled={importing}
                variant={importMode === "replace" ? "destructive" : "default"}
              >
                {importing
                  ? "导入中..."
                  : importMode === "replace"
                    ? "替换并导入"
                    : "开始导入"}
              </Button>
            </div>
          </div>
        )}

        {lastResult && (
          <div className="text-xs text-muted-foreground rounded-md border bg-muted/30 p-3 space-y-0.5">
            <div>新增提示词：{lastResult.promptsCreated}</div>
            <div>跳过重复：{lastResult.promptsSkipped}</div>
            <div>因重名追加序号：{lastResult.promptsRenamed}</div>
            <div>
              新建分类：{lastResult.categoriesCreated}，复用已有：
              {lastResult.categoriesReused}
            </div>
            {(lastResult.promptsDeleted > 0 ||
              lastResult.categoriesDeleted > 0) && (
              <div>
                替换前清理：删除 {lastResult.promptsDeleted} 条提示词、
                {lastResult.categoriesDeleted} 个分类
              </div>
            )}
          </div>
        )}
      </section>

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认替换整个提示词库？</AlertDialogTitle>
            <AlertDialogDescription>
              当前的 {store.prompts.length} 条提示词和 {store.categories.length} 个分类将被
              <span className="font-medium text-destructive">永久删除</span>
              ，然后从备份文件恢复。此操作无法撤销，建议先导出当前库作为备份。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={importing}
              onClick={(e) => {
                e.preventDefault();
                void runImport();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认替换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatRelative(ts: number): string {
  try {
    return formatDistanceToNow(ts, { addSuffix: true, locale: zhCN });
  } catch {
    return new Date(ts).toLocaleString("zh-CN");
  }
}

function nextBackupHint(
  lastBackupAt: number | null,
  frequency: BackupFrequency,
): string {
  if (!lastBackupAt) return "下次打开或刷新时会立即备份";
  const next = lastBackupAt + frequencyMs(frequency);
  if (next <= Date.now()) return "已到时间，将很快自动备份";
  return `下次自动备份 ${formatRelative(next)}`;
}

function AutoBackupSection({
  autoBackup,
  store,
}: {
  autoBackup: ReturnType<typeof useAutoBackup>;
  store: ReturnType<typeof usePromptStore>;
}) {
  const { settings, snapshots, updateSettings, runBackupNow, removeSnapshot } =
    autoBackup;
  const [restoreTarget, setRestoreTarget] = useState<BackupSnapshot | null>(
    null,
  );
  const [restoring, setRestoring] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BackupSnapshot | null>(null);

  const handleManualBackup = () => {
    const result = runBackupNow();
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.snapshot) {
      toast.success(
        `已创建快照（${result.snapshot.promptCount} 条提示词）${
          result.truncated ? "，已清理较旧快照" : ""
        }`,
      );
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const result = await store.importLibrary(restoreTarget.data, "replace");
      toast.success(
        `已从快照恢复：新增 ${result.promptsCreated} 条，清理 ${result.promptsDeleted} 条`,
      );
      setRestoreTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">自动备份</h3>
        <p className="text-xs text-muted-foreground mt-1">
          按计划在浏览器本地保存提示词库快照，避免误删后无法恢复。可选同时下载到本地 Downloads 目录。
        </p>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label
              htmlFor="auto-backup-enabled"
              className="text-sm font-medium"
            >
              启用自动备份
            </Label>
            <p className="text-xs text-muted-foreground">
              {settings.enabled
                ? `${frequencyLabel(settings.frequency)}保存一次，最多保留 ${settings.keepCount} 份`
                : "关闭后不会自动创建快照"}
            </p>
          </div>
          <Switch
            id="auto-backup-enabled"
            checked={settings.enabled}
            onCheckedChange={(v) => updateSettings({ enabled: v })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">备份频率</Label>
            <Select
              value={settings.frequency}
              onValueChange={(v) =>
                updateSettings({ frequency: v as BackupFrequency })
              }
              disabled={!settings.enabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">每天一次</SelectItem>
                <SelectItem value="weekly">每周一次</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              保留最近快照数（1–20）
            </Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={settings.keepCount}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) updateSettings({ keepCount: n });
              }}
              disabled={!settings.enabled}
            />
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="space-y-0.5">
            <Label
              htmlFor="auto-backup-download"
              className="text-sm font-medium"
            >
              同时下载到本地
            </Label>
            <p className="text-xs text-muted-foreground">
              开启后，每次自动备份会触发浏览器下载一份 JSON 文件。
            </p>
          </div>
          <Switch
            id="auto-backup-download"
            checked={settings.autoDownload}
            onCheckedChange={(v) => updateSettings({ autoDownload: v })}
            disabled={!settings.enabled}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {settings.lastBackupAt
              ? `上次备份 ${formatRelative(settings.lastBackupAt)}`
              : "尚未自动备份过"}
            {settings.enabled && (
              <span className="text-muted-foreground/70">
                · {nextBackupHint(settings.lastBackupAt, settings.frequency)}
              </span>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={handleManualBackup}>
            立即备份
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-muted-foreground">
            本地快照（{snapshots.length}）
          </h4>
        </div>
        {snapshots.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground text-center">
            暂无快照。开启自动备份或点击「立即备份」生成第一份。
          </div>
        ) : (
          <ul className="rounded-md border divide-y bg-background">
            {snapshots.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">
                    {new Date(s.createdAt).toLocaleString("zh-CN")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.promptCount} 条提示词 · {s.categoryCount} 个分类 ·{" "}
                    {formatRelative(s.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => downloadSnapshot(s)}
                    title="下载该快照"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setRestoreTarget(s)}
                    title="从该快照恢复"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(s)}
                    title="删除该快照"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog
        open={!!restoreTarget}
        onOpenChange={(open) => !open && !restoring && setRestoreTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>从快照恢复整个提示词库？</AlertDialogTitle>
            <AlertDialogDescription>
              当前的 {store.prompts.length} 条提示词和 {store.categories.length}{" "}
              个分类将被
              <span className="font-medium text-destructive">永久删除</span>
              ，并以此快照（
              {restoreTarget
                ? new Date(restoreTarget.createdAt).toLocaleString("zh-CN")
                : ""}
              ）的内容替换。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              onClick={(e) => {
                e.preventDefault();
                void handleRestore();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {restoring ? "恢复中..." : "确认恢复"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除该快照？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除{" "}
              {deleteTarget
                ? new Date(deleteTarget.createdAt).toLocaleString("zh-CN")
                : ""}{" "}
              的快照，无法撤销。当前的提示词库不会受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) removeSnapshot(deleteTarget.id);
                setDeleteTarget(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
