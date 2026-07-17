import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import MDXContent from "@/components/mdx/MDXContent";
import { routing } from "@/i18n/routing";
import { getAbout } from "@/lib/about";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return { title: t("title"), description: t("description") };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "about" });
  const about = getAbout(locale);

  return (
    <Container>
      <PageHeader
        title={about?.title || t("title")}
        description={about?.description || t("description")}
      />
      {about ? (
        <div className="prose max-w-3xl pb-12">
          <MDXContent source={about.content} />
        </div>
      ) : null}
    </Container>
  );
}
