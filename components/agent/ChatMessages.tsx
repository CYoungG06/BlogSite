"use client";

import { ArrowRight, MagnifyingGlass, Spinner } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "@/i18n/navigation";
import type { ToolCallRecord } from "@/lib/agent/tools";

/** 聊天窗口的一条消息;toolCalls 是该轮回答过程中发生的工具调用 */
export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallRecord[];
  /** 流式进行中 */
  pending?: boolean;
}

const TOOL_ICON_SIZE = 12;

function ToolLine({ call }: { call: ToolCallRecord }) {
  const t = useTranslations("agent");
  const detail =
    call.name === "read_digest"
      ? String(call.args.date ?? "")
      : call.name === "search_site"
        ? String(call.args.query ?? "")
        : call.name === "read_article"
          ? String(call.args.slug ?? "")
          : "";
  return (
    <p className="flex items-center gap-1.5 font-mono text-xs text-muted">
      <MagnifyingGlass size={TOOL_ICON_SIZE} aria-hidden />
      {t("toolCall", { name: call.name })}
      {detail ? ` · ${detail}` : ""}
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

function MessageBody({ message }: { message: ChatMessage }) {
  const toolLines = (message.toolCalls ?? []).filter(
    (c) => c.name !== "navigate",
  );
  const navCards = (message.toolCalls ?? []).filter(
    (c) => c.name === "navigate",
  );
  return (
    <div className="space-y-2">
      {toolLines.length ? (
        <div className="space-y-1">
          {toolLines.map((call, i) => (
            <ToolLine key={i} call={call} />
          ))}
        </div>
      ) : null}
      {message.content ? (
        <div className="prose prose-sm max-w-none text-sm leading-relaxed [&_a]:text-accent [&_code]:text-[0.85em] [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-accent/5 [&_pre]:p-2.5 [&_ul]:my-1 [&_ol]:my-1 [&_p]:my-1.5">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      ) : message.pending ? (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Spinner size={14} className="animate-spin" aria-hidden />
        </p>
      ) : null}
      {navCards.map((call, i) => (
        <NavigateCard key={i} call={call} />
      ))}
    </div>
  );
}

export default function ChatMessages({
  messages,
}: {
  messages: ChatMessage[];
}) {
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
            <MessageBody message={message} />
          </div>
        ),
      )}
    </div>
  );
}
