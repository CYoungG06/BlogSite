"use client";

import {
  ArrowDown,
  ClockCounterClockwise,
  NotePencil,
  PaperPlaneRight,
  PictureInPicture,
  SidebarSimple,
  Sparkle,
  Binoculars,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { runAgentTurn, type AgentPart } from "@/lib/agent/chat";
import { AGENT_OPEN_EVENT, type AgentOpenRequest } from "@/lib/agent/bus";
import {
  createSessionId,
  deleteSession,
  loadLatestSession,
  loadSessions,
  saveSession,
  type ChatSession,
} from "@/lib/agent/history";
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
  // 会话历史:启动时恢复最近会话(刷新/重开浏览器不丢),回答结束自动落盘
  const [boot] = useState(() => {
    const latest = loadLatestSession();
    return {
      sessionId: latest?.id ?? null,
      messages: latest?.messages ?? [],
      maxId: Math.max(0, ...(latest?.messages ?? []).map((m) => m.id)),
    };
  });
  const [messages, setMessages] = useState<ChatMessage[]>(boot.messages);
  const [sessionId, setSessionId] = useState<string | null>(boot.sessionId);
  /** 历史会话列表(抽屉展示),抽屉打开/删除时从存储加载 */
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  /** 历史抽屉开关 */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState(loadSize);
  /** 面板形态:float 浮窗(锚定右下)/ dock 贴边伴读(贴右全高) */
  const [mode, setMode] = useState<"float" | "dock">(loadMode);
  /** 深度调研模式:更多工具轮数、更长输出、调研者 prompt */
  const [deep, setDeep] = useState(false);
  /** 主动冒泡:检测到新一期速递且用户没见过时,展示其日期 */
  const [digestBubble, setDigestBubble] = useState<string | null>(null);
  /** 服务可达性:面板打开时探测 /health,不通则挂提示横幅 */
  const [netDown, setNetDown] = useState(false);
  /** 滚动跟随:true=贴底自动滚;用户上翻置 false,出「回到底部」钮 */
  const [stick, setStick] = useState(true);
  // id 计数从恢复的最大 id 续起,避免撞号
  const idRef = useRef(boot.maxId);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  // 贴底时新内容自动滚到底;上翻阅读时不打扰
  useEffect(() => {
    const el = scrollRef.current;
    if (el && open && stick) el.scrollTop = el.scrollHeight;
  }, [messages, open, stick]);

  const onChatScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    setStick(true);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  // 输入框随内容自动长高(上限 7rem,与 textarea max-h-28 一致)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [input]);

  // 打开面板时聚焦输入框(仅桌面,移动端避免弹起键盘)
  useEffect(() => {
    if (open && window.matchMedia("(pointer: fine)").matches) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Esc 逐层关闭:先关历史抽屉,再关面板
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (historyOpen) setHistoryOpen(false);
      else setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, historyOpen]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // 会话历史落盘:每轮回答结束(busy→false)才写,流式中途不写。
  // sessionId 由 send() 在发消息时确保存在,这里只写不建
  useEffect(() => {
    if (busy || !messages.length || !sessionId) return;
    saveSession(sessionId, messages);
  }, [messages, busy, sessionId]);

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
        // fetch 的 TypeError 是连接级失败(网络阻断/DNS),和 HTTP 错误码分开提示
        const isNetwork = error instanceof TypeError;
        updateMessage(assistantId, {
          content: isNetwork ? t("errorNetwork") : t("error"),
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
    setStick(true); // 发消息时强制回到底部
    // 新会话在首次发消息时建 id,落盘 effect 只写不建
    if (!sessionId) setSessionId(createSessionId());

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

  // 服务可达性探测:每次打开面板 ping 一次 /health(不消耗聊天限流)
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/health`);
        setNetDown(!res.ok);
      } catch {
        setNetDown(true);
      }
    })();
  }, [open]);

  // ref 转发最新的 send(每次渲染后同步,lint 不允许渲染期写 ref)
  useEffect(() => {
    sendRef.current = send;
  });

  /** 新对话:清空当前视图开新会话;旧对话已落盘,留在历史列表里 */
  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(null);
    setBusy(false);
    setStick(true);
    setHistoryOpen(false);
  };

  /** 切到历史会话:id 计数对齐全,避免新消息撞号 */
  const openSession = (session: ChatSession) => {
    abortRef.current?.abort();
    setBusy(false);
    setMessages(session.messages);
    setSessionId(session.id);
    idRef.current = Math.max(idRef.current, ...session.messages.map((m) => m.id));
    setStick(true);
    setHistoryOpen(false);
  };

  const removeSession = (id: string) => {
    deleteSession(id);
    setSessions(loadSessions());
    // 删的是正开着的会话:视图一并清掉
    if (id === sessionId) {
      setMessages([]);
      setSessionId(null);
    }
  };

  /** 打开抽屉时从存储刷新列表(平时不常驻同步) */
  const toggleHistory = () => {
    if (!historyOpen) setSessions(loadSessions());
    setHistoryOpen((v) => !v);
  };

  /** 空状态问候:按时段变化 */
  const greeting = () => {
    const h = new Date().getHours();
    if (h < 6) return t("greetingNight");
    if (h < 12) return t("greetingMorning");
    if (h < 18) return t("greetingAfternoon");
    return t("greetingEvening");
  };

  /** 历史会话按 今天/昨天/本周/更早 分组(列表已按时间倒序) */
  const groupOf = (ts: number) => {
    const start = new Date().setHours(0, 0, 0, 0);
    if (ts >= start) return t("groupToday");
    if (ts >= start - 86400000) return t("groupYesterday");
    if (ts >= start - 6 * 86400000) return t("groupThisWeek");
    return t("groupEarlier");
  };

  const sessionGroups = (() => {
    const groups: { label: string; items: ChatSession[] }[] = [];
    for (const s of sessions) {
      const label = groupOf(s.updatedAt);
      const last = groups[groups.length - 1];
      if (last?.label === label) last.items.push(s);
      else groups.push({ label, items: [s] });
    }
    return groups;
  })();

  /** 当天的会话只显时分,更早的带月日 */
  const formatSessionDate = (ts: number) => {
    const sameDay = ts >= new Date().setHours(0, 0, 0, 0);
    return new Date(ts).toLocaleString(
      locale === "zh" ? "zh-CN" : "en-US",
      sameDay
        ? { hour: "numeric", minute: "2-digit" }
        : { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" },
    );
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
                onClick={toggleHistory}
                aria-label={t("history")}
                title={t("history")}
                aria-pressed={historyOpen}
                className={`rounded-md p-1.5 transition-colors duration-300 ease-premium hover:text-accent ${
                  historyOpen ? "text-accent" : "text-muted"
                }`}
              >
                <ClockCounterClockwise size={15} aria-hidden />
              </button>
              <button
                type="button"
                onClick={newChat}
                aria-label={t("newChat")}
                title={t("newChat")}
                className="rounded-md p-1.5 text-muted transition-colors duration-300 ease-premium hover:text-accent"
              >
                <NotePencil size={15} aria-hidden />
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

          {historyOpen ? (
            <div className="animate-drawer-in absolute inset-0 z-20 flex flex-col bg-background">
              <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
                <p className="text-sm font-medium tracking-tight">{t("history")}</p>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  aria-label={t("close")}
                  className="rounded-md p-1.5 text-muted transition-colors duration-300 ease-premium hover:text-accent"
                >
                  <X size={15} aria-hidden />
                </button>
              </header>
              <div className="flex-1 overflow-y-auto p-2">
                {sessions.length === 0 ? (
                  <p className="px-2 py-8 text-center text-xs text-muted">
                    {t("emptyHistory")}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {sessionGroups.map((g) => (
                      <li key={g.label}>
                        <p className="px-2.5 pb-1 pt-2.5 font-mono text-[0.65rem] uppercase tracking-wider text-muted/70">
                          {g.label}
                        </p>
                        <ul className="space-y-0.5">
                          {g.items.map((s, i) => (
                            <li
                              key={s.id}
                              style={{ "--stagger": `${Math.min(i, 8) * 40}ms` } as CSSProperties}
                              className="group/item animate-msg-in relative"
                            >
                              <button
                                type="button"
                                onClick={() => openSession(s)}
                                className={`w-full rounded-lg px-2.5 py-2 pr-8 text-left transition-colors duration-300 ease-premium hover:bg-foreground/5 ${
                                  s.id === sessionId ? "bg-foreground/5" : ""
                                }`}
                              >
                                <span className="block truncate text-sm">{s.title}</span>
                                <span className="mt-0.5 block font-mono text-[0.7rem] text-muted">
                                  {formatSessionDate(s.updatedAt)}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => removeSession(s.id)}
                                aria-label={t("deleteSession")}
                                title={t("deleteSession")}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted transition-all duration-300 ease-premium hover:text-accent sm:opacity-0 sm:group-hover/item:opacity-100"
                              >
                                <Trash size={13} aria-hidden />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={scrollRef} onScroll={onChatScroll} className="flex-1 overflow-y-auto px-4 py-4">
            {netDown ? (
              <p className="mb-3 rounded-lg border border-hairline bg-foreground/[0.03] px-3 py-2 text-xs leading-relaxed text-muted">
                {t("networkBanner")}
              </p>
            ) : null}
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm font-medium tracking-tight">{greeting()}</p>
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
            {!stick && messages.length > 0 ? (
              <button
                type="button"
                onClick={jumpToBottom}
                className="animate-msg-in absolute bottom-3 right-4 z-10 flex items-center gap-1 rounded-full border border-hairline bg-background px-2.5 py-1 text-xs text-muted shadow-md shadow-black/5 transition-colors duration-300 ease-premium hover:text-accent"
              >
                <ArrowDown size={11} aria-hidden />
                {t("scrollBottom")}
              </button>
            ) : null}
          </div>

          <form
            className="flex items-end gap-2 border-t border-hairline px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter 发送,Shift+Enter 换行;中文输入法组词中的 Enter 不触发
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={t("placeholder")}
              className="max-h-28 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed outline-none placeholder:text-muted"
              // 面板内输入不需要浏览器自动纠错
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label={t("send")}
              className="mb-0.5 rounded-full bg-accent p-2 text-white transition-opacity duration-300 ease-premium disabled:opacity-40"
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
