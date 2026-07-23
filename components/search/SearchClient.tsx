"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useSearch } from "./use-search";

/**
 * /search 独立页:完整结果列表(上限 20 条),与顶栏共享 useSearch
 * 的模块级索引缓存(同 locale 只 fetch + 反序列化一次)。
 */
export default function SearchClient() {
  const t = useTranslations("search");
  const { ready, error, search } = useSearch();
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const results = search(trimmed);

  return (
    <div className="pb-16">
      <input
        autoFocus
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("placeholder")}
        aria-label={t("title")}
        className="h-11 w-full rounded-full bg-surface px-5 font-mono text-sm ring-1 ring-hairline outline-none transition-shadow duration-300 ease-premium placeholder:text-muted/70 focus:ring-2 focus:ring-accent/40"
      />

      <div className="mt-8">
        {!trimmed ? (
          <p className="text-muted">{t("startTyping")}</p>
        ) : !ready && !error ? (
          /* 索引未加载完:简单显示加载提示 */
          <p className="font-mono text-sm text-muted">…</p>
        ) : results.length > 0 ? (
          <>
            <p className="font-mono text-xs text-muted">
              {t("results", { count: results.length })}
            </p>
            <ul>
              {results.map((item) => (
                <li key={`${item.type}/${item.slug}`}>
                  <Link
                    href={
                      item.type === "post"
                        ? `/blog/${item.slug}`
                        : item.type === "distilled"
                          ? `/distilled/${item.slug}`
                          : item.type === "reading"
                            ? `/reading/${item.slug}`
                            : `/notes/${item.slug}`
                    }
                    className="group block border-b border-hairline py-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 font-mono text-xs text-muted ring-1 ring-hairline">
                        {item.type === "post" ? t("typePost") : t("typeNote")}
                      </span>
                      <span className="truncate font-medium transition-colors duration-300 ease-premium group-hover:text-accent">
                        {item.title}
                      </span>
                    </div>
                    {item.description ? (
                      <p className="mt-1.5 line-clamp-2 text-sm text-muted">
                        {item.description}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted">{t("noResults", { query: trimmed })}</p>
        )}
      </div>
    </div>
  );
}
