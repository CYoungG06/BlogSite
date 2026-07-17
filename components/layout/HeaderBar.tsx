"use client";

import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import HeaderSearch from "@/components/search/HeaderSearch";
import MobileNav from "./MobileNav";
import NavLinks from "./NavLinks";

/**
 * 悬浮胶囊导航(Fluid Island)— 见 DESIGN.md §5.1
 * 毛玻璃 backdrop-blur 只允许出现在 sticky/fixed 元素上。
 */
export default function HeaderBar() {
  return (
    <header className="sticky top-3 z-40 px-3">
      <div className="relative mx-auto flex h-12 w-max max-w-full items-center gap-0.5 rounded-full bg-background/70 px-2 shadow-soft ring-1 ring-hairline backdrop-blur-xl">
        <NavLinks className="hidden md:flex" />
        <HeaderSearch />
        <LanguageToggle />
        <ThemeToggle />
        <MobileNav />
      </div>
    </header>
  );
}

