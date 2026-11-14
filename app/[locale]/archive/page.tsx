import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import ArchiveFilter from "@/components/archive/ArchiveFilter";
import ArchiveList, { type ArchiveRow } from "@/components/archive/ArchiveList";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { routing } from "@/i18n/routing";
import { getArchiveEntries, getTagCounts } from "@/lib/archive";
import { pageMetadata } from "@/lib/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "archive" });
  return pageMetadata({
    locale,
    path: "/archive/",
    title: t("title"),
    description: t("description"),
  });
}

/** 归档:全站文章 / 蒸馏 / 精读 / 笔记 / 深度解读,按年分组,可按标签筛选 */
export default async function ArchivePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "archive" });
  const entries = getArchiveEntries(locale);
  const rows: ArchiveRow[] = entries.map(({ kind, slug, title, date, tags, href }) => ({
    kind,
    slug,
    title,
    date,
    tags,
    href,
  }));
  const tags = getTagCounts(entries);

  return (
    <Container>
      <PageHeader title={t("title")} description={t("description")} />
      <Suspense fallback={<ArchiveList rows={rows} tags={tags} selected={null} />}>
        <ArchiveFilter rows={rows} tags={tags} />
      </Suspense>
    </Container>
  );
}
