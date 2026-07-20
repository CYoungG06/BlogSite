import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import PaperCard from "@/components/papers/PaperCard";
import { Link } from "@/i18n/navigation";
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

/** 单日速递:今日焦点(Top3 HF 面板)→ HF 热门 → arXiv 新论文(分组),底部期号导航 */
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

  // 今日焦点:HF 榜前 3,面板突出;其余 HF 进入常规列表
  const focus = digest.hf.slice(0, 3);
  const hfRest = digest.hf.slice(3);

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

  // 期号导航(dates 倒序:index-1 是更新的一期,index+1 是更旧的一期)
  const dates = getDigestDates();
  const idx = dates.indexOf(date);
  const newer = idx > 0 ? dates[idx - 1] : null;
  const older = idx >= 0 && idx < dates.length - 1 ? dates[idx + 1] : null;

  return (
    <Container>
      <PageHeader
        title={t("digestTitle", { date: digest.date })}
        description={`${t("hfCount", { count: digest.hf.length })} · ${t("arxivCount", { count: digest.arxiv.length })}`}
      />

      {focus.length > 0 ? (
        <section className="pb-12">
          <h2 className="font-mono text-sm text-muted">{t("focus")}</h2>
          <div className="mt-4 rounded-[1.75rem] bg-surface p-1.5 ring-1 ring-hairline">
            <div className="rounded-[calc(1.75rem-0.375rem)] bg-background px-6 ring-1 ring-hairline [&>article:first-child]:border-t-0">
              {focus.map((paper) => (
                <PaperCard
                  key={paper.id}
                  paper={paper}
                  locale={locale}
                  t={cardT}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {hfRest.length > 0 ? (
        <section className="pb-12">
          <h2 className="font-mono text-sm text-muted">{t("hfSection")}</h2>
          <div className="mt-4">
            {hfRest.map((paper) => (
              <PaperCard key={paper.id} paper={paper} locale={locale} t={cardT} />
            ))}
          </div>
        </section>
      ) : null}

      {digest.arxiv.length > 0 ? (
        <section className="pb-12">
          <h2 className="font-mono text-sm text-muted">{t("arxivSection")}</h2>
          {groups.map((cat) => (
            <div key={cat} className="mt-6">
              <h3 className="font-mono text-xs text-accent">{cat}</h3>
              <div className="mt-2">
                {byCategory.get(cat)!.map((paper) => (
                  <PaperCard
                    key={paper.id}
                    paper={paper}
                    locale={locale}
                    t={cardT}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {/* 期号导航 */}
      <nav className="flex items-center justify-between border-t border-hairline py-6 font-mono text-xs">
        {older ? (
          <Link
            href={`/papers/${older}`}
            className="text-muted transition-colors duration-300 ease-premium hover:text-foreground"
          >
            ← {older}
          </Link>
        ) : (
          <span />
        )}
        {newer ? (
          <Link
            href={`/papers/${newer}`}
            className="text-muted transition-colors duration-300 ease-premium hover:text-foreground"
          >
            {newer} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </Container>
  );
}
