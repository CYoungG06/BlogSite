"use client";

import { X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * 图片灯箱:点击正文图片 → 全屏毛玻璃遮罩 + 大图。
 * Esc / 点击任意处关闭;打开时锁滚动。
 * z-50:z 体系(DESIGN.md §2.5)之外的唯一新层,灯箱必须在胶囊导航之上。
 */
export default function Lightbox({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{ src: string; alt: string } | null>(
    null,
  );

  const close = useCallback(() => setActive(null), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      // 图片在链接里时让位给链接跳转
      if (target.closest("a")) return;
      event.preventDefault();
      setActive({ src: target.currentSrc || target.src, alt: target.alt });
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!active) return;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active, close]);

  return (
    <>
      <div ref={containerRef}>{children}</div>
      {active
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={active.alt || "图片预览"}
              onClick={close}
              className="animate-lightbox fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center bg-background/90 p-4 backdrop-blur-xl sm:p-10"
            >
              <button
                type="button"
                onClick={close}
                aria-label="关闭"
                className="absolute top-5 right-5 flex h-9 w-9 items-center justify-center rounded-full text-muted ring-1 ring-hairline transition-colors duration-300 ease-premium hover:text-foreground active:scale-[0.98]"
              >
                <X size={16} />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={active.src}
                alt={active.alt}
                className="max-h-[85vh] max-w-full rounded-lg object-contain ring-1 ring-hairline"
              />
              {active.alt ? (
                <p className="mt-4 max-w-2xl text-center font-mono text-xs text-muted">
                  {active.alt}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
