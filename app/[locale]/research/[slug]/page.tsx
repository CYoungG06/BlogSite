import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import Lightbox from "@/components/mdx/Lightbox";
import MDXContent from "@/components/mdx/MDXContent";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { imageUrl } from "@/lib/images";
import { getResearchWork, getResearchWorkSlugs } from "@/lib/research";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getResearchWorkSlugs().map((slug) => ({ locale, slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const work = getResearchWork(slug);
  if (!work) return {};
  return { title: work.meta.title, description: work.meta.tldr };
}

/** 链接列按钮:外部链接样式(主=实心 accent,次=描边) */
function HeroLink({
  href,
  label,
  primary = false,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  const cls = primary
    ? "rounded-full bg-accent px-4 py-1.5 text-sm text-white transition-opacity duration-300 ease-premium hover:opacity-85"
    : "rounded-full px-4 py-1.5 text-sm text-foreground ring-1 ring-hairline transition-colors duration-300 ease-premium hover:text-accent hover:ring-accent/40";
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {label} ↗
    </a>
  );
}

/** 工作详情页:学术 project page 风格——hero(徽章+大标题+按钮+TLDR)+ 海报 + MDX 长文 */
export default async function ResearchWorkPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const work = getResearchWork(slug);
  if (!work) notFound();
  const { meta, content } = work;

  const t = await getTranslations({ locale, namespace: "research" });

  return (
    <Container>
      {/* 返回 */}
      <p className="pb-6">
        <Link
          href="/research"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:text-foreground"
        >
          <ArrowLeft size={12} aria-hidden /> {t("backToResearch")}
        </Link>
      </p>

      {/* Hero:徽章 + 大标题 + 副题 + 按钮 + TL;DR */}
      <section className="rounded-[2rem] bg-surface p-7 ring-1 ring-hairline sm:p-10">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-xs">
          <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-accent">
            {meta.venue}
          </span>
          <span className="text-muted">{meta.date}</span>
        </p>

        <h1 className="mt-5 max-w-4xl text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {meta.title}
        </h1>
        {meta.subtitle ? (
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted sm:text-lg">
            {meta.subtitle}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {meta.links?.arxiv ? (
            <HeroLink href={meta.links.arxiv} label={t("paper")} primary />
          ) : null}
          {meta.links?.code ? (
            <HeroLink href={meta.links.code} label={t("code")} />
          ) : null}
          {meta.links?.project ? (
            <HeroLink href={meta.links.project} label={t("project")} />
          ) : null}
          {meta.links?.poster ? (
            <HeroLink href={imageUrl(meta.links.poster)} label={t("poster")} />
          ) : null}
        </div>

        {meta.tldr ? (
          <p className="mt-7 border-l-2 border-accent pl-4 text-sm leading-relaxed text-foreground/80 sm:text-base">
            {meta.tldr}
          </p>
        ) : null}
      </section>

      {/* 海报(点击看 PDF) */}
      {meta.posterImage ? (
        <a
          href={imageUrl(meta.links?.poster ?? meta.posterImage)}
          target="_blank"
          rel="noreferrer"
          className="mt-8 block"
          title={t("poster")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl(meta.posterImage)}
            alt={`${meta.title} poster`}
            className="w-full rounded-2xl ring-1 ring-hairline transition-opacity duration-300 ease-premium hover:opacity-90"
          />
        </a>
      ) : null}

      {/* 详细介绍(MDX 长文) */}
      <div className="prose mt-10 max-w-none">
        <Lightbox>
          <MDXContent source={content} />
        </Lightbox>
      </div>

      {/* 底部返回 */}
      <p className="mt-12 border-t border-hairline pt-6">
        <Link
          href="/research"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:text-foreground"
        >
          <ArrowLeft size={12} aria-hidden /> {t("backToResearch")}
        </Link>
      </p>
    </Container>
  );
}
