import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import AskAcaneButtons from "@/components/agent/AskAcaneButtons";
import ArticleNeighbors from "@/components/ArticleNeighbors";
import BackToTop from "@/components/BackToTop";
import CiteBlock from "@/components/CiteBlock";
import ExportButtons from "@/components/ExportButtons";
import FallbackNotice from "@/components/blog/FallbackNotice";
import Container from "@/components/layout/Container";
import Lightbox from "@/components/mdx/Lightbox";
import MDXContent from "@/components/mdx/MDXContent";
import TableOfContents from "@/components/mdx/TableOfContents";
import TagLink from "@/components/TagLink";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { CollectionItem } from "@/lib/collection";
import { formatDate } from "@/lib/format";
import { extractHeadings } from "@/lib/markdown";
import { absoluteUrl } from "@/lib/site";

/**
 * 文章/笔记详情页共用布局:
 * 阅读进度条 + 头部(mono meta / tags / 双语徽章 / 降级提示)+ 正文 +
 * 引用 / 问阿卡内 / 相关内容 / 上下篇;xl 且有目录时两栏(左:以上全部,右:sticky 目录)。
 * 头部和正文放在同一栏里,两栏布局下也左对齐(曾经头部居中、正文靠左,错开约 90px)。
 * 坑:主栏必须 min-w-0 且 xl:mx-0 — grid 子元素带 auto margin
 * 会退化成 fit-content,长代码/公式把文章顶出轨道压到 TOC。
 */
export default function ArticleDetail({
  item,
  kind,
  locale,
}: {
  item: CollectionItem;
  kind: "blog" | "notes" | "distilled" | "reading";
  locale: Locale;
}) {
  const t = useTranslations(kind);
  const tAgent = useTranslations("agent");
  const toc = extractHeadings(item.content);
  const showToc = toc.length >= 3; // 标题 < 3 个不显示
  const otherLocale: Locale = locale === "zh" ? "en" : "zh";
  const base = `/${kind}`;

  return (
    <>
      {/* 阅读进度条:animation-timeline: scroll() 零 JS,不支持则隐藏 */}
      <div
        aria-hidden
        className="animate-grow-x fixed inset-x-0 top-0 z-40 h-0.5 origin-left scale-x-0 bg-accent"
      />
      <Container>
        <div
          className={`py-12 ${
            showToc ? "xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-10" : ""
          }`}
        >
          <div
            className={`mx-auto w-full max-w-3xl min-w-0 ${showToc ? "xl:mx-0" : ""}`}
          >
            <header>
              <Link
                href={base}
                className="inline-flex items-center gap-1.5 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:text-foreground"
              >
                <ArrowLeft size={13} />
                {t("back")}
              </Link>
              <h1 className="mt-6 text-3xl font-semibold tracking-tighter sm:text-4xl">
                {item.title}
              </h1>
              <p className="mt-4 font-mono text-xs text-muted">
                <time dateTime={item.date}>{formatDate(item.date, locale)}</time>
                {" · "}
                {t("readingTime", { minutes: item.readingMinutes })}
                {item.draft ? (
                  <>
                    {" · "}
                    <span className="text-foreground">{t("draft")}</span>
                  </>
                ) : null}
              </p>
              {item.source ? (
                <p className="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs">
                  <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-accent">
                    {t("fromSource", {
                      name: item.source.author ?? item.source.name ?? "",
                    })}
                  </span>
                  {item.source.url ? (
                    <a
                      href={item.source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted transition-colors duration-300 ease-premium hover:text-accent"
                    >
                      {t("readOriginal")} ↗
                    </a>
                  ) : null}
                </p>
              ) : null}
              {item.tags.length > 0 || item.locales.length > 1 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {item.tags.map((tag) => (
                    <TagLink key={tag} tag={tag} />
                  ))}
                  {item.locales.length > 1 ? (
                    <Link
                      href={`${base}/${item.slug}`}
                      locale={otherLocale}
                      className="rounded-full bg-surface px-2.5 py-0.5 font-mono text-xs text-muted ring-1 ring-hairline transition-colors duration-300 ease-premium hover:text-accent"
                    >
                      {t("otherLocale")}
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {item.fallback ? (
                <div className="mt-6">
                  <FallbackNotice
                    expected={locale}
                    actual={item.locale}
                    namespace={kind}
                  />
                </div>
              ) : null}
              {/* 导出:复制/下载/打印(笔记不开放);导出文件按内容 locale 生成 */}
              {kind !== "notes" ? (
                <ExportButtons
                  url={`/export/${item.locale}/${kind}/${item.slug}.md`}
                />
              ) : null}
            </header>

            <article className="mt-12">
              {showToc ? (
                <div className="mb-8 print:hidden xl:hidden">
                  <TableOfContents
                    items={toc}
                    title={t("toc")}
                    variant="inline"
                  />
                </div>
              ) : null}
              <div className="prose max-w-none">
                <Lightbox>
                  <MDXContent source={item.content} />
                </Lightbox>
              </div>
            </article>

            {/* 引用本文:BibTeX 一键复制(笔记不开放) */}
            {kind !== "notes" ? (
              <div className="mt-12">
                <CiteBlock
                  title={item.title}
                  url={absoluteUrl(`/${item.locale}/${kind}/${item.slug}/`)}
                  date={item.date}
                  sourceName={item.source?.name}
                />
              </div>
            ) : null}

            {/* 情境化入口:读完让阿卡内总结 / 出题 */}
            <div className="mt-16 border-t border-hairline pt-8 print:hidden">
              <AskAcaneButtons
                heading={tAgent("articleAskHeading")}
                items={[
                  {
                    label: tAgent("summarizeBtn"),
                    prompt: tAgent("summarizePrompt", { title: item.title }),
                  },
                  {
                    label: tAgent("quizBtn"),
                    prompt: tAgent("quizPrompt", { title: item.title }),
                  },
                ]}
              />
            </div>

            <ArticleNeighbors
              locale={locale}
              kind={kind}
              slug={item.slug}
              tags={item.tags}
            />
          </div>

          {showToc ? (
            <aside className="hidden print:hidden xl:block">
              <div className="sticky top-24">
                <TableOfContents
                  items={toc}
                  title={t("toc")}
                  variant="sidebar"
                />
              </div>
            </aside>
          ) : null}
        </div>
      </Container>
      <BackToTop />
    </>
  );
}
