"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Link, usePathname } from "@/i18n/navigation";
import { isActivePath, navItems } from "./NavLinks";

const mobileItems = [...navItems, { href: "/friends", key: "friends" }] as const;

/**
 * 移动端菜单:汉堡两条线 morph 成 X → 全屏毛玻璃 overlay(z-35,
 * 故意低于导航,让胶囊始终可点关闭)。
 * 菜单项多于一屏时(小屏手机 / 横屏)overlay 自身滚动:body 已锁滚动,
 * 不能指望页面滚;顶部留出胶囊的高度。
 * overlay 走 portal:胶囊上的 backdrop-filter 会让 fixed 后代以其为包含块。
 */
export default function MobileNav() {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);

  // 路由变化在渲染期间比对 pathname 收起(不用 effect setState)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // open 只能由客户端事件置真,portal 不会出现在服务端渲染里
  const overlay = open
    ? createPortal(
          <div className="fixed inset-0 z-35 overflow-y-auto overscroll-contain bg-background/80 backdrop-blur-xl">
            <nav
              aria-label={t("footer.nav")}
              className="flex min-h-full flex-col items-center justify-center gap-5 px-6 pb-10 pt-24"
            >
              {mobileItems.map(({ href, key }, i) => (
                <Link
                  key={key}
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={
                    isActivePath(pathname, href) ? "page" : undefined
                  }
                  className="animate-fade-up text-2xl font-medium tracking-tight"
                  style={{ "--stagger": `${i * 35}ms` } as CSSProperties}
                >
                  {t(`nav.${key}`)}
                </Link>
              ))}
            </nav>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="flex items-center md:hidden">
      <button
        type="button"
        aria-label={open ? t("header.closeMenu") : t("header.openMenu")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors duration-300 ease-premium hover:text-foreground active:scale-[0.98]"
      >
        <span
          className={`absolute h-px w-4 bg-current transition-all duration-300 ease-premium ${
            open ? "rotate-45" : "-translate-y-[3px]"
          }`}
        />
        <span
          className={`absolute h-px w-4 bg-current transition-all duration-300 ease-premium ${
            open ? "-rotate-45" : "translate-y-[3px]"
          }`}
        />
      </button>
      {overlay}
    </div>
  );
}
