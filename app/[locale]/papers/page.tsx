import { ArrowUpRight, CaretRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import PaperSearch from "@/components/papers/PaperSearch";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getAllInsights } from "@/lib/insights";
import { getDigestDates, getDigest, isRelevant } from "@/lib/papers";
import { SITE_URL } from "@/lib/site";
import { pageMetadata } from "@/lib/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "papers" });
  // RSS 发现链接(文章 + 速递)由 pageMetadata 统一带上
  return pageMetadata({
    locale,
    path: "/papers/",
    title: t("title"),
    description: t("description"),
  });
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

  // 文档区块里的完整 URL(对外复制用)
  const SITE = SITE_URL;
  const t = await getTranslations({ locale, namespace: "papers" });
  const insights = getAllInsights();
  const digests = getDigestDates()
    .map((date) => getDigest(date))
    .filter((d) => d !== null)
    // 归档列表只统计相关论文(与详情页正文一致)
    .map((d) => ({
      ...d,
      hf: d.hf.filter(isRelevant),
      arxiv: d.arxiv.filter(isRelevant),
      embodied: (d.embodied ?? []).filter(isRelevant),
    }));
  // 按月折叠:最近一个月展开,更早的收起(速递每天一期,平铺列表会越来越长)
  const months: { month: string; digests: typeof digests }[] = [];
  for (const digest of digests) {
    const month = digest.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last?.month === month) last.digests.push(digest);
    else months.push({ month, digests: [digest] });
  }
  const monthLabel = (month: string) =>
    new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <Container>
      <PageHeader title={t("title")} description={t("description")}>
        <p className="mt-3 font-mono text-xs">
          <a
            href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/feed.xml`}
            className="text-muted transition-colors duration-300 ease-premium hover:text-foreground"
          >
            {t("rss")} ↗
          </a>
        </p>
      </PageHeader>
      <PaperSearch />
      {insights.length > 0 ? (
        <section className="pb-16">
          <h2 className="font-mono text-sm text-muted">{t("insightsTitle")}</h2>
          <ul className="mt-4">
            {insights.map((insight) => (
              <li
                key={insight.paperId}
                className="border-b border-hairline first:border-t"
              >
                <Link
                  href={`/papers/insights/${insight.paperId}`}
                  className="group block py-4"
                >
                  <span className="flex items-baseline gap-3">
                    <span className="font-medium tracking-tight transition-colors duration-300 ease-premium group-hover:text-accent">
                      {insight.title}
                    </span>
                    <time
                      dateTime={insight.date}
                      className="shrink-0 font-mono text-xs text-muted"
                    >
                      {insight.date}
                    </time>
                    <ArrowUpRight
                      size={14}
                      aria-hidden
                      className="ml-auto shrink-0 -translate-x-1 self-center text-accent opacity-0 transition-all duration-300 ease-premium group-hover:translate-x-0 group-hover:opacity-100"
                    />
                  </span>
                  {insight.paperTitle ? (
                    <span className="mt-1 block truncate text-sm text-muted">
                      {insight.paperTitle}
                    </span>
                  ) : null}
                  {insight.description ? (
                    <span className="mt-1 block text-sm leading-relaxed text-muted">
                      {insight.description}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {digests.length === 0 ? (
        <p className="pb-16 text-muted">{t("empty")}</p>
      ) : (
        <div className="pb-16">
          {months.map((group, index) => {
            const papers = group.digests.reduce(
              (sum, d) => sum + d.hf.length + d.arxiv.length + d.embodied.length,
              0,
            );
            return (
              <details key={group.month} open={index === 0} className="group/month">
                <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 border-b border-hairline py-3 select-none [&::-webkit-details-marker]:hidden">
                  <span className="flex items-baseline gap-2 font-medium tracking-tight">
                    <CaretRight
                      size={12}
                      aria-hidden
                      className="self-center text-muted transition-transform duration-300 ease-premium group-open/month:rotate-90"
                    />
                    {monthLabel(group.month)}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {t("monthSummary", { issues: group.digests.length, papers })}
                  </span>
                </summary>
                <ul className="mb-6">
                  {group.digests.map((digest) => {
                    const top3 = [...digest.hf, ...digest.arxiv].slice(0, 3);
                    return (
                      <li key={digest.date} className="border-b border-hairline">
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
                              {digest.arxiv.length === 0 && digest.arxivStatus === "pending"
                                ? t("arxivPendingShort")
                                : digest.arxiv.length === 0 && digest.arxivStatus === "error"
                                  ? t("arxivErrorShort")
                                  : t("arxivCount", { count: digest.arxiv.length })}
                              {digest.embodied.length > 0
                                ? ` · ${t("embodiedCount", { count: digest.embodied.length })}`
                                : ""}
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
              </details>
            );
          })}
        </div>
      )}

      {/* Agent 与开发者接入:静态 JSON API + RSS + skill 安装提示 */}
      <section className="border-t border-hairline pb-16 pt-10">
        <h2 className="font-mono text-sm text-muted">{t("apiTitle")}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          {t("apiDesc")}
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl bg-surface p-4 font-mono text-xs ring-1 ring-hairline">
          <p className="text-muted"># {t("apiIndex")}</p>
          <p>
            curl {SITE}
            /api/papers/index.json
          </p>
          <p className="mt-3 text-muted"># {t("apiDaily")}</p>
          <p>
            curl {SITE}
            /api/papers/2026-07-20.json
          </p>
          <p className="mt-3 text-muted"># RSS</p>
          <p>
            curl {SITE}
            /feed.xml
          </p>
        </div>
        <div className="mt-4 rounded-2xl bg-foreground/[0.03] p-4 ring-1 ring-hairline">
          <p className="font-mono text-xs text-muted">
            {t("apiPromptLabel")}
          </p>
          <p className="mt-2 text-sm leading-relaxed">{t("apiPrompt")}</p>
        </div>
      </section>
    </Container>
  );
}
