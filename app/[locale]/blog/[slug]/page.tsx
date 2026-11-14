import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import ArticleDetail from "@/components/ArticleDetail";
import { routing } from "@/i18n/routing";
import { getPost, getPostSlugs } from "@/lib/posts";
import { pageMetadata } from "@/lib/metadata";

/** locale × slug 并集:英文站也能 SSG 出中文原文页(带 fallback notice) */
export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const post = getPost(locale, slug);
  if (!post) return {};
  return pageMetadata({
    locale,
    path: `/blog/${slug}/`,
    title: post.title,
    description: post.description,
    // 英文站回退显示中文原文时,canonical 指向中文页;hreflang 只列真有该语言版本的
    contentLocale: post.locale,
    locales: post.locales,
    type: "article",
    publishedTime: post.date,
    tags: post.tags,
  });
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const post = getPost(locale, slug);
  if (!post) notFound();

  return <ArticleDetail item={post} kind="blog" locale={locale} />;
}
