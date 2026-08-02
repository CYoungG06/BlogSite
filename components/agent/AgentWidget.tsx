"use client";

import {
  ArrowCounterClockwise,
  PaperPlaneRight,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { runAgentTurn } from "@/lib/agent/chat";
import ChatMessages, { type ChatMessage } from "./ChatMessages";

/**
 * 全站 AI 助手悬浮窗:右下角按钮 + 聊天面板。
 * 代理地址来自 NEXT_PUBLIC_AGENT_API(构建期内联);未配置时不渲染。
 * 面板本体动态加载,react-markdown 不进首屏 bundle。
 * 左上角把手可拖拽调整面板尺寸,大小存 localStorage 跨页保持。
 */

const API_URL = process.env.NEXT_PUBLIC_AGENT_API ?? "";

const DEFAULT_SIZE = { w: 380, h: 560 };
const MIN_W = 320;
const MIN_H = 400;
const SIZE_KEY = "agent-panel-size";

function loadSize() {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.w === "number" && typeof parsed?.h === "number") {
        return parsed as { w: number; h: number };
      }
    }
  } catch {
    // 隐私模式等场景 localStorage 不可用,用默认尺寸
  }
  return DEFAULT_SIZE;
}

const SUGGESTIONS = [
  "suggestion1",
  "suggestion2",
  "suggestion3",
] as const;

export default function AgentWidget() {
  const t = useTranslations("agent");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState(loadSize);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** 左上角把手拖拽改尺寸:面板锚定右下,向左拖变宽、向上拖变高 */
  const onResizeStart = (e: { clientX: number; clientY: number; preventDefault: () => void }) => {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, ...size };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "nwse-resize";
    const onMove = (ev: PointerEvent) => {
      const maxW = Math.min(window.innerWidth - 40, 760);
      const maxH = Math.min(window.innerHeight - 96, 880);
      setSize({
        w: Math.min(Math.max(start.w + (start.x - ev.clientX), MIN_W), maxW),
        h: Math.min(Math.max(start.h + (start.y - ev.clientY), MIN_H), maxH),
      });
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setSize((current) => {
        try {
          localStorage.setItem(SIZE_KEY, JSON.stringify(current));
        } catch {
          // 同上,存不上就算了
        }
        return current;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!API_URL) return null;

  const updateMessage = (id: number, patch: Partial<ChatMessage>) =>
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const userMsg: ChatMessage = { id: ++idRef.current, role: "user", content: text };
    const assistantId = ++idRef.current;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", toolCalls: [], pending: true },
    ]);

    const abort = new AbortController();
    abortRef.current = abort;
    const history = [...messages, userMsg].map(({ role, content }) => ({
      role,
      content,
    }));

    try {
      const result = await runAgentTurn({
        apiUrl: API_URL,
        history,
        locale,
        signal: abort.signal,
        onDelta: (content) => updateMessage(assistantId, { content }),
        onToolCall: (call) =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, toolCalls: [...(m.toolCalls ?? []), call] }
                : m,
            ),
          ),
      });
      updateMessage(assistantId, {
        content: result.content || t("empty"),
        toolCalls: result.toolCalls,
        pending: false,
      });
    } catch (error) {
      if (!abort.signal.aborted) {
        updateMessage(assistantId, {
          content: t("error"),
          pending: false,
        });
        console.error("[agent] turn failed:", error);
      }
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    abortRef.current?.abort();
    setMessages([]);
    setBusy(false);
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 sm:bottom-6 sm:right-6">
      {open ? (
        <div
          className="group/panel relative flex max-h-[calc(100dvh-6rem)] w-[calc(100vw-2.5rem)] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-hairline bg-background shadow-2xl shadow-black/10"
          style={{ width: size.w, height: size.h }}
        >
          <div
            role="button"
            tabIndex={-1}
            aria-label={t("resize")}
            title={t("resize")}
            onPointerDown={onResizeStart}
            className="absolute left-1.5 top-1.5 z-10 h-4 w-4 cursor-nwse-resize rounded-tl-lg border-l-2 border-t-2 border-muted/40 transition-colors duration-300 ease-premium hover:border-accent"
          />
          <header className="flex items-center justify-between border-b border-hairline py-3 pl-7 pr-4">
            <p className="flex items-center gap-1.5 text-sm font-medium tracking-tight">
              <Sparkle size={15} className="text-accent" aria-hidden />
              {t("title")}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={clear}
                aria-label={t("clear")}
                title={t("clear")}
                className="rounded-md p-1.5 text-muted transition-colors duration-300 ease-premium hover:text-accent"
              >
                <ArrowCounterClockwise size={15} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("close")}
                className="rounded-md p-1.5 text-muted transition-colors duration-300 ease-premium hover:text-accent"
              >
                <X size={15} aria-hidden />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-muted">
                  {t("welcome")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => send(t(key))}
                      className="rounded-full border border-hairline px-2.5 py-1 text-xs text-muted transition-colors duration-300 ease-premium hover:border-accent hover:text-accent"
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ChatMessages messages={messages} />
            )}
          </div>

          <form
            className="flex items-center gap-2 border-t border-hairline px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("placeholder")}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
              // 面板内输入不需要浏览器自动纠错
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label={t("send")}
              className="rounded-full bg-accent p-2 text-white transition-opacity duration-300 ease-premium disabled:opacity-40"
            >
              <PaperPlaneRight size={14} aria-hidden />
            </button>
          </form>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("open")}
          title={t("title")}
          className="rounded-full bg-accent p-3.5 text-white shadow-lg shadow-accent/25 transition-transform duration-300 ease-premium hover:scale-105"
        >
          <Sparkle size={20} aria-hidden />
        </button>
      )}
    </div>
  );
}
