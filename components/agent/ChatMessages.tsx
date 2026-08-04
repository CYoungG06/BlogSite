"use client";

import {
  ArrowClockwise,
  ArrowRight,
  CaretRight,
  Check,
  Copy,
  DownloadSimple,
  ImageSquare,
  MagnifyingGlass,
  Spinner,
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import {
  Children,
  isValidElement,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Link } from "@/i18n/navigation";
import type { ChatMessage } from "@/lib/agent/chat";
import { downloadShareCard } from "@/lib/agent/share-card";
import type { ToolCallRecord } from "@/lib/agent/tools";
import RefCard from "./RefCard";

/** ChatMessage 已移到 lib/agent/chat.ts(会话模型),这里 re-export 保持兼容 */
export type { ChatMessage } from "@/lib/agent/chat";

const TOOL_ICON_SIZE = 12;

function ToolLine({ call, active }: { call: ToolCallRecord; active?: boolean }) {
  const t = useTranslations("agent");
  return (
    <p className="animate-msg-in flex items-center gap-1.5 font-mono text-xs text-muted">
      {active ? (
        <Spinner size={TOOL_ICON_SIZE} aria-hidden className="shrink-0 animate-spin text-accent" />
      ) : (
        <MagnifyingGlass size={TOOL_ICON_SIZE} aria-hidden className="shrink-0" />
      )}
      <span className="truncate">
        {call.detail ?? t("toolCall", { name: call.name })}
      </span>
    </p>
  );
}

/** 等待首个内容时的「正在思考」微光指示,超过 3s 显示秒数 */
function Thinking() {
  const t = useTranslations("agent");
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  return (
    <p className="flex items-center gap-2 text-sm">
      <Spinner size={13} aria-hidden className="animate-spin text-accent" />
      <span className="text-muted text-shimmer">{t("thinking")}</span>
      {secs >= 3 ? (
        <span className="font-mono text-[0.7rem] text-muted">{secs}s</span>
      ) : null}
    </p>
  );
}

/** 流式输出末尾的闪烁竖线光标(复用 Hero 的 blink 动画) */
function StreamCursor() {
  return (
    <span
      aria-hidden
      className="animate-blink ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] rounded-full bg-accent"
    />
  );
}

/** 从 react-markdown 的 pre children(<code> 元素)提取语言与纯文本 */
function extractCode(children: ReactNode): { lang: string; text: string } | null {
  if (!isValidElement(children)) return null;
  const props = children.props as { className?: string; children?: ReactNode };
  const lang = /language-([\w+-]+)/.exec(props.className ?? "")?.[1] ?? "";
  const raw = props.children;
  const text =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join("") : String(raw ?? "");
  return { lang, text: text.replace(/\n$/, "") };
}

/** 代码块:头栏(语言标签 + 复制按钮)+ 等宽正文 */
function CodeBlock({ children }: { children?: ReactNode }) {
  const t = useTranslations("agent");
  const [copied, setCopied] = useState(false);
  const extracted = extractCode(children);
  if (!extracted) return <pre>{children}</pre>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(extracted.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默
    }
  };
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-hairline bg-accent/5">
      <div className="flex items-center justify-between border-b border-hairline/60 px-2.5 py-1">
        <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted">
          {extracted.lang || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={t("copyCode")}
          title={t("copyCode")}
          className="rounded p-1 text-muted transition-colors duration-300 ease-premium hover:text-accent"
        >
          {copied ? (
            <Check size={11} className="text-accent" aria-hidden />
          ) : (
            <Copy size={11} aria-hidden />
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[0.8rem] leading-relaxed">
        <code>{extracted.text}</code>
      </pre>
    </div>
  );
}

function NavigateCard({ call }: { call: ToolCallRecord }) {
  const path = String(call.args.path ?? "");
  const label = String(call.args.label ?? path);
  if (!path.startsWith("/")) return null;
  return (
    <Link
      href={path}
      className="group flex items-center justify-between gap-2 rounded-lg border border-hairline px-3 py-2 text-sm text-accent transition-colors duration-300 ease-premium hover:bg-accent/5"
    >
      <span className="truncate">{label}</span>
      <ArrowRight
        size={14}
        aria-hidden
        className="shrink-0 transition-transform duration-300 ease-premium group-hover:translate-x-0.5"
      />
    </Link>
  );
}

/**
 * 段落级标点缝合:块级引用卡(arXiv 论文卡/速递日卡)会截断文本流,
 * 紧跟其后的句读标点(。、,,;等)会孤悬一行或落到行首(违反中文行首禁则)。
 * 这里在段落渲染前把这些标点剥掉——块边界本身已承担停顿语义;
 * 闭合类符号(」)】等)保留,避免拆散配对。
 */
const CARD_HREF_RE = /arxiv\.org\/abs\/\d{4}\.\d{4,5}|^\/papers\/\d{4}-\d{2}-\d{2}/;
const LEADING_PUNCT_RE = /^[。、,，;；:：!?！？]+\s*/;

function isBlockCard(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const href = (node.props as { href?: unknown }).href;
  return typeof href === "string" && CARD_HREF_RE.test(href);
}

function Paragraph({ children }: { children?: ReactNode }) {
  const arr = Children.toArray(children);
  const out: ReactNode[] = [];
  for (const cur of arr) {
    if (typeof cur === "string" && out.length > 0 && isBlockCard(out[out.length - 1])) {
      const stripped = cur.replace(LEADING_PUNCT_RE, "");
      if (!stripped) continue; // 两卡之间整段都是标点,丢弃
      out.push(stripped);
      continue;
    }
    out.push(cur);
  }
  return <p>{out}</p>;
}

function MarkdownBlock({ content, cursor }: { content: string; cursor?: boolean }) {
  return (
    <div className="prose prose-sm max-w-none text-sm leading-relaxed [&_a]:text-accent [&_code]:text-[0.85em] [&_ul]:my-1 [&_ol]:my-1 [&_p]:my-1.5 [&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // 链接卡片化:arXiv → 论文卡,/papers/date/ → 速递卡,站内走 Link
          a: ({ href, children }) =>
            href ? <RefCard href={href}>{children}</RefCard> : <>{children}</>,
          // 段落:剥掉紧跟块级卡片的句读标点(见 Paragraph)
          p: ({ children }) => <Paragraph>{children}</Paragraph>,
          // 代码块:语言标签 + 复制按钮的头栏
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {content}
      </ReactMarkdown>
      {cursor ? <StreamCursor /> : null}
    </div>
  );
}

/** 回答操作栏:重发(仅最后一条)/ 复制 Markdown / 下载 .md / 生成分享卡片。
 *  非最后一条的操作栏默认隐藏,悬停消息时显现(触屏常显) */
function MessageActions({
  content,
  onRetry,
  alwaysVisible,
}: {
  content: string;
  onRetry?: () => void;
  alwaysVisible?: boolean;
}) {
  const t = useTranslations("agent");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默(非安全上下文等)
    }
  };
  const download = () => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `acane-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const btn =
    "rounded-md p-1.5 text-muted transition-colors duration-300 ease-premium hover:text-accent";
  return (
    <div
      className={`flex items-center gap-0.5 transition-opacity duration-300 ease-premium ${
        alwaysVisible ? "" : "sm:opacity-0 sm:group-hover/msg:opacity-100"
      }`}
    >
      {onRetry ? (
        <button type="button" onClick={onRetry} aria-label={t("regenerate")} title={t("regenerate")} className={btn}>
          <ArrowClockwise size={13} aria-hidden />
        </button>
      ) : null}
      <button type="button" onClick={copy} aria-label={t("copyMd")} title={t("copyMd")} className={btn}>
        {copied ? <Check size={13} className="text-accent" aria-hidden /> : <Copy size={13} aria-hidden />}
      </button>
      <button type="button" onClick={download} aria-label={t("downloadMd")} title={t("downloadMd")} className={btn}>
        <DownloadSimple size={13} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => downloadShareCard(content)}
        aria-label={t("shareCard")}
        title={t("shareCard")}
        className={btn}
      >
        <ImageSquare size={13} aria-hidden />
      </button>
    </div>
  );
}

function MessageBody({
  message,
  isLast,
  onSuggestion,
  onRetry,
}: {
  message: ChatMessage;
  isLast: boolean;
  onSuggestion?: (text: string) => void;
  onRetry?: () => void;
}) {
  const t = useTranslations("agent");
  // 回答完成后工具过程默认折叠,点击展开;流式进行中始终展开
  const [showProcess, setShowProcess] = useState(false);
  const parts = message.parts ?? [];

  // 连续的工具调用合并成一段(navigate 卡片保持独立内联)
  type Segment =
    | { type: "text"; content: string }
    | { type: "nav"; call: ToolCallRecord }
    | { type: "tools"; calls: ToolCallRecord[] };
  const segments: Segment[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      segments.push({ type: "text", content: part.content });
    } else if (part.call.name === "navigate") {
      segments.push({ type: "nav", call: part.call });
    } else {
      const last = segments[segments.length - 1];
      if (last?.type === "tools") last.calls.push(part.call);
      else segments.push({ type: "tools", calls: [part.call] });
    }
  }

  return (
    <div className="space-y-2">
      {segments.length ? (
        // 交错渲染:文本与工具调用按实际发生顺序排列
        segments.map((segment, i) => {
          const isLastSeg = i === segments.length - 1;
          if (segment.type === "text") {
            return (
              <MarkdownBlock
                key={i}
                content={segment.content}
                cursor={message.pending && isLastSeg}
              />
            );
          }
          if (segment.type === "nav") {
            return <NavigateCard key={i} call={segment.call} />;
          }
          const expanded = message.pending || showProcess;
          return expanded ? (
            <div key={i} className="space-y-1">
              {segment.calls.map((call, j) => (
                <ToolLine
                  key={j}
                  call={call}
                  active={
                    message.pending && isLastSeg && j === segment.calls.length - 1
                  }
                />
              ))}
            </div>
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => setShowProcess(true)}
              className="flex items-center gap-1.5 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:text-accent"
            >
              <CaretRight size={TOOL_ICON_SIZE} aria-hidden />
              {t("toolsFold", { count: segment.calls.length })}
            </button>
          );
        })
      ) : message.content ? (
        <MarkdownBlock content={message.content} cursor={message.pending} />
      ) : null}
      {message.pending && !segments.length ? <Thinking /> : null}
      {message.failed ? (
        <div className="space-y-1.5">
          {message.errorReason ? (
            <p className="font-mono text-[0.7rem] text-muted/70">{message.errorReason}</p>
          ) : null}
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-xs text-muted transition-colors duration-300 ease-premium hover:border-accent hover:text-accent"
          >
            <ArrowClockwise size={11} aria-hidden />
            {t("retry")}
          </button>
        </div>
      ) : null}
      {message.content && !message.pending && !message.failed ? (
        <MessageActions
          content={message.content}
          onRetry={isLast ? onRetry : undefined}
          alwaysVisible={isLast}
        />
      ) : null}
      {isLast && !message.pending && message.suggestions?.length ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {message.suggestions.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggestion?.(s)}
              style={{ "--stagger": `${i * 70}ms` } as CSSProperties}
              className="animate-msg-in rounded-full border border-hairline px-2.5 py-1 text-xs text-muted transition-colors duration-300 ease-premium hover:border-accent hover:text-accent"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ChatMessages({
  messages,
  onSuggestion,
  onRetry,
}: {
  messages: ChatMessage[];
  onSuggestion?: (text: string) => void;
  onRetry?: () => void;
}) {
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  return (
    <div className="space-y-4">
      {messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} className="animate-msg-in flex justify-end">
            <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent/10 px-3.5 py-2 text-sm leading-relaxed">
              {message.content}
            </p>
          </div>
        ) : (
          <div key={message.id} className="group/msg animate-msg-in pr-2">
            <MessageBody
              message={message}
              isLast={message.id === lastAssistantId}
              onSuggestion={onSuggestion}
              onRetry={onRetry}
            />
          </div>
        ),
      )}
    </div>
  );
}
