import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import PaperCard from "@/components/papers/PaperCard";
import { routing } from "@/i18n/routing";
import { getDigest, getDigestDates, type PaperItem } from "@/lib/papers";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getDigestDates().map((date) => ({ locale, date })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; date: string }>;
}): Promise<Metadata> {
  const { locale, date } = await params;
  const t = await getTranslations({ locale, namespace: "papers" });
  return { title: t("digestTitle", { date }) };
}

/** 单日速递:HF 热门(按 upvotes)+ arXiv 新论文(按主分类分组) */
export default async function PaperDigestPage({
  params,
}: {
  params: Promise<{ locale: string; date: string }>;
}) {
  const { locale, date } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const digest = getDigest(date);
  if (!digest) notFound();

  const t = await getTranslations({ locale, namespace: "papers" });
  const cardT = {
    code: t("code"),
    project: t("project"),
    etAl: t("etAl"),
  };

  // 保持 JSON 中分类声明的顺序,只展示实际有论文的分类
  const byCategory = new Map<string, PaperItem[]>();
  for (const paper of digest.arxiv) {
    const cat = paper.primaryCategory ?? "other";
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), paper]);
  }
  const groups = [
    ...digest.categories.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !digest.categories.includes(c)),
  ];

  return (
    <Container>
      <PageHeader
        title={t("digestTitle", { date: digest.date })}
        description={`${t("hfCount", { count: digest.hf.length })} · ${t("arxivCount", { count: digest.arxiv.length })}`}
      />

      {digest.hf.length > 0 ? (
        <section className="pb-12">
          <h2 className="font-mono text-xs text-muted">{t("hfSection")}</h2>
          <div className="mt-4">
            {digest.hf.map((paper) => (
              <PaperCard key={paper.id} paper={paper} t={cardT} />
            ))}
          </div>
        </section>
      ) : null}

      {digest.arxiv.length > 0 ? (
        <section className="pb-16">
          <h2 className="font-mono text-xs text-muted">{t("arxivSection")}</h2>
          {groups.map((cat) => (
            <div key={cat} className="mt-6">
              <h3 className="font-mono text-xs text-accent">{cat}</h3>
              <div className="mt-2">
                {byCategory.get(cat)!.map((paper) => (
                  <PaperCard key={paper.id} paper={paper} t={cardT} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </Container>
  );
}
