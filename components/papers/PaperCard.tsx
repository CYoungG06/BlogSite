import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { PaperItem } from "@/lib/papers";

/**
 * 论文卡片:标题(外链 arXiv)+ 徽章行(△ upvotes / ★ stars / 分类)+
 * 作者 + 摘要节选 + PDF/代码/项目链接。速递页与首页共用。
 */
export default function PaperCard({
  paper,
  t,
}: {
  paper: PaperItem;
  t: { code: string; project: string; etAl: string };
}) {
  const meta: string[] = [];
  if (paper.upvotes) meta.push(`▲ ${paper.upvotes}`);
  if (paper.githubStars) meta.push(`★ ${paper.githubStars}`);
  if (paper.primaryCategory) meta.push(paper.primaryCategory);
  meta.push(paper.published.slice(0, 10));

  const authors = paper.authors.join(", ");
  const authorLine =
    paper.authorsTotal > paper.authors.length
      ? `${authors} ${t.etAl}`
      : authors;

  return (
    <article className="border-b border-hairline py-4 first:border-t">
      <a
        href={paper.urls.abs}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex items-baseline gap-1.5"
      >
        <h3 className="font-medium leading-snug tracking-tight transition-colors duration-300 ease-premium group-hover:text-accent">
          {paper.title}
        </h3>
        <ArrowUpRight
          size={13}
          aria-hidden
          className="shrink-0 self-center text-accent opacity-0 transition-opacity duration-300 ease-premium group-hover:opacity-100"
        />
      </a>
      <p className="mt-1 font-mono text-xs text-muted">{meta.join(" · ")}</p>
      {authorLine ? (
        <p className="mt-1 truncate text-sm text-muted">{authorLine}</p>
      ) : null}
      {paper.abstract ? (
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">
          {paper.abstract}
        </p>
      ) : null}
      {paper.githubRepo || paper.projectPage ? (
        <p className="mt-1.5 flex gap-4 font-mono text-xs">
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
