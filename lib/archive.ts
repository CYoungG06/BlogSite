import type { Locale } from "@/i18n/routing";
import { getCollectionItems, type CollectionItem } from "./collection";
import type { Collection } from "./content-loader";
import { getAllInsights } from "./insights";

/**
 * 全站可归档内容的统一视图:文章 / 蒸馏 / 精读 / 笔记 / 论文深度解读。
 * 归档页(按年 + 标签筛选)、文章页的「相关内容」与「上一篇 / 下一篇」共用。
 */

export type ArchiveKind = "blog" | "distilled" | "reading" | "notes" | "insight";

export interface ArchiveEntry {
  kind: ArchiveKind;
  slug: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  tags: string[];
  /** 站内路径(不含 locale,带结尾斜杠) */
  href: string;
}

const COLLECTIONS: Exclude<ArchiveKind, "insight">[] = [
  "blog",
  "distilled",
  "reading",
  "notes",
];

function fromCollection(kind: Collection, item: CollectionItem): ArchiveEntry {
  return {
    kind,
    slug: item.slug,
    title: item.title,
    date: item.date,
    description: item.description,
    tags: item.tags,
    href: `/${kind}/${item.slug}/`,
  };
}

const byDateDesc = (a: ArchiveEntry, b: ArchiveEntry) =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug);

// 构建期每个文章页都会查一遍:生产构建里按 locale 缓存(开发时不缓存,改内容即时生效)
const cache = new Map<Locale, ArchiveEntry[]>();

/** 全部可归档内容,日期倒序(草稿已由 collection 层按环境过滤) */
export function getArchiveEntries(locale: Locale): ArchiveEntry[] {
  const cached = cache.get(locale);
  if (cached) return cached;
  const entries: ArchiveEntry[] = [];
  for (const kind of COLLECTIONS) {
    for (const item of getCollectionItems(kind, locale)) {
      entries.push(fromCollection(kind, item));
    }
  }
  for (const insight of getAllInsights()) {
    entries.push({
      kind: "insight",
      slug: insight.paperId,
      title: insight.title,
      date: insight.date,
      description: insight.description,
      tags: insight.tags,
      href: `/papers/insights/${insight.paperId}/`,
    });
  }
  entries.sort(byDateDesc);
  if (process.env.NODE_ENV === "production") cache.set(locale, entries);
  return entries;
}

/** 标签及其篇数,篇数多的在前 */
export function getTagCounts(entries: ArchiveEntry[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** 同一栏目里按日期相邻的两篇:older = 上一篇(更早),newer = 下一篇(更新) */
export function getAdjacent(
  locale: Locale,
  kind: ArchiveKind,
  slug: string,
): { older: ArchiveEntry | null; newer: ArchiveEntry | null } {
  const list = getArchiveEntries(locale).filter((e) => e.kind === kind);
  const i = list.findIndex((e) => e.slug === slug);
  if (i < 0) return { older: null, newer: null };
  return { newer: list[i - 1] ?? null, older: list[i + 1] ?? null };
}

/**
 * 相关内容:跨栏目按共同标签数排序,同分取较新的;至少共享一个标签才算。
 * 标签比较不区分大小写(LLM / llm)。
 */
export function getRelated(
  locale: Locale,
  kind: ArchiveKind,
  slug: string,
  tags: string[],
  limit = 3,
): ArchiveEntry[] {
  const mine = new Set(tags.map((t) => t.toLowerCase()));
  if (mine.size === 0) return [];
  return getArchiveEntries(locale)
    .filter((e) => !(e.kind === kind && e.slug === slug))
    .map((e) => ({
      entry: e,
      shared: e.tags.filter((t) => mine.has(t.toLowerCase())).length,
    }))
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared || byDateDesc(a.entry, b.entry))
    .slice(0, limit)
    .map((x) => x.entry);
}
