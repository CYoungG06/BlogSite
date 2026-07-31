"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import researchData from "@/content/research/research.json";

export const navItems = [
  { href: "/", key: "home" },
  { href: "/research", key: "research" },
  { href: "/blog", key: "blog" },
  { href: "/distilled", key: "distilled" },
  { href: "/reading", key: "reading" },
  { href: "/papers", key: "papers" },
  { href: "/notes", key: "notes" },
  { href: "/projects", key: "projects" },
  { href: "/music", key: "music" },
  { href: "/about", key: "about" },
] as const;

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface WorkEntry {
  slug?: string;
  shortTitle?: string;
  title: string;
  venue: string;
  contribution: "first" | "co-first" | "author";
}

const CONTRIBUTION_KEYS = {
  first: "first",
  "co-first": "coFirst",
  author: "author",
} as const;

/** 有详情页的工作,进入「研究」下拉菜单 */
const works = (researchData.publications as WorkEntry[]).filter((p) => p.slug);

export default function NavLinks({ className = "" }: { className?: string }) {
  const t = useTranslations("nav");
  const tr = useTranslations("research");
  const pathname = usePathname();

  return (
    <nav className={`items-center ${className}`}>
      {navItems.map(({ href, key }) => {
        const active = isActivePath(pathname, href);
        const cls = `rounded-full px-3 py-1 text-sm transition-colors duration-300 ease-premium ${
          active
            ? "bg-foreground/5 text-foreground"
            : "text-muted hover:text-foreground"
        }`;
        if (key === "research" && works.length > 0) {
          // 研究:点击进入主页;悬停/聚焦弹出工作菜单直达详情页
          return (
            <div key={key} className="group relative">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                aria-haspopup="true"
                className={`inline-flex items-center gap-0.5 ${cls}`}
              >
                {t(key)}
                <CaretDown
                  size={10}
                  aria-hidden
                  className="transition-transform duration-300 ease-premium group-hover:rotate-180"
                />
              </Link>
              <div className="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2 opacity-0 transition-opacity duration-200 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                <div className="w-56 rounded-2xl bg-background p-1.5 shadow-soft ring-1 ring-hairline">
                  {works.map((w) => (
                    <Link
                      key={w.slug}
                      href={`/research/${w.slug}`}
                      className="block rounded-xl px-3 py-2 transition-colors duration-300 ease-premium hover:bg-foreground/5"
                    >
                      <span className="block truncate text-sm font-medium tracking-tight">
                        {w.shortTitle ?? w.title}
                      </span>
                      <span className="mt-0.5 block font-mono text-xs text-muted">
                        {w.venue} · {tr(CONTRIBUTION_KEYS[w.contribution])}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          );
        }
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cls}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
