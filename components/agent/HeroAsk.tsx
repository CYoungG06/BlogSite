"use client";

import { ArrowRight, Sparkle } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { openAgent } from "@/lib/agent/bus";

/**
 * 首页 Hero 大输入框:让 AI 助手成为站点大门。
 * 回车/点击 = 打开助手面板并自动发送。
 */
export default function HeroAsk() {
  const t = useTranslations("agent");
  const [value, setValue] = useState("");

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const text = value.trim();
    if (!text) return;
    openAgent({ prompt: text });
    setValue("");
  };

  return (
    <form
      onSubmit={submit}
      className="flex h-12 max-w-xl items-center gap-3 rounded-full pl-5 pr-2 ring-1 ring-hairline transition-shadow duration-300 ease-premium focus-within:ring-accent"
    >
      <Sparkle size={16} className="shrink-0 text-accent" aria-hidden />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("heroAskPlaceholder")}
        aria-label={t("heroAskPlaceholder")}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
        autoComplete="off"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        aria-label={t("send")}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity duration-300 ease-premium disabled:opacity-40"
      >
        <ArrowRight size={15} aria-hidden />
      </button>
    </form>
  );
}
