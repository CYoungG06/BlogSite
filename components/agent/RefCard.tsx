"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { loadPapersIndex, type IndexedPaper } from "@/lib/agent/tools";

/**
 * 回答里的富引用卡片:
 * - arXiv 链接 → 按 id 在跨天论文索引(all.json)里查元数据,水合成论文卡
 * - /papers/YYYY-MM-DD/ 链接 → 速递日卡
 * 查不到/加载中则退化为普通链接(由调用方兜底渲染)。
 */

const ARXIV_RE = /arxiv\.org\/abs\/(\d{4}\.\d{4,5})/;
const DIGEST_RE = /^\/papers\/(\d{4}-\d{2}-\d{2})\/?$/;

export function arxivIdOf(href: string): string | null {
  return ARXIV_RE.exec(href)?.[1] ?? null;
}

export function digestDateOf(href: string): string | null {
  return DIGEST_RE.exec(href)?.[1] ?? null;
}

function PaperRefCard({ id, href }: { id: string; href: string }) {
  const t = useTranslations("agent");
  const [paper, setPaper] = useState<IndexedPaper | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPapersIndex()
      .then((list) => {
        if (!cancelled) setPaper(list.find((p) => p.id === id) ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 索引里没有(未收录进速递的论文)就退回普通外链样式
  if (!paper) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {href}
      </a>
    );
  }

  return (
    <span className="my-1.5 block rounded-lg border border-hairline px-3 py-2.5">
      <span className="flex items-start justify-between gap-2">
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 text-sm font-medium leading-snug text-foreground no-underline transition-colors duration-300 ease-premium hover:text-accent"
        >
          {paper.titleZh ?? paper.title}
        </a>
        <ArrowUpRight size={13} aria-hidden className="mt-1 shrink-0 text-muted" />
      </span>
      <span className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[0.7rem] text-muted">
        {typeof paper.score === "number" ? (
          <span className="rounded-full bg-accent/10 px-1.5 py-px text-accent">
            ★ {paper.score}
          </span>
        ) : null}
        {paper.upvotes ? (
          <span className="rounded-full bg-foreground/5 px-1.5 py-px">▲ {paper.upvotes}</span>
        ) : null}
        {paper.deepDive ? (
          <span className="rounded-full bg-foreground/5 px-1.5 py-px">{t("deepDiveBadge")}</span>
        ) : null}
        <span>{paper.date}</span>
      </span>
      {paper.summary ? (
        <span className="mt-1.5 block text-xs leading-relaxed text-muted">
          {paper.summary}
        </span>
      ) : null}
    </span>
  );
}

function DigestRefCard({ date }: { date: string }) {
  const t = useTranslations("agent");
  return (
    <Link
      href={`/papers/${date}/`}
      className="group my-1.5 flex items-center justify-between gap-2 rounded-lg border border-hairline px-3 py-2 text-sm no-underline transition-colors duration-300 ease-premium hover:bg-accent/5"
    >
      <span className="flex items-center gap-2">
        <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-xs text-accent">
          {t("digestCardLabel")}
        </span>
        <span className="font-mono text-xs text-muted">{date}</span>
      </span>
      <ArrowUpRight
        size={13}
        aria-hidden
        className="shrink-0 text-accent transition-transform duration-300 ease-premium group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
      />
    </Link>
  );
}

/** markdown 链接的卡片化入口:命中 arXiv/速递模式渲染卡片;站内链接走 Link;其余普通外链 */
export default function RefCard({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const arxivId = arxivIdOf(href);
  if (arxivId) return <PaperRefCard id={arxivId} href={href} />;
  const digestDate = digestDateOf(href);
  if (digestDate) return <DigestRefCard date={digestDate} />;
  if (href.startsWith("/")) return <Link href={href}>{children}</Link>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
