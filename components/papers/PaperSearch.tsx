"use client";

import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { basePath } from "@/lib/images";

/** api/papers/titles/<YYYY-MM>.json 的一行(scripts/generate-papers-api.mjs 产出,字段名压缩) */
interface TitleRow {
  /** 速递日期 */
  d: string;
  /** arXiv id(也是速递页上卡片的锚点) */
  i: string;
  /** 英文原题 */
  t: string;
  /** 中文译名 */
  z?: string;
  /** 兴趣评分 */
  s?: number;
}

const LIMIT = 50;

/**
 * 速递归档页的论文搜索:按标题(中英文)在全部速递里找论文,结果直达当天速递里的那张卡片。
 * 索引按月分片,第一次聚焦搜索框才开始加载,从最近的月份往前载,边载边出结果 ——
 * 速递每天新增约 80 篇,一次性下载全量会越来越重。
 */
export default function PaperSearch() {
  const t = useTranslations("papers");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<TitleRow[]>([]);
  const [loadingMonth, setLoadingMonth] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [issues, setIssues] = useState(0);
  const started = useRef(false);

  const load = async () => {
    if (started.current) return;
    started.current = true;
    setStatus("loading");
    try {
      const res = await fetch(`${basePath}/api/papers/titles/index.json`);
      if (!res.ok) throw new Error(String(res.status));
      const index = (await res.json()) as { months: string[]; issues: number };
      setIssues(index.issues);
      for (const month of index.months) {
        setLoadingMonth(month);
        const chunk = await fetch(`${basePath}/api/papers/titles/${month}.json`);
        if (!chunk.ok) throw new Error(String(chunk.status));
        const list = (await chunk.json()) as TitleRow[];
        setRows((prev) => prev.concat(list));
      }
      setStatus("done");
    } catch {
      setStatus("error");
    } finally {
      setLoadingMonth(null);
    }
  };

  const terms = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );
  const matches = useMemo(() => {
    if (terms.length === 0) return [];
    return rows.filter((row) => {
      const haystack = `${row.t} ${row.z ?? ""}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [rows, terms]);

  const statusText =
    status === "error"
      ? t("searchFailed")
      : status === "loading" && loadingMonth
        ? t("searchLoading", { month: loadingMonth })
        : status === "done"
          ? t("searchDone", { issues })
          : null;

  return (
    <section className="pb-12" aria-label={t("searchLabel")}>
      <div className="relative">
        <MagnifyingGlass
          size={15}
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          value={query}
          onFocus={load}
          onChange={(event) => {
            void load();
            setQuery(event.target.value);
          }}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          className="h-11 w-full rounded-full bg-surface pl-10 pr-10 text-sm ring-1 ring-hairline outline-none transition-shadow duration-300 ease-premium placeholder:text-muted/70 focus:ring-2 focus:ring-accent/40 [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("searchClear")}
            className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors duration-300 ease-premium hover:text-foreground"
          >
            <X size={13} aria-hidden />
          </button>
        ) : null}
      </div>

      {terms.length > 0 ? (
        <div className="mt-4" aria-live="polite">
          <p className="font-mono text-xs text-muted">
            {t("searchCount", { count: matches.length })}
            {statusText ? ` · ${statusText}` : ""}
          </p>
          {matches.length > 0 ? (
            <ul className="mt-2">
              {matches.slice(0, LIMIT).map((row) => (
                <li key={`${row.d}/${row.i}`} className="border-b border-hairline first:border-t">
                  <Link
                    href={`/papers/${row.d}/#${row.i}`}
                    className="group flex items-baseline gap-3 py-2.5"
                  >
                    <time dateTime={row.d} className="shrink-0 font-mono text-xs text-muted">
                      {row.d}
                    </time>
                    {row.s !== undefined ? (
                      <span className="w-6 shrink-0 font-mono text-xs text-accent/80">{row.s}</span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-sm transition-colors duration-300 ease-premium group-hover:text-accent">
                      {locale === "zh" && row.z ? row.z : row.t}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : status !== "loading" ? (
            <p className="mt-2 text-sm text-muted">{t("searchEmpty")}</p>
          ) : null}
          {matches.length > LIMIT ? (
            <p className="mt-2 font-mono text-xs text-muted">{t("searchTruncated", { limit: LIMIT })}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
