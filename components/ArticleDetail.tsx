import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import FallbackNotice from "@/components/blog/FallbackNotice";
import Container from "@/components/layout/Container";
import Lightbox from "@/components/mdx/Lightbox";
import MDXContent from "@/components/mdx/MDXContent";
import TableOfContents from "@/components/mdx/TableOfContents";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { CollectionItem } from "@/lib/collection";
import { formatDate } from "@/lib/format";
import { extractHeadings } from "@/lib/markdown";

/**
 * 文章/笔记详情页共用布局:
 * 阅读进度条 + 头部(mono meta / tags / 双语徽章 / 降级提示)+
 * xl 两栏(正文 + sticky TOC)。
 * 坑:article 必须 min-w-0 且 xl:mx-0 — grid 子元素带 auto margin
 * 会退化成 fit-content,长代码/公式把文章顶出轨道压到 TOC。
 */
export default function ArticleDetail({
  item,
  kind,
  locale,
}: {
  item: CollectionItem;
  kind: "blog" | "notes";
  locale: Locale;
}) {
  const t = useTranslations(kind);
  const toc = extractHeadings(item.content);
  const showToc = toc.length >= 3; // 标题 < 3 个不显示
  const otherLocale: Locale = locale === "zh" ? "en" : "zh";
  const base = kind === "blog" ? "/blog" : "/notes";

  return (
    <>
      {/* 阅读进度条:animation-timeline: scroll() 零 JS,不支持则隐藏 */}
      <div
        aria-hidden
        className="animate-grow-x fixed inset-x-0 top-0 z-40 h-0.5 origin-left scale-x-0 bg-accent"
      />
      <Container>
        <div className="py-12">
          <header className="mx-auto max-w-3xl">
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
            {item.tags.length > 0 || item.locales.length > 1 ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-surface px-2.5 py-0.5 font-mono text-xs text-muted ring-1 ring-hairline"
                  >
                    {tag}
                  </span>
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
          </header>

          <div
            className={`mt-12 ${
              showToc
                ? "xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-10"
                : ""
            }`}
          >
            <article className="mx-auto w-full max-w-3xl min-w-0 xl:mx-0">
              {showToc ? (
                <div className="mb-8 xl:hidden">
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
            {showToc ? (
              <aside className="hidden xl:block">
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
        </div>
      </Container>
    </>
  );
}
