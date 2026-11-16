import { ArrowLeft, ArrowRight, ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import BackToTop from "@/components/BackToTop";
import LessonFrame from "@/components/series/LessonFrame";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { basePath } from "@/lib/images";
import { pageMetadata } from "@/lib/metadata";
import { getSeries, getSeriesSlugs } from "@/lib/series";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getSeriesSlugs().flatMap((series) =>
      (getSeries(series, locale)?.lessons ?? []).map((lesson) => ({ locale, series, lesson: lesson.slug })),
    ),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; series: string; lesson: string }>;
}): Promise<Metadata> {
  const { locale, series: seriesSlug, lesson: lessonSlug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const series = getSeries(seriesSlug, locale);
  const lesson = series?.lessons.find((l) => l.slug === lessonSlug);
  if (!series || !lesson) return {};
  // 课件只有中文:英文站同路径显示的也是中文,canonical 指向中文页
  return pageMetadata({
    locale,
    path: `/series/${seriesSlug}/${lessonSlug}/`,
    title: `${lesson.title} · ${series.title}`,
    description: lesson.lede,
    contentLocale: "zh",
    locales: ["zh"],
    type: "article",
    publishedTime: lesson.date,
    tags: series.tags,
  });
}

/** 与课件自己的版心(.wrap:max-width 1080px,两侧 16px)对齐,上下两条导航和课件左边缘齐平 */
function LessonBar({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1080px] px-[16px]">{children}</div>;
}

/**
 * 专题的一课:顶部一条导航(专题名、第几课、上一课/下一课),中间是通栏的交互课件,
 * 底部再放一次上一课/下一课。课件自带标题和导语,这里不重复显示(h1 只给读屏器)。
 */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ locale: string; series: string; lesson: string }>;
}) {
  const { locale, series: seriesSlug, lesson: lessonSlug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const series = getSeries(seriesSlug, locale);
  const index = series?.lessons.findIndex((l) => l.slug === lessonSlug) ?? -1;
  if (!series || index < 0) notFound();
  const lesson = series.lessons[index];
  const prev = series.lessons[index - 1];
  const next = series.lessons[index + 1];
  const t = await getTranslations({ locale, namespace: "series" });
  const src = `${basePath}/series/${seriesSlug}/${lesson.slug}.html`;
  const total = series.lessons.length;

  const pager = (where: "top" | "bottom") =>
    where === "top" ? (
      <div className="flex shrink-0 items-center gap-1 font-mono text-xs">
        {prev ? (
          <Link
            href={`/series/${seriesSlug}/${prev.slug}`}
            aria-label={`${t("previous")}:${prev.title}`}
            className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-muted ring-1 ring-hairline transition-colors duration-300 ease-premium hover:text-foreground"
          >
            <ArrowLeft size={12} aria-hidden />
            <span className="hidden sm:inline">{t("previous")}</span>
          </Link>
        ) : null}
        {next ? (
          <Link
            href={`/series/${seriesSlug}/${next.slug}`}
            aria-label={`${t("next")}:${next.title}`}
            className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-muted ring-1 ring-hairline transition-colors duration-300 ease-premium hover:text-foreground"
          >
            <span className="hidden sm:inline">{t("next")}</span>
            <ArrowRight size={12} aria-hidden />
          </Link>
        ) : null}
      </div>
    ) : (
      <nav aria-label={t("pager")} className="grid gap-3 sm:grid-cols-2">
        {prev ? (
          <Link
            href={`/series/${seriesSlug}/${prev.slug}`}
            className="group rounded-2xl p-4 ring-1 ring-hairline transition-colors duration-300 ease-premium hover:bg-foreground/[0.03]"
          >
            <span className="inline-flex items-center gap-1 font-mono text-xs text-muted">
              <ArrowLeft size={12} aria-hidden />
              {t("lessonOf", { n: prev.number, total })}
            </span>
            <span className="mt-1.5 block font-medium text-balance transition-colors duration-300 ease-premium group-hover:text-accent">
              {prev.title}
            </span>
          </Link>
        ) : (
          <span className="hidden sm:block" />
        )}
        {next ? (
          <Link
            href={`/series/${seriesSlug}/${next.slug}`}
            className="group rounded-2xl p-4 text-right ring-1 ring-hairline transition-colors duration-300 ease-premium hover:bg-foreground/[0.03]"
          >
            <span className="inline-flex items-center gap-1 font-mono text-xs text-muted">
              {t("lessonOf", { n: next.number, total })}
              <ArrowRight size={12} aria-hidden />
            </span>
            <span className="mt-1.5 block font-medium text-balance transition-colors duration-300 ease-premium group-hover:text-accent">
              {next.title}
            </span>
          </Link>
        ) : null}
      </nav>
    );

  return (
    <>
      <h1 className="sr-only">
        {lesson.title} · {series.title}
      </h1>
      <LessonBar>
        <div className="flex items-center justify-between gap-4 pt-8 pb-2">
          <p className="min-w-0 truncate font-mono text-xs text-muted">
            <Link href="/series" className="transition-colors duration-300 ease-premium hover:text-foreground">
              {t("title")}
            </Link>
            {" / "}
            <Link
              href={`/series/${seriesSlug}`}
              className="transition-colors duration-300 ease-premium hover:text-foreground"
            >
              {series.title}
            </Link>
            {" · "}
            {t("lessonOf", { n: lesson.number, total })}
          </p>
          {pager("top")}
        </div>
      </LessonBar>

      <LessonFrame src={src} title={t("frameTitle", { title: lesson.title })} />

      <LessonBar>
        <div className="space-y-6 border-t border-hairline pt-8 pb-4">
          {pager("bottom")}
          <p className="flex flex-wrap justify-between gap-3 font-mono text-xs text-muted">
            <Link
              href={`/series/${seriesSlug}`}
              className="transition-colors duration-300 ease-premium hover:text-foreground"
            >
              ← {t("backToSeries")}
            </Link>
            <a
              href={src}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 transition-colors duration-300 ease-premium hover:text-foreground"
            >
              {t("openStandalone")}
              <ArrowSquareOut size={12} aria-hidden />
            </a>
          </p>
        </div>
      </LessonBar>
      <BackToTop />
    </>
  );
}
