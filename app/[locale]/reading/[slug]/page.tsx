import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import ArticleDetail from "@/components/ArticleDetail";
import { routing } from "@/i18n/routing";
import { getReading, getReadingSlugs } from "@/lib/reading";
import { pageMetadata } from "@/lib/metadata";

export function generateStaticParams() {
  return getReadingSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const item = getReading(locale, slug);
  if (!item) return {};
  return pageMetadata({
    locale,
    path: `/reading/${slug}/`,
    title: item.title,
    description: item.description,
    // 英文站回退显示中文原文时,canonical 指向中文页;hreflang 只列真有该语言版本的
    contentLocale: item.locale,
    locales: item.locales,
    type: "article",
    publishedTime: item.date,
    tags: item.tags,
  });
}

export default async function ReadingItemPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const item = getReading(locale, slug);
  if (!item) notFound();

  return <ArticleDetail item={item} kind="reading" locale={locale} />;
}
