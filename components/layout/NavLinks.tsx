"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export const navItems = [
  { href: "/", key: "home" },
  { href: "/blog", key: "blog" },
  { href: "/distilled", key: "distilled" },
  { href: "/papers", key: "papers" },
  { href: "/notes", key: "notes" },
  { href: "/projects", key: "projects" },
  { href: "/music", key: "music" },
  { href: "/about", key: "about" },
] as const;

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function NavLinks({ className = "" }: { className?: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav className={`items-center ${className}`}>
      {navItems.map(({ href, key }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={key}
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
