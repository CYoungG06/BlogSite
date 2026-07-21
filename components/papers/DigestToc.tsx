"use client";

import { useEffect, useState } from "react";

export interface TocItem {
  id: string;
  label: string;
  sub?: boolean;
}

/** 速递页侧边索引:sticky 定位 + IntersectionObserver 滚动监听高亮当前分区 */
export default function DigestToc({
  items,
  title,
}: {
  items: TocItem[];
  title: string;
}) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      // 视口上部一条窄带内出现即视为当前分区
      { rootMargin: "-15% 0px -75% 0px" },
    );
    for (const { id } of items) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label={title} className="sticky top-24 font-mono text-xs">
      <p className="text-muted">{title}</p>
      <ul className="mt-3 space-y-2 border-l border-hairline">
        {items.map((item) => (
          <li key={item.id} className={item.sub ? "pl-4" : "pl-3"}>
            <a
              href={`#${item.id}`}
              className={`transition-colors duration-300 ease-premium ${
                active === item.id
                  ? "text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
