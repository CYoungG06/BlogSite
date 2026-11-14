import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import SearchClient from "@/components/search/SearchClient";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/metadata";

export function generateStaticParams() {
  return [{ locale: "zh" }, { locale: "en" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "search" });
  return pageMetadata({
    locale,
    path: "/search/",
    title: t("title"),
    description: t("description"),
  });
}

export default async function SearchPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "search" });

  return (
    <Container>
      <PageHeader title={t("title")} description={t("description")} />
      <SearchClient />
    </Container>
  );
}
