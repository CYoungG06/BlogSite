import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ArchiveKind } from "@/lib/archive";

/** 归档页列表项(只带渲染需要的字段,整份列表会序列化给客户端筛选组件) */
export interface ArchiveRow {
  kind: ArchiveKind;
  slug: string;
  title: string;
  date: string;
  tags: string[];
  href: string;
}

/** 栏目短标签(列表左侧的类型列) */
export const KIND_LABEL_KEY: Record<ArchiveKind, string> = {
  blog: "archive.kindBlog",
  distilled: "archive.kindDistilled",
  reading: "archive.kindReading",
  notes: "archive.kindNotes",
  insight: "archive.kindInsight",
};

/** 类型列宽:中文两个字,英文最长 Distilled */
export const KIND_COL = { zh: "w-8", en: "w-[4.6rem]" } as const;

const chip = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-xs ring-1 transition-colors duration-300 ease-premium ${
    active
      ? "bg-foreground text-background ring-foreground"
      : "bg-surface text-muted ring-hairline hover:text-foreground"
  }`;

/**
 * 归档列表:顶部标签筛选(写在 ?tag= 里,可分享),下面按年分组。
 * 服务端渲染完整列表;带 ?tag= 访问时由 ArchiveFilter 在客户端筛选。
 */
export default function ArchiveList({
  rows,
  tags,
  selected,
}: {
  rows: ArchiveRow[];
  tags: { tag: string; count: number }[];
  selected: string | null;
}) {
  const t = useTranslations();
  const kindCol = KIND_COL[useLocale() === "en" ? "en" : "zh"];
  const shown = selected ? rows.filter((r) => r.tags.includes(selected)) : rows;
  const years: [string, ArchiveRow[]][] = [];
  for (const row of shown) {
    const year = row.date.slice(0, 4);
    const last = years[years.length - 1];
    if (last?.[0] === year) last[1].push(row);
    else years.push([year, [row]]);
  }

  return (
    <div className="pb-16">
      <nav aria-label={t("archive.tags")} className="flex flex-wrap gap-2">
        <Link href="/archive" scroll={false} className={chip(selected === null)}>
          {t("archive.all")}
          <span className="opacity-60">{rows.length}</span>
        </Link>
        {tags.map(({ tag, count }) => (
          <Link
            key={tag}
            href={selected === tag ? "/archive" : { pathname: "/archive", query: { tag } }}
            scroll={false}
            aria-current={selected === tag ? "true" : undefined}
            className={chip(selected === tag)}
          >
            {tag}
            <span className="opacity-60">{count}</span>
          </Link>
        ))}
      </nav>

      {selected ? (
        <p className="mt-8 font-mono text-xs text-muted">
          {t("archive.filtered", { tag: selected, count: shown.length })}
          {" · "}
          <Link
            href="/archive"
            scroll={false}
            className="text-accent transition-colors duration-300 ease-premium hover:text-foreground"
          >
            {t("archive.clear")}
          </Link>
        </p>
      ) : null}

      {years.map(([year, list]) => (
        <section key={year} className="mt-10">
          <h2 className="flex items-baseline justify-between border-b border-hairline pb-3">
            <span className="text-xl font-semibold tracking-tight">{year}</span>
            <span className="font-mono text-xs text-muted">
              {t("archive.count", { count: list.length })}
            </span>
          </h2>
          <ul>
            {list.map((row) => (
              <li key={`${row.kind}/${row.slug}`} className="border-b border-hairline">
                <Link href={row.href} className="group flex items-baseline gap-3 py-3 sm:gap-4">
                  <time dateTime={row.date} className="w-11 shrink-0 font-mono text-xs text-muted">
                    {row.date.slice(5)}
                  </time>
                  <span className={`${kindCol} shrink-0 font-mono text-xs text-accent/80`}>
                    {t(KIND_LABEL_KEY[row.kind])}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium transition-colors duration-300 ease-premium group-hover:text-accent">
                    {row.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {shown.length === 0 ? (
        <p className="mt-10 text-muted">{t("archive.empty")}</p>
      ) : null}
    </div>
  );
}
