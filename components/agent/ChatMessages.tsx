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
import { useState } from "react";
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

function ToolLine({ call }: { call: ToolCallRecord }) {
  const t = useTranslations("agent");
  return (
    <p className="flex items-center gap-1.5 font-mono text-xs text-muted">
      <MagnifyingGlass size={TOOL_ICON_SIZE} aria-hidden className="shrink-0" />
      <span className="truncate">
        {call.detail ?? t("toolCall", { name: call.name })}
      </span>
    </p>
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

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-sm leading-relaxed [&_a]:text-accent [&_code]:text-[0.85em] [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-accent/5 [&_pre]:p-2.5 [&_ul]:my-1 [&_ol]:my-1 [&_p]:my-1.5 [&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // 链接卡片化:arXiv → 论文卡,/papers/date/ → 速递卡,站内走 Link
          a: ({ href, children }) =>
            href ? <RefCard href={href}>{children}</RefCard> : <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** 回答操作栏:重发(仅最后一条)/ 复制 Markdown / 下载 .md / 生成分享卡片 */
function MessageActions({
  content,
  onRetry,
}: {
  content: string;
  onRetry?: () => void;
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
    <div className="flex items-center gap-0.5">
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
          if (segment.type === "text") {
            return <MarkdownBlock key={i} content={segment.content} />;
          }
          if (segment.type === "nav") {
            return <NavigateCard key={i} call={segment.call} />;
          }
          const expanded = message.pending || showProcess;
          return expanded ? (
            <div key={i} className="space-y-1">
              {segment.calls.map((call, j) => (
                <ToolLine key={j} call={call} />
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
        <MarkdownBlock content={message.content} />
      ) : null}
      {message.pending ? (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Spinner size={14} className="animate-spin" aria-hidden />
        </p>
      ) : null}
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
        <MessageActions content={message.content} onRetry={isLast ? onRetry : undefined} />
      ) : null}
      {isLast && !message.pending && message.suggestions?.length ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {message.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggestion?.(s)}
              className="rounded-full border border-hairline px-2.5 py-1 text-xs text-muted transition-colors duration-300 ease-premium hover:border-accent hover:text-accent"
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
          <div key={message.id} className="flex justify-end">
            <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent/10 px-3.5 py-2 text-sm leading-relaxed">
              {message.content}
            </p>
          </div>
        ) : (
          <div key={message.id} className="pr-2">
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
