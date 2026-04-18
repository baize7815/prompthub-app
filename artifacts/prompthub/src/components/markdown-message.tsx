import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatImage } from "@/components/chat-image";

type Props = {
  content: string;
};

function CodeBlock({ className, children }: { className?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const language = className?.replace(/^language-/, "") ?? "";
  const text = String(children).replace(/\n$/, "");

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="group relative my-3 rounded-lg border bg-muted/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground border-b bg-muted/60">
        <span className="font-mono">{language || "code"}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCopy}
          className="h-6 px-2 text-xs"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 mr-1" /> 已复制
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 mr-1" /> 复制
            </>
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className={`hljs font-mono ${className ?? ""}`}>{children}</code>
      </pre>
    </div>
  );
}

export function MarkdownMessage({ content }: Props) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-pre:p-0 prose-pre:bg-transparent prose-pre:my-0 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
          [rehypeKatex, { strict: false, throwOnError: false }],
        ]}
        urlTransform={(url) => {
          // react-markdown's default sanitizer strips `data:` URIs, which
          // breaks inline images returned by image-generation models as
          // ![](data:image/...;base64,...). Whitelist safe image data URLs
          // (and pass through http(s) / relative URLs unchanged).
          if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url)) {
            return url;
          }
          if (/^(https?:|mailto:|tel:|#|\/|\.)/i.test(url)) return url;
          return "";
        }}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) =>
            typeof src === "string" ? (
              <ChatImage
                src={src}
                alt={alt}
                className="max-w-full rounded-md border my-2"
              />
            ) : null,
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) {
              return <CodeBlock className={className}>{children}</CodeBlock>;
            }
            return (
              <code
                className="px-1 py-0.5 rounded bg-muted font-mono text-[0.85em]"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
