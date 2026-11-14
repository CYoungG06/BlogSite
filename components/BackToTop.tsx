"use client";

import { ArrowUp } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/**
 * 回到顶部:滚过一屏半才出现,叠在助手按钮正上方(水平居中对齐)。
 * 只放在长页面(文章 / 深度解读 / 单日速递)。
 */
export default function BackToTop() {
  const t = useTranslations("article");
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 1.5);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label={t("backToTop")}
      title={t("backToTop")}
      tabIndex={show ? 0 : -1}
      aria-hidden={show ? undefined : true}
      onClick={() =>
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        })
      }
      className={`fixed bottom-[5.25rem] right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-muted shadow-soft ring-1 ring-hairline backdrop-blur transition-all duration-300 ease-premium hover:text-foreground sm:bottom-[5.6rem] sm:right-7 print:hidden ${
        show ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <ArrowUp size={16} aria-hidden />
    </button>
  );
}
