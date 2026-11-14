import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import { KIND_COL, KIND_LABEL_KEY } from "@/components/archive/ArchiveList";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getAdjacent, getRelated, type ArchiveKind } from "@/lib/archive";

/** 文章底部:相关内容(按共同标签)+ 同栏目的上一篇 / 下一篇 */
export default function ArticleNeighbors({
  locale,
  kind,
  slug,
  tags,
}: {
  locale: Locale;
  kind: ArchiveKind;
  slug: string;
  tags: string[];
}) {
  const t = useTranslations();
  const related = getRelated(locale, kind, slug, tags);
  const { older, newer } = getAdjacent(locale, kind, slug);
  if (related.length === 0 && !older && !newer) return null;

  return (
    <div className="mt-12 space-y-10 print:hidden">
      {related.length > 0 ? (
        <section>
          <h2 className="font-mono text-xs text-muted">{t("article.related")}</h2>
          <ul className="mt-3">
            {related.map((entry) => (
              <li key={`${entry.kind}/${entry.slug}`} className="border-b border-hairline first:border-t">
                <Link href={entry.href} className="group flex items-baseline gap-3 py-3">
                  <span className={`${KIND_COL[locale]} shrink-0 font-mono text-xs text-accent/80`}>
                    {t(KIND_LABEL_KEY[entry.kind])}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium transition-colors duration-300 ease-premium group-hover:text-accent">
                    {entry.title}
                  </span>
                  <time dateTime={entry.date} className="hidden shrink-0 font-mono text-xs text-muted sm:block">
                    {entry.date}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {older || newer ? (
        <nav aria-label={t("article.siblings")} className="grid gap-3 sm:grid-cols-2">
          {older ? (
            <Link
              href={older.href}
              className="group rounded-2xl p-4 ring-1 ring-hairline transition-colors duration-300 ease-premium hover:bg-foreground/[0.03]"
            >
              <span className="inline-flex items-center gap-1 font-mono text-xs text-muted">
                <ArrowLeft size={12} aria-hidden />
                {t("article.previous")}
              </span>
              <span className="mt-1.5 line-clamp-2 block font-medium text-balance transition-colors duration-300 ease-premium group-hover:text-accent">
                {older.title}
              </span>
            </Link>
          ) : (
            <span className="hidden sm:block" />
          )}
          {newer ? (
            <Link
              href={newer.href}
              className="group rounded-2xl p-4 text-right ring-1 ring-hairline transition-colors duration-300 ease-premium hover:bg-foreground/[0.03]"
            >
              <span className="inline-flex items-center gap-1 font-mono text-xs text-muted">
                {t("article.next")}
                <ArrowRight size={12} aria-hidden />
              </span>
              <span className="mt-1.5 line-clamp-2 block font-medium text-balance transition-colors duration-300 ease-premium group-hover:text-accent">
                {newer.title}
              </span>
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
