"use client";

import { useEffect, useState } from "react";
import type { TocItem } from "@/lib/markdown";

/**
 * TOC scroll-spy:IntersectionObserver,当前项 accent 左边线。
 * variant:sidebar(桌面右栏 sticky)/ inline(移动端 details 折叠)。
 */
export default function TableOfContents({
  items,
  title,
  variant,
}: {
  items: TocItem[];
  title: string;
  variant: "sidebar" | "inline";
}) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const headings = items
      .map((item) => document.getElementById(item.slug))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        }
      },
      { rootMargin: "-96px 0px -66% 0px" },
    );
    for (const heading of headings) observer.observe(heading);
    return () => observer.disconnect();
  }, [items]);

  const list = (
    <ul>
      {items.map((item) => (
        <li key={item.slug}>
          <a
            href={`#${item.slug}`}
            onClick={() => setActive(item.slug)}
            className={`-ml-px block border-l-2 py-1 text-sm leading-snug transition-colors duration-300 ease-premium ${
              item.depth === 3 ? "pl-7" : "pl-3"
            } ${
              active === item.slug
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {item.text}
          </a>
        </li>
      ))}
    </ul>
  );

  if (variant === "inline") {
    return (
      <details className="rounded-2xl bg-surface px-5 py-4 ring-1 ring-hairline">
        <summary className="cursor-pointer font-mono text-xs text-muted select-none">
          {title}
        </summary>
        <nav className="mt-3" aria-label={title}>
          {list}
        </nav>
      </details>
    );
  }

  return (
    <nav aria-label={title}>
      <p className="mb-3 font-mono text-xs text-muted">{title}</p>
      {list}
    </nav>
  );
}
