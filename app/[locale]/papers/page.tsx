import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getDigestDates, getDigest, isRelevant } from "@/lib/papers";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "papers" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      types: {
        "application/rss+xml": `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/feed.xml`,
      },
    },
  };
}

/** 速递归档:按日期倒序列出每期,附篇数与当日 Top3 标题 */
export default async function PapersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "papers" });
  const digests = getDigestDates()
    .map((date) => getDigest(date))
    .filter((d) => d !== null)
    // 归档列表只统计相关论文(与详情页正文一致)
    .map((d) => ({
      ...d,
      hf: d.hf.filter(isRelevant),
      arxiv: d.arxiv.filter(isRelevant),
    }));

  return (
    <Container>
      <PageHeader title={t("title")} description={t("description")} />
      <p className="-mt-6 pb-8 font-mono text-xs">
        <a
          href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/feed.xml`}
          className="text-muted transition-colors duration-300 ease-premium hover:text-foreground"
        >
          {t("rss")} ↗
        </a>
      </p>
      {digests.length === 0 ? (
        <p className="pb-16 text-muted">{t("empty")}</p>
      ) : (
        <ul className="pb-16">
          {digests.map((digest) => {
            const top3 = [...digest.hf, ...digest.arxiv].slice(0, 3);
            return (
              <li
                key={digest.date}
                className="border-b border-hairline first:border-t"
              >
                <Link
                  href={`/papers/${digest.date}`}
                  className="group block py-4"
                >
                  <span className="flex items-baseline gap-3">
                    <time
                      dateTime={digest.date}
                      className="shrink-0 font-mono text-xs text-muted"
                    >
                      {digest.date}
                    </time>
                    <span className="shrink-0 font-mono text-xs text-muted">
                      {t("hfCount", { count: digest.hf.length })}
                      {" · "}
                      {t("arxivCount", { count: digest.arxiv.length })}
                    </span>
                    <ArrowUpRight
                      size={14}
                      aria-hidden
                      className="ml-auto shrink-0 -translate-x-1 self-center text-accent opacity-0 transition-all duration-300 ease-premium group-hover:translate-x-0 group-hover:opacity-100"
                    />
                  </span>
                  <span className="mt-1.5 block truncate text-sm text-muted transition-colors duration-300 ease-premium group-hover:text-foreground">
                    {top3
                      .map((p) =>
                        locale === "zh" && p.titleZh ? p.titleZh : p.title,
                      )
                      .join(" · ")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
