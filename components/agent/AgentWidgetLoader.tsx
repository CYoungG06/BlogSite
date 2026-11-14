"use client";

import { Spinner, Sparkle, X } from "@phosphor-icons/react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_OPEN_EVENT,
  AGENT_PRELOAD_EVENT,
  openAgent,
  type AgentOpenRequest,
} from "@/lib/agent/bus";
import { basePath } from "@/lib/images";

/**
 * 助手的轻量外壳:首屏只有右下角按钮(和新速递提醒气泡)。
 * 真正的面板(AgentWidget,含 Markdown / KaTeX 渲染,压缩后约 100 KB)
 * 等到有使用意图才加载 —— 悬停 / 聚焦 / 点按钮,或任何入口调用 openAgent / preloadAgent。
 * 面板就绪前收到的打开请求先排队,挂好后按序补发。
 * 外壳按钮与面板收起时的按钮样式、位置完全一致,交接时看不出替换。
 */

const API_URL = process.env.NEXT_PUBLIC_AGENT_API ?? "";
const importWidget = () => import("./AgentWidget");
const AgentWidget = dynamic(importWidget, { ssr: false, loading: () => null });

const SEEN_DIGEST_KEY = "acane-seen-digest";
const BUBBLE_SHOWN_KEY = "acane-digest-bubble-shown";
const BUBBLE_TIMEOUT_MS = 12_000;

export default function AgentWidgetLoader() {
  if (!API_URL) return null;
  return <AgentShell />;
}

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_DIGEST_KEY) ?? "";
  } catch {
    return "";
  }
}

function markSeen(date: string) {
  try {
    if (date > readSeen()) localStorage.setItem(SEEN_DIGEST_KEY, date);
  } catch {
    // 存不上就下次再提醒,无妨
  }
}

function AgentShell() {
  const t = useTranslations("agent");
  // pathname 带 locale 前缀(/zh/papers/2026-11-12/)
  const pathname = usePathname() ?? "";
  const onPapersPage = /^\/[a-z]{2}\/papers(\/|$)/.test(pathname);

  const [wanted, setWanted] = useState(false);
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const readyRef = useRef(false);
  const queue = useRef<AgentOpenRequest[]>([]);

  const want = useCallback(() => {
    void importWidget();
    setWanted(true);
  }, []);

  // 面板就绪前:打开请求排队并触发加载;预加载请求只触发加载
  useEffect(() => {
    const onOpen = (event: Event) => {
      if (readyRef.current) return; // 面板自己会处理
      queue.current.push((event as CustomEvent<AgentOpenRequest>).detail ?? {});
      setWaiting(true);
      want();
    };
    window.addEventListener(AGENT_OPEN_EVENT, onOpen);
    window.addEventListener(AGENT_PRELOAD_EVENT, want);
    return () => {
      window.removeEventListener(AGENT_OPEN_EVENT, onOpen);
      window.removeEventListener(AGENT_PRELOAD_EVENT, want);
    };
  }, [want]);

  const onReady = useCallback(() => {
    readyRef.current = true;
    setReady(true);
    setWaiting(false);
    for (const request of queue.current.splice(0)) openAgent(request);
  }, []);

  // 新速递提醒:每个浏览器会话最多一次;人在速递栏目里时不打扰
  const [bubble, setBubble] = useState<string | null>(null);
  const checked = useRef(false);
  useEffect(() => {
    if (onPapersPage || checked.current) return;
    checked.current = true;
    let cancelled = false;
    (async () => {
      try {
        if (sessionStorage.getItem(BUBBLE_SHOWN_KEY)) return;
        const res = await fetch(`${basePath}/api/papers/index.json`);
        if (!res.ok) return;
        const latest = (await res.json()).latest as string | undefined;
        if (cancelled || !latest || readSeen() >= latest) return;
        sessionStorage.setItem(BUBBLE_SHOWN_KEY, "1");
        setBubble(latest);
      } catch {
        // 提醒是锦上添花,失败静默
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onPapersPage]);

  // 看过某一期就记为已读(只往后记),没人理的提醒自己收起(不记已读)
  useEffect(() => {
    const viewed = pathname.match(/\/papers\/(\d{4}-\d{2}-\d{2})/)?.[1];
    if (viewed) markSeen(viewed);
  }, [pathname]);
  useEffect(() => {
    if (!bubble) return;
    const timer = setTimeout(() => setBubble(null), BUBBLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [bubble]);

  const showBubble = bubble && !onPapersPage && !ready;

  return (
    <>
      {wanted ? <AgentWidget onReady={onReady} /> : null}
      {ready ? null : (
        <div className="fixed bottom-5 right-5 z-50 sm:bottom-6 sm:right-6">
          <div className="relative">
            {showBubble ? (
              // 放在按钮左侧:按钮正上方留给文章页的「回到顶部」
              <div className="animate-fade-up absolute bottom-0 right-full mr-3 flex w-56 items-start gap-1.5 rounded-xl border border-hairline bg-background p-3 shadow-lg">
                <button
                  type="button"
                  onPointerEnter={want}
                  onClick={() => {
                    markSeen(bubble);
                    setBubble(null);
                    openAgent({ prompt: t("newDigestAsk", { date: bubble }) });
                  }}
                  className="flex-1 text-left text-xs leading-relaxed text-muted transition-colors duration-300 ease-premium hover:text-accent"
                >
                  {t("newDigestBubble")}
                  <span className="mt-0.5 block font-mono text-[0.7rem]">{bubble}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    markSeen(bubble);
                    setBubble(null);
                  }}
                  aria-label={t("close")}
                  className="rounded p-0.5 text-muted transition-colors duration-300 ease-premium hover:text-foreground"
                >
                  <X size={11} aria-hidden />
                </button>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => openAgent({})}
              onPointerEnter={want}
              onFocus={want}
              onTouchStart={want}
              aria-label={t("open")}
              aria-busy={waiting || undefined}
              title={t("title")}
              className="rounded-full bg-accent p-3.5 text-white shadow-lg shadow-accent/25 transition-transform duration-300 ease-premium hover:scale-105"
            >
              {waiting ? (
                <Spinner size={20} aria-hidden className="animate-spin" />
              ) : (
                <Sparkle size={20} aria-hidden />
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
