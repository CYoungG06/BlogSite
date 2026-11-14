import { ArrowUpRight, GithubLogo } from "@phosphor-icons/react/dist/ssr";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { PaperItem } from "@/lib/papers";

export interface PaperCardText {
  code: string;
  project: string;
  etAl: string;
  insight: string;
  deepDive: string;
  /** 分数胶囊上的文字,如「8 分」/「8/10」 */
  score: (score: number) => string;
  scoreWhy: string;
  githubStars: string;
}

/**
 * 论文卡片 v2:中文环境下优先展示 AI 译名 + 中文导读(英文原题降级为副行),
 * 无中文字段或英文环境回退英文标题 + 摘要节选。upvotes 用 accent pill 突出。
 * insightHref 存在时,meta 行追加「深度解读」徽章,链到对应解读页。
 * 卡片带 id = arXiv id,速递搜索结果用 #id 直达;被直达时描一圈 accent 边。
 * 分数胶囊可点开打分理由:隐藏 checkbox + label,纯 CSS,手机上点按也能用。
 */
export default function PaperCard({
  paper,
  locale,
  t,
  insightHref,
}: {
  paper: PaperItem;
  locale: Locale;
  t: PaperCardText;
  insightHref?: string;
}) {
  const zh = locale === "zh" && Boolean(paper.titleZh && paper.summaryZh);
  const whyId = `why-${paper.id}`;
  const hasWhy = paper.score !== undefined && Boolean(paper.reason);

  const authors = paper.authors.join(", ");
  const authorLine =
    paper.authorsTotal > paper.authors.length
      ? `${authors} ${t.etAl}`
      : authors;

  const scoreClass =
    paper.score !== undefined && paper.score >= 8
      ? "rounded-full bg-accent/10 px-2 py-0.5 text-accent"
      : "rounded-full bg-surface px-2 py-0.5 ring-1 ring-hairline";

  return (
    <article
      id={paper.id}
      className="scroll-mt-24 rounded-sm border-b border-hairline py-5 outline-offset-4 first:border-t target:outline-2 target:outline-accent/50 sm:flex sm:items-start sm:gap-6"
    >
      <div className="min-w-0 flex-1">
        <a
          href={paper.urls.abs}
          target="_blank"
          rel="noreferrer"
          className="group inline-flex items-baseline gap-1.5"
        >
          <h3 className="font-medium leading-snug tracking-tight transition-colors duration-300 ease-premium group-hover:text-accent">
            {zh ? paper.titleZh : paper.title}
          </h3>
          <ArrowUpRight
            size={13}
            aria-hidden
            className="shrink-0 self-center text-accent opacity-0 transition-opacity duration-300 ease-premium group-hover:opacity-100"
          />
        </a>
        {zh ? (
          <p className="mt-0.5 truncate text-sm text-muted">{paper.title}</p>
        ) : null}

        {hasWhy ? (
          <input id={whyId} type="checkbox" className="peer sr-only" aria-label={t.scoreWhy} />
        ) : null}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
          {paper.upvotes ? (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">
              ▲ {paper.upvotes}
            </span>
          ) : null}
          {paper.deepDive ? (
            <span
              title={paper.reason || undefined}
              className="rounded-full bg-accent px-2 py-0.5 text-white"
            >
              ★ {t.deepDive}
            </span>
          ) : null}
          {paper.score !== undefined ? (
            hasWhy ? (
              <label
                htmlFor={whyId}
                title={t.scoreWhy}
                className={`${scoreClass} cursor-pointer select-none [.peer:focus-visible~*_&]:outline-2 [.peer:focus-visible~*_&]:outline-accent`}
              >
                {t.score(paper.score)}
              </label>
            ) : (
              <span className={scoreClass}>{t.score(paper.score)}</span>
            )
          ) : null}
          {insightHref ? (
            <Link
              href={insightHref}
              className="rounded-full bg-accent/10 px-2 py-0.5 text-accent transition-colors duration-300 ease-premium hover:bg-accent/20"
            >
              {t.insight}
            </Link>
          ) : null}
          {paper.githubStars ? (
            <span className="inline-flex items-center gap-1" title={t.githubStars}>
              <GithubLogo size={12} aria-hidden />
              <span className="sr-only">{t.githubStars}</span>
              {paper.githubStars}
            </span>
          ) : null}
          {paper.primaryCategory ? <span>{paper.primaryCategory}</span> : null}
          <span>{paper.published.slice(0, 10)}</span>
        </p>
        {hasWhy ? (
          <p className="mt-1.5 hidden text-xs leading-relaxed text-muted peer-checked:block">
            {t.scoreWhy}
            {locale === "zh" ? "：" : ": "}
            {paper.reason}
          </p>
        ) : null}

        {authorLine ? (
          <p className="mt-1.5 truncate text-sm text-muted">{authorLine}</p>
        ) : null}
        {zh ? (
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">
            {paper.summaryZh}
          </p>
        ) : paper.abstract ? (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">
            {paper.abstract}
          </p>
        ) : null}
      </div>

      {/* 链接列:宽屏右对齐竖排,窄屏回落为底部横排 */}
      {paper.githubRepo || paper.projectPage ? (
        <p className="mt-2 flex shrink-0 gap-4 font-mono text-xs sm:mt-0 sm:flex-col sm:items-end sm:gap-1.5 sm:pt-0.5">
          {paper.githubRepo ? (
            <a
              href={paper.githubRepo}
              target="_blank"
              rel="noreferrer"
              className="text-muted transition-colors duration-300 ease-premium hover:text-accent"
            >
              {t.code} ↗
            </a>
          ) : null}
          {paper.projectPage ? (
            <a
              href={paper.projectPage}
              target="_blank"
              rel="noreferrer"
              className="text-muted transition-colors duration-300 ease-premium hover:text-accent"
            >
              {t.project} ↗
            </a>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}
