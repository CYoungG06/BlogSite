"use client";

import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearch, type SearchResultItem } from "./use-search";

/**
 * 顶栏内联搜索(不跳页)— 见 DESIGN.md §5.2。
 * 同一个胶囊连续形变:搜索框容器 max-w-0 → max-w-[26rem] 过渡
 * (max-width 是唯一允许动画的尺寸属性),Logo/导航保持原位,胶囊随之变宽。
 * 收起态 inert + pointer-events-none,不进 Tab 序。
 * 透明幕布走 portal:胶囊的 backdrop-filter 会让 fixed 后代以其为包含块(踩过的坑)。
 */
export default function HeaderSearch() {
  const t = useTranslations("header");
  const tSearch = useTranslations("search");
  const router = useRouter();
  const pathname = usePathname();
  const { search } = useSearch();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [prevPathname, setPrevPathname] = useState(pathname);
  const inputRef = useRef<HTMLInputElement>(null);

  // 路由变化在渲染期间比对 pathname 收起(不用 effect setState)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (open) {
      setOpen(false);
      setQuery("");
    }
  }

  // 全局 ⌘K / Ctrl+K 打开;打开时 Esc 关闭(IME 组词中的 Esc 放行给输入法)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === "Escape" && !event.isComposing) {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 输入框常驻挂载(收起动画才能连续回放),autoFocus 属性只在挂载时生效,
  // 所以打开时用 ref 手动聚焦 — 这就是"打开即聚焦"的实现
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const results = search(query, 8);

  const goTo = (item: SearchResultItem) => {
    router.push(
      item.type === "post" ? `/blog/${item.slug}` : `/notes/${item.slug}`,
    );
    close();
  };

  return (
    <div className="relative flex items-center">
      {/* 触发按钮:打开后放大镜原位保留,胶囊连续变宽 */}
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={t("search")}
        aria-expanded={open}
        className={`flex h-9 items-center gap-1.5 rounded-full px-2.5 transition-colors duration-300 ease-premium active:scale-[0.98] ${
          open ? "text-foreground" : "text-muted hover:text-foreground"
        }`}
      >
        <MagnifyingGlass size={16} aria-hidden />
        <kbd className="hidden rounded-full bg-foreground/5 px-1.5 py-0.5 font-mono text-[0.65rem] leading-none text-muted sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* 搜索框容器:max-width 形变,overflow-hidden 裁切 */}
      <div
        inert={!open}
        className={`overflow-hidden transition-[max-width] duration-500 ease-premium ${
          open ? "max-w-[26rem]" : "pointer-events-none max-w-0"
        }`}
      >
        <div className="flex h-8 w-[clamp(10rem,30vw,26rem)] items-center gap-2 rounded-full bg-foreground/5 px-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("search")}
            className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted/70"
          />
          <kbd className="hidden shrink-0 rounded-full bg-foreground/5 px-1.5 py-0.5 font-mono text-[0.65rem] leading-none text-muted sm:inline">
            esc
          </kbd>
          <button
            type="button"
            onClick={close}
            aria-label={t("closeSearch")}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-300 ease-premium hover:text-foreground"
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      </div>

      {/* 结果面板:垂在胶囊下方(absolute,不推挤布局),最多 8 条 */}
      {open && results.length > 0 && (
        <div className="absolute inset-x-0 top-full mt-2 overflow-hidden rounded-3xl bg-background/95 shadow-soft ring-1 ring-hairline backdrop-blur-xl">
          <ul className="max-h-80 overflow-y-auto py-2">
            {results.map((item) => (
              <li key={`${item.type}/${item.slug}`}>
                <button
                  type="button"
                  onClick={() => goTo(item)}
                  className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-300 ease-premium hover:bg-foreground/5"
                >
                  <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 font-mono text-xs text-muted ring-1 ring-hairline">
                    {item.type === "post"
                      ? tSearch("typePost")
                      : tSearch("typeNote")}
                  </span>
                  <span className="truncate text-sm transition-colors duration-300 ease-premium group-hover:text-accent">
                    {item.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 透明幕布 z-30:点击外部关闭;胶囊在 z-40 内,层级天然高于幕布。
          open 只能由客户端事件置真,portal 不会出现在服务端渲染里 */}
      {open
        ? createPortal(
            <div
              aria-hidden
              className="fixed inset-0 z-30"
              onClick={close}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
