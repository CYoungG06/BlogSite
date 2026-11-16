import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/metadata";
import { getAllSeries } from "@/lib/series";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "series" });
  return pageMetadata({ locale, path: "/series/", title: t("title"), description: t("description") });
}

/** 专题列表:每个专题一张卡片 */
export default async function SeriesListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "series" });
  const all = getAllSeries(locale);

  return (
    <Container>
      <PageHeader title={t("title")} description={t("description")} />
      <ul className="grid gap-6 pb-16">
        {all.map((series) => (
          <li key={series.slug}>
            <Link
              href={`/series/${series.slug}`}
              className="group block rounded-[1.75rem] bg-surface p-1.5 ring-1 ring-hairline"
            >
              <div className="rounded-[calc(1.75rem-0.375rem)] bg-background px-6 py-5 ring-1 ring-hairline transition-colors duration-300 ease-premium group-hover:bg-foreground/[0.02]">
                <p className="font-mono text-xs text-muted">
                  {t("lessonCount", { count: series.lessons.length })} · {series.date}
                </p>
                <h2 className="mt-2 flex items-center gap-2 text-xl font-semibold tracking-tight transition-colors duration-300 ease-premium group-hover:text-accent">
                  {series.title}
                  <ArrowUpRight size={16} aria-hidden className="text-accent opacity-0 transition-opacity duration-300 ease-premium group-hover:opacity-100" />
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{series.description}</p>
                <p className="mt-4 font-mono text-xs text-muted">
                  {series.lessons.map((l) => l.shortTitle).join(" · ")}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
