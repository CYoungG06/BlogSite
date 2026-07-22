import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import ArticleDetail from "@/components/ArticleDetail";
import { routing } from "@/i18n/routing";
import { getDistilledItem, getDistilledSlugs } from "@/lib/distilled";

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
  return { title: item.title, description: item.description };
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
