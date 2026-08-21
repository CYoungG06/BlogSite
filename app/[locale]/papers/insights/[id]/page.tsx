import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import CiteBlock from "@/components/CiteBlock";
import ExportButtons from "@/components/ExportButtons";
import Lightbox from "@/components/mdx/Lightbox";
import MDXContent from "@/components/mdx/MDXContent";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getInsight, getInsightIds } from "@/lib/insights";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    [...getInsightIds()].map((id) => ({ locale, id })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const insight = getInsight(id);
  if (!insight) return {};
  return { title: insight.meta.title, description: insight.meta.description };
}

/** 论文深度解读:标题 + 论文 meta 行(外链 arXiv/alphaXiv、回链当日速递)+ MDX 正文 */
export default async function InsightPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const insight = getInsight(id);
  if (!insight) notFound();
  const { meta, content } = insight;

  const t = await getTranslations({ locale, namespace: "papers" });

  const extLink =
    "text-muted transition-colors duration-300 ease-premium hover:text-accent";

  return (
    <Container>
      <div className="py-12">
        <header className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tighter sm:text-4xl">
            {meta.title}
          </h1>
          {meta.paperTitle ? (
            <p className="mt-2 text-sm text-muted">{meta.paperTitle}</p>
          ) : null}

          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
            {meta.authors.length > 0 ? (
              <span>{meta.authors.join(", ")}</span>
            ) : null}
            {meta.paperDate ? (
              <time dateTime={meta.paperDate}>{meta.paperDate}</time>
            ) : null}
          </p>

          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
            <a
              href={`https://arxiv.org/abs/${meta.paperId}`}
              target="_blank"
              rel="noreferrer"
              className={extLink}
            >
              arXiv ↗
            </a>
            <a
              href={`https://arxiv.org/pdf/${meta.paperId}`}
              target="_blank"
              rel="noreferrer"
              className={extLink}
            >
              PDF ↗
            </a>
            <a
              href={`https://alphaxiv.org/overview/${meta.paperId}`}
              target="_blank"
              rel="noreferrer"
              className={extLink}
            >
              alphaXiv ↗
            </a>
            {meta.digestDate ? (
              <Link
                href={`/papers/${meta.digestDate}`}
                className="rounded-full bg-accent/10 px-2 py-0.5 text-accent transition-colors duration-300 ease-premium hover:bg-accent/20"
              >
                {t("insightBackToDigest")}
              </Link>
            ) : null}
          </p>

          {meta.tags.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {meta.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-surface px-2.5 py-0.5 font-mono text-xs text-muted ring-1 ring-hairline"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          <ExportButtons url={`/export/zh/insights/${id}.md`} />
        </header>

        <article className="mx-auto mt-12 w-full max-w-3xl min-w-0">
          <div className="prose max-w-none">
            <Lightbox>
              <MDXContent source={content} />
            </Lightbox>
          </div>
        </article>

        <div className="mx-auto mt-12 max-w-3xl">
          <CiteBlock
            title={meta.title}
            url={`https://cyoungg06.github.io/BlogSite/zh/papers/insights/${id}/`}
            date={meta.date}
          />
        </div>

        <nav className="mx-auto mt-12 max-w-3xl border-t border-hairline pt-6">
          <Link
            href="/papers"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:text-foreground"
          >
            <ArrowLeft size={13} />
            {t("insightBackHome")}
          </Link>
        </nav>
      </div>
    </Container>
  );
}
