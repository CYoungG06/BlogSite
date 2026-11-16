import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import TagLink from "@/components/TagLink";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/metadata";
import { getSeries, getSeriesSlugs } from "@/lib/series";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => getSeriesSlugs().map((series) => ({ locale, series })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; series: string }>;
}): Promise<Metadata> {
  const { locale, series: slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const series = getSeries(slug, locale);
  if (!series) return {};
  return pageMetadata({ locale, path: `/series/${slug}/`, title: series.title, description: series.description });
}

/** 专题目录:简介 + 各课(编号、标题、导语) */
export default async function SeriesPage({
  params,
}: {
  params: Promise<{ locale: string; series: string }>;
}) {
  const { locale, series: slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const series = getSeries(slug, locale);
  if (!series) notFound();
  const t = await getTranslations({ locale, namespace: "series" });
  const first = series.lessons[0];

  return (
    <Container>
      <PageHeader title={series.title} description={series.description}>
        {series.note ? <p className="mt-3 max-w-2xl text-sm text-muted">{series.note}</p> : null}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {series.tags.map((tag) => (
            <TagLink key={tag} tag={tag} />
          ))}
        </div>
        {first ? (
          <Link
            href={`/series/${slug}/${first.slug}`}
            className="group mt-8 inline-flex h-12 items-center gap-3 rounded-full bg-foreground pr-2 pl-6 text-sm font-medium text-background transition-transform duration-300 ease-premium active:scale-[0.98]"
          >
            {t("start")}
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/15 transition-transform duration-300 ease-premium group-hover:translate-x-0.5">
              <ArrowRight size={15} />
            </span>
          </Link>
        ) : null}
      </PageHeader>

      <h2 className="font-mono text-xs text-muted">{t("contents")}</h2>
      <ol className="mt-3 pb-16">
        {series.lessons.map((lesson) => (
          <li key={lesson.slug} className="border-b border-hairline first:border-t">
            <Link href={`/series/${slug}/${lesson.slug}`} className="group flex gap-4 py-5 sm:gap-6">
              <span className="w-8 shrink-0 pt-0.5 font-mono text-sm text-accent">
                {String(lesson.number).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium tracking-tight transition-colors duration-300 ease-premium group-hover:text-accent">
                    {lesson.title}
                  </span>
                  <span className="font-mono text-xs text-muted">{lesson.shortTitle}</span>
                </span>
                <span className="mt-1.5 line-clamp-2 block text-sm leading-relaxed text-muted">{lesson.lede}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Container>
  );
}
