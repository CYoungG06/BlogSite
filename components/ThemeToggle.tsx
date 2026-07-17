"use client";

import { Monitor, Moon, Sun } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { flushSync } from "react-dom";
import { useMounted } from "@/lib/use-mounted";

type ThemeMode = "light" | "dark" | "system";

const order: ThemeMode[] = ["light", "dark", "system"];

export default function ThemeToggle() {
  const t = useTranslations("header");
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  const current: ThemeMode =
    theme === "light" || theme === "dark" || theme === "system"
      ? theme
      : "system";

  const label =
    current === "light"
      ? t("themeLight")
      : current === "dark"
        ? t("themeDark")
        : t("themeSystem");

  const cycle = () => {
    const next = order[(order.indexOf(current) + 1) % order.length];
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!reduced && typeof document.startViewTransition === "function") {
      document.startViewTransition(() => {
        flushSync(() => setTheme(next));
      });
    } else {
      setTheme(next);
    }
  };

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors duration-300 ease-premium hover:text-foreground active:scale-[0.98]"
    >
      {/* mount 后才渲染图标,防水合闪烁 */}
      {mounted ? (
        current === "light" ? (
          <Sun size={18} weight="regular" />
        ) : current === "dark" ? (
          <Moon size={18} weight="regular" />
        ) : (
          <Monitor size={18} weight="regular" />
        )
      ) : (
        <span className="block h-[18px] w-[18px]" />
      )}
    </button>
  );
}
