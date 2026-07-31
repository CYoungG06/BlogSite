import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { imageUrl } from "@/lib/images";
import { getResearch, sortPublications } from "@/lib/research";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "research" });
  return { title: t("title"), description: t("description") };
}

/** 研究专栏:组介绍 + 方向简介 + 论文列表(匿名,不印作者名单)+ News */
export default async function ResearchPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "research" });
  const research = getResearch();
  const pubs = sortPublications(research.publications);

  return (
    <Container>
      <PageHeader title={t("title")} description={t("description")} />

      {/* 组介绍(匿名版,置顶) */}
      {research.group ? (
        <section className="pb-12">
          <h2 className="font-mono text-xs text-muted">{t("groupTitle")}</h2>
          <p className="mt-4 max-w-3xl leading-relaxed text-muted">
            {research.group}
          </p>
        </section>
      ) : null}

      {/* 研究方向 */}
      {research.intro ? (
        <section className="pb-12">
          <h2 className="font-mono text-xs text-muted">{t("introTitle")}</h2>
          <p className="mt-4 max-w-3xl leading-relaxed text-muted">
            {research.intro}
          </p>
        </section>
      ) : null}

      {/* 发表论文 */}
      <section className="pb-12">
        <h2 className="font-mono text-xs text-muted">{t("pubsTitle")}</h2>
        {pubs.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="mt-4">
            {pubs.map((pub) => (
              <li
                key={pub.title}
                className="border-b border-hairline py-4 first:border-t sm:flex sm:items-start sm:gap-6"
              >
                <span className="hidden w-14 shrink-0 pt-1 font-mono text-xs text-muted sm:block">
                  {pub.date}
                </span>
                <div className="min-w-0 flex-1">
                  {pub.slug ? (
                    <Link
                      href={`/research/${pub.slug}`}
                      className="group inline-flex items-baseline gap-1.5"
                    >
                      <h3 className="font-medium leading-snug tracking-tight transition-colors duration-300 ease-premium group-hover:text-accent">
                        {pub.title}
                      </h3>
                      <ArrowUpRight
                        size={13}
                        aria-hidden
                        className="shrink-0 self-center text-accent opacity-0 transition-opacity duration-300 ease-premium group-hover:opacity-100"
                      />
                    </Link>
                  ) : (
                    <a
                      href={pub.links?.arxiv}
                      target="_blank"
                      rel="noreferrer"
                      className="group inline-flex items-baseline gap-1.5"
                    >
                      <h3 className="font-medium leading-snug tracking-tight transition-colors duration-300 ease-premium group-hover:text-accent">
                        {pub.title}
                      </h3>
                      <ArrowUpRight
                        size={13}
                        aria-hidden
                        className="shrink-0 self-center text-accent opacity-0 transition-opacity duration-300 ease-premium group-hover:opacity-100"
                      />
                    </a>
                  )}
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">
                      {pub.venue}
                    </span>
                    <span className="sm:hidden">{pub.date}</span>
                  </p>
                  {pub.tldr ? (
                    <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">
                      {pub.tldr}
                    </p>
                  ) : null}
                </div>
                {pub.links?.code || pub.links?.project || pub.links?.poster ? (
                  <p className="mt-2 flex shrink-0 gap-4 font-mono text-xs sm:mt-0 sm:flex-col sm:items-end sm:gap-1.5 sm:pt-0.5">
                    {pub.links?.code ? (
                      <a
                        href={pub.links.code}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted transition-colors duration-300 ease-premium hover:text-accent"
                      >
                        {t("code")} ↗
                      </a>
                    ) : null}
                    {pub.links?.project ? (
                      <a
                        href={pub.links.project}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted transition-colors duration-300 ease-premium hover:text-accent"
                      >
                        {t("project")} ↗
                      </a>
                    ) : null}
                    {pub.links?.poster ? (
                      <a
                        href={imageUrl(pub.links.poster)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted transition-colors duration-300 ease-premium hover:text-accent"
                      >
                        {t("poster")} ↗
                      </a>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* News 时间线 */}
      {research.news.length > 0 ? (
        <section className="pb-12">
          <h2 className="font-mono text-xs text-muted">{t("newsTitle")}</h2>
          <ul className="mt-4">
            {research.news.map((item) => (
              <li
                key={`${item.date}-${item.text}`}
                className="flex items-baseline gap-3 border-b border-hairline py-3 first:border-t"
              >
                <span className="w-14 shrink-0 font-mono text-xs text-muted">
                  {item.date}
                </span>
                <span className="min-w-0 flex-1 text-sm leading-relaxed">
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Container>
  );
}
