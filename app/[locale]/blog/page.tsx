import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import PostCard from "@/components/blog/PostCard";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getPosts } from "@/lib/posts";
import { pageMetadata } from "@/lib/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "blog" });
  return pageMetadata({
    locale,
    path: "/blog/",
    title: t("title"),
    description: t("description"),
  });
}

export default async function BlogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "blog" });
  const posts = getPosts(locale);

  return (
    <Container>
      <PageHeader title={t("title")} description={t("description")}>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
          <Link
            href="/archive"
            className="text-muted transition-colors duration-300 ease-premium hover:text-foreground"
          >
            {t("archiveLink")} →
          </Link>
          <a
            href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/rss.xml`}
            className="text-muted transition-colors duration-300 ease-premium hover:text-foreground"
          >
            {t("rss")} ↗
          </a>
        </p>
      </PageHeader>
      <div>
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} locale={locale} />
        ))}
      </div>
    </Container>
  );
}
