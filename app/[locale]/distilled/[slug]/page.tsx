import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import ArticleDetail from "@/components/ArticleDetail";
import { routing } from "@/i18n/routing";
import { getDistilledItem, getDistilledSlugs } from "@/lib/distilled";
import { pageMetadata } from "@/lib/metadata";

export function generateStaticParams() {
  return getDistilledSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const item = getDistilledItem(locale, slug);
  if (!item) return {};
  return pageMetadata({
    locale,
    path: `/distilled/${slug}/`,
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

export default async function DistilledItemPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const item = getDistilledItem(locale, slug);
  if (!item) notFound();

  return <ArticleDetail item={item} kind="distilled" locale={locale} />;
}
