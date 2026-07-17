import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import ArticleDetail from "@/components/ArticleDetail";
import { routing } from "@/i18n/routing";
import { getNote, getNoteSlugs } from "@/lib/notes";

/** locale × slug 并集,与文章详情同一套回退逻辑 */
export function generateStaticParams() {
  return getNoteSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const note = getNote(locale, slug);
  if (!note) return {};
  return { title: note.title, description: note.preview };
}

export default async function NotePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const note = getNote(locale, slug);
  if (!note) notFound();

  return <ArticleDetail item={note} kind="notes" locale={locale} />;
}
