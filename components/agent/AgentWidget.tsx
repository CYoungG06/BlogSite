"use client";

import {
  ArrowCounterClockwise,
  PaperPlaneRight,
  PictureInPicture,
  SidebarSimple,
  Sparkle,
  Binoculars,
  X,
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { runAgentTurn, type AgentPart } from "@/lib/agent/chat";
import { AGENT_OPEN_EVENT, type AgentOpenRequest } from "@/lib/agent/bus";
import { basePath } from "@/lib/images";
import AcaneAvatar from "./AcaneAvatar";
import ChatMessages, { type ChatMessage } from "./ChatMessages";
import DailyBrief from "./DailyBrief";

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
const MODE_KEY = "agent-panel-mode";
const SEEN_DIGEST_KEY = "acane-seen-digest";

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

function loadMode(): "float" | "dock" {
  try {
    return localStorage.getItem(MODE_KEY) === "dock" ? "dock" : "float";
  } catch {
    return "float";
  }
}

const SUGGESTIONS = [
  "suggestion1",
  "suggestion2",
  "suggestion3",
] as const;

/**
 * 隐藏指令彩蛋:本地直接回复,不走模型。
 * 命中返回 assistant 消息内容(+可选 navigate 卡片),未命中返回 null 走正常对话。
 */
const EASTER_EGGS: Record<
  string,
  { key: "eggSuis" | "eggYorushika" | "eggHelp"; navMusic?: boolean }
> = {
  "/suis": { key: "eggSuis", navMusic: true },
  "/yorushika": { key: "eggYorushika", navMusic: true },
  "/夜鹿": { key: "eggYorushika", navMusic: true },
  "/help": { key: "eggHelp" },
  "/彩蛋": { key: "eggHelp" },
};

function AgentWidgetInner() {
  const t = useTranslations("agent");
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState(loadSize);
  /** 面板形态:float 浮窗(锚定右下)/ dock 贴边伴读(贴右全高) */
  const [mode, setMode] = useState<"float" | "dock">(loadMode);
  /** 深度调研模式:更多工具轮数、更长输出、调研者 prompt */
  const [deep, setDeep] = useState(false);
  /** 主动冒泡:检测到新一期速递且用户没见过时,展示其日期 */
  const [digestBubble, setDigestBubble] = useState<string | null>(null);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggleMode = () => {
    const next = mode === "float" ? "dock" : "float";
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // 存不下就算了
    }
  };

  /** 左上角把手拖拽改尺寸:浮窗锚定右下双向拖;dock 全高,只向左拖变宽 */
  const onResizeStart = (e: { clientX: number; clientY: number; preventDefault: () => void }) => {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, ...size };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "nwse-resize";
    const onMove = (ev: PointerEvent) => {
      const maxW = Math.min(window.innerWidth - 40, 760);
      const maxH = Math.min(window.innerHeight - 96, 880);
      setSize((current) => ({
        w: Math.min(Math.max(start.w + (start.x - ev.clientX), MIN_W), maxW),
        h: mode === "dock" ? current.h : Math.min(Math.max(start.h + (start.y - ev.clientY), MIN_H), maxH),
      }));
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

  // 全局打开总线:划词/按钮/首页输入框/⌘K 等入口统一从这里进。
  // send 依赖最新 messages(历史),用 ref 转发避免闭包过期
  const sendRef = useRef<(text: string) => void>(() => {});
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<AgentOpenRequest>).detail ?? {};
      setOpen(true);
      if (detail.prompt) sendRef.current(detail.prompt);
      else if (detail.prefill) setInput(detail.prefill);
    };
    window.addEventListener(AGENT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(AGENT_OPEN_EVENT, onOpen);
  }, []);

  // 主动冒泡:对比最新速递日期与 localStorage 里的已读日期
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${basePath}/api/papers/index.json`);
        if (!res.ok) return;
        const index = await res.json();
        const latest = index.latest as string | undefined;
        if (!latest) return;
        if (localStorage.getItem(SEEN_DIGEST_KEY) !== latest) {
          setDigestBubble(latest);
        }
      } catch {
        // 冒泡是锦上添花,失败静默
      }
    })();
  }, []);

  const updateMessage = (id: number, patch: Partial<ChatMessage>) =>
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );

  /** 跑一轮对话:history 含触发本轮的用户消息;不追加 user 气泡(调用方已处理) */
  const runTurn = async (history: ChatMessage[]) => {
    setBusy(true);
    const assistantId = ++idRef.current;
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", parts: [], pending: true },
    ]);

    const abort = new AbortController();
    abortRef.current = abort;
    const apiHistory = history.map(({ role, content }) => ({ role, content }));

    try {
      const result = await runAgentTurn({
        apiUrl: API_URL,
        history: apiHistory,
        locale,
        signal: abort.signal,
        currentPath: pathname,
        deep,
        onParts: (parts) => updateMessage(assistantId, { parts }),
      });
      updateMessage(assistantId, {
        content: result.content || t("empty"),
        parts: result.parts,
        suggestions: result.suggestions,
        pending: false,
      });
    } catch (error) {
      if (!abort.signal.aborted) {
        updateMessage(assistantId, {
          content: t("error"),
          failed: true,
          errorReason: error instanceof Error ? error.message : String(error),
          pending: false,
        });
        console.error("[agent] turn failed:", error);
      }
    } finally {
      setBusy(false);
    }
  };

  /** 重发:撤掉最后一条 assistant(失败或不满意的),基于其前最后一条 user 重跑 */
  const regenerate = () => {
    if (busy) return;
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx === -1) return;
    const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf("assistant");
    const history = messages.slice(0, lastUserIdx + 1);
    if (lastAssistantIdx > lastUserIdx) {
      setMessages(messages.slice(0, lastAssistantIdx));
    }
    runTurn(history);
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");

    // 隐藏指令彩蛋:本地回复,不占模型调用
    const egg = EASTER_EGGS[text.toLowerCase()];
    if (egg) {
      const parts: AgentPart[] = [{ type: "text", content: t(egg.key) }];
      if (egg.navMusic) {
        parts.push({
          type: "tool",
          call: { name: "navigate", args: { path: "/music/", label: t("eggNavMusic") } },
        });
      }
      setMessages((prev) => [
        ...prev,
        { id: ++idRef.current, role: "user", content: text },
        { id: ++idRef.current, role: "assistant", content: t(egg.key), parts },
      ]);
      return;
    }

    const userMsg: ChatMessage = { id: ++idRef.current, role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages((prev) => [...prev, userMsg]);
    await runTurn(history);
  };

  // ref 转发最新的 send(每次渲染后同步,lint 不允许渲染期写 ref)
  useEffect(() => {
    sendRef.current = send;
  });

  const clear = () => {
    abortRef.current?.abort();
    setMessages([]);
    setBusy(false);
  };

  const markDigestSeen = (date: string) => {
    try {
      localStorage.setItem(SEEN_DIGEST_KEY, date);
    } catch {
      // 存不上就每次冒一下,无妨
    }
    setDigestBubble(null);
  };

  return (
    <div
      className={
        mode === "dock" && open
          ? "fixed inset-y-0 right-0 z-50"
          : "fixed bottom-5 right-5 z-50 sm:bottom-6 sm:right-6"
      }
    >
      {open ? (
        <div
          data-selection-ask="off"
          className={
            mode === "dock"
              ? "group/panel relative flex h-full w-[calc(100vw-2.5rem)] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden border-0 border-l border-hairline bg-background shadow-2xl shadow-black/10"
              : "group/panel relative flex max-h-[calc(100dvh-6rem)] w-[calc(100vw-2.5rem)] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-hairline bg-background shadow-2xl shadow-black/10"
          }
          style={{ width: size.w, height: mode === "dock" ? "100%" : size.h }}
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
              <AcaneAvatar busy={busy} />
              {t("title")}
              <button
                type="button"
                onClick={() => setDeep((d) => !d)}
                aria-pressed={deep}
                title={t("deepModeHint")}
                className={`ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[0.7rem] transition-colors duration-300 ease-premium ${
                  deep
                    ? "bg-accent text-white"
                    : "bg-foreground/5 text-muted hover:text-accent"
                }`}
              >
                <Binoculars size={11} aria-hidden />
                {t("deepMode")}
              </button>
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleMode}
                aria-label={mode === "float" ? t("dockMode") : t("floatMode")}
                title={mode === "float" ? t("dockMode") : t("floatMode")}
                className="rounded-md p-1.5 text-muted transition-colors duration-300 ease-premium hover:text-accent"
              >
                {mode === "float" ? (
                  <SidebarSimple size={15} aria-hidden />
                ) : (
                  <PictureInPicture size={15} aria-hidden />
                )}
              </button>
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
                <DailyBrief onAsk={send} />
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
              <ChatMessages messages={messages} onSuggestion={send} onRetry={regenerate} />
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
        <div className="relative">
          {digestBubble ? (
            <div className="animate-fade-up absolute bottom-full right-0 mb-3 flex w-56 items-start gap-1.5 rounded-xl border border-hairline bg-background p-3 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  const date = digestBubble;
                  markDigestSeen(date);
                  setOpen(true);
                  sendRef.current(t("newDigestAsk", { date }));
                }}
                className="flex-1 text-left text-xs leading-relaxed text-muted transition-colors duration-300 ease-premium hover:text-accent"
              >
                {t("newDigestBubble")}
                <span className="mt-0.5 block font-mono text-[0.7rem]">{digestBubble}</span>
              </button>
              <button
                type="button"
                onClick={() => markDigestSeen(digestBubble)}
                aria-label={t("close")}
                className="rounded p-0.5 text-muted transition-colors duration-300 ease-premium hover:text-foreground"
              >
                <X size={11} aria-hidden />
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("open")}
            title={t("title")}
            className="rounded-full bg-accent p-3.5 text-white shadow-lg shadow-accent/25 transition-transform duration-300 ease-premium hover:scale-105"
          >
            <Sparkle size={20} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

/** 未配置 NEXT_PUBLIC_AGENT_API 时不渲染(保持原有早退语义,且不违反 hooks 顺序) */
export default function AgentWidget() {
  if (!API_URL) return null;
  return <AgentWidgetInner />;
}
