import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { Locale } from "@/i18n/routing";
import type { PaperItem } from "@/lib/papers";

/**
 * 论文卡片 v2:中文环境下优先展示 AI 译名 + 中文导读(英文原题降级为副行),
 * 无中文字段或英文环境回退英文标题 + 摘要节选。upvotes 用 accent pill 突出。
 */
export default function PaperCard({
  paper,
  locale,
  t,
}: {
  paper: PaperItem;
  locale: Locale;
  t: { code: string; project: string; etAl: string };
}) {
  const zh = locale === "zh" && Boolean(paper.titleZh && paper.summaryZh);

  const authors = paper.authors.join(", ");
  const authorLine =
    paper.authorsTotal > paper.authors.length
      ? `${authors} ${t.etAl}`
      : authors;

  return (
    <article className="border-b border-hairline py-5 first:border-t">
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
        <p className="mt-0.5 truncate text-xs text-muted">{paper.title}</p>
      ) : null}

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
        {paper.upvotes ? (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">
            ▲ {paper.upvotes}
          </span>
        ) : null}
        {paper.githubStars ? <span>★ {paper.githubStars}</span> : null}
        {paper.primaryCategory ? <span>{paper.primaryCategory}</span> : null}
        <span>{paper.published.slice(0, 10)}</span>
      </p>

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

      {paper.githubRepo || paper.projectPage ? (
        <p className="mt-2 flex gap-4 font-mono text-xs">
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
