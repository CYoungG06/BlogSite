"use client";

import { Sparkle } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { openAgent } from "@/lib/agent/bus";

/**
 * 划词提问:选中页面正文文字(≥8 字符)后,在选区下方浮出
 * 「问阿卡内这段」气泡;点击 = 打开助手面板并携带引用自动发送。
 * 滚动 / 选区清空 / Esc 即隐藏;助手面板内部与输入控件里的选择不触发。
 */

const MIN_LEN = 8;
const MAX_QUOTE = 200;

interface BubblePos {
  top: number;
  left: number;
  quote: string;
}

export default function SelectionAsk() {
  const t = useTranslations("agent");
  const [bubble, setBubble] = useState<BubblePos | null>(null);

  useEffect(() => {
    const hide = () => setBubble(null);

    const onSelectionChange = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (!selection || text.length < MIN_LEN || selection.rangeCount === 0) {
        hide();
        return;
      }
      // 助手面板与表单控件内的选择不触发(避免自己套娃)
      const node = selection.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      if (el?.closest("[data-selection-ask='off'], input, textarea")) {
        hide();
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) {
        hide();
        return;
      }
      setBubble({
        top: rect.bottom + 10,
        left: Math.min(Math.max(rect.left, 12), window.innerWidth - 160),
        quote: text.slice(0, MAX_QUOTE),
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    // selectionchange 在拖动选中过程中也会触发,属预期(气泡跟随选区)
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("scroll", hide);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (!bubble) return null;

  return (
    <button
      type="button"
      style={{ top: bubble.top, left: bubble.left }}
      onClick={() => {
        openAgent({ prompt: t("selectionAskPrompt", { quote: bubble.quote }) });
        setBubble(null);
        window.getSelection()?.removeAllRanges();
      }}
      className="animate-fade-up fixed z-40 flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-lg transition-transform duration-300 ease-premium hover:scale-[1.03]"
    >
      <Sparkle size={12} aria-hidden />
      {t("selectionAskButton")}
    </button>
  );
}
