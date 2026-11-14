"use client";

import { useTranslations } from "next-intl";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import HeaderSearch from "@/components/search/HeaderSearch";
import { Link, usePathname } from "@/i18n/navigation";
import MobileNav from "./MobileNav";
import NavLinks, { isActivePath } from "./NavLinks";

/** 手机端胶囊里常驻的两个入口(其余栏目在菜单里);搜索展开时让出位置 */
const QUICK_LINKS = [
  { href: "/blog", key: "blog" },
  { href: "/papers", key: "papersShort" },
] as const;

function MobileQuickLinks() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("blog")}
      className="flex items-center md:hidden group-has-[[data-search-open]]/pill:hidden"
    >
      {QUICK_LINKS.map(({ href, key }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm transition-colors duration-300 ease-premium ${
              active
                ? "bg-foreground/5 text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * 悬浮胶囊导航(Fluid Island)— 见 DESIGN.md §5.1
 * 毛玻璃 backdrop-blur 只允许出现在 sticky/fixed 元素上。
 */
export default function HeaderBar() {
  return (
    <header className="sticky top-3 z-40 px-3 print:hidden">
      <div className="group/pill relative mx-auto flex h-12 w-max max-w-full items-center gap-0.5 rounded-full bg-background/70 px-2 shadow-soft ring-1 ring-hairline backdrop-blur-xl">
        <NavLinks className="hidden md:flex" />
        <MobileQuickLinks />
        <HeaderSearch />
        <LanguageToggle />
        <ThemeToggle />
        <MobileNav />
      </div>
    </header>
  );
}
