import { routing, type Locale } from "@/i18n/routing";
import {
  getEntry,
  listAllSlugs,
  normalizeDate,
  slugLocales,
  type Collection,
  type RawEntry,
} from "./content-loader";
import { estimateReadingMinutes } from "./markdown";

/**
 * blog / notes 共用的集合装配:locale 回退、草稿过滤、日期倒序。
 * 缺 locale 时回退默认语言(再不行回退任意可用语言),标记 fallback。
 */

const isDev = process.env.NODE_ENV === "development";

export interface CollectionItem {
  slug: string;
  /** 实际内容的 locale(回退后与请求 locale 可能不同) */
  locale: Locale;
  /** true = 内容不是请求的 locale,详情页需显示降级提示 */
  fallback: boolean;
  /** 该 slug 存在哪些 locale(双语切换徽章用) */
  locales: Locale[];
  title: string;
  date: string;
  description: string;
  tags: string[];
  draft: boolean;
  /** 精选(置顶展示) */
  featured: boolean;
  readingMinutes: number;
  content: string;
}

function toItem(
  collection: Collection,
  raw: RawEntry,
  fallback: boolean,
): CollectionItem {
  const fm = raw.frontmatter;
  const title = typeof fm.title === "string" ? fm.title.trim() : "";
  const date = normalizeDate(fm.date);
  if (!title || !date) {
    throw new Error(
      `[content] ${collection}/${raw.locale}/${raw.slug}: 缺少 frontmatter.title/date`,
    );
  }
  return {
    slug: raw.slug,
    locale: raw.locale,
    fallback,
    locales: Object.keys(slugLocales(collection, raw.slug)) as Locale[],
    title,
    date,
    description: typeof fm.description === "string" ? fm.description : "",
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    draft: fm.draft === true,
    featured: fm.featured === true,
    readingMinutes: estimateReadingMinutes(raw.content),
    content: raw.content,
  };
}

/** 解析 slug 的实际内容来源:请求 locale → 默认 locale → 任意可用 locale */
function resolveRaw(
  collection: Collection,
  locale: Locale,
  slug: string,
): { raw: RawEntry; fallback: boolean } | null {
  const own = getEntry(collection, locale, slug);
  if (own) return { raw: own, fallback: false };
  if (locale !== routing.defaultLocale) {
    const dft = getEntry(collection, routing.defaultLocale, slug);
    if (dft) return { raw: dft, fallback: true };
  }
  for (const other of routing.locales) {
    if (other === locale || other === routing.defaultLocale) continue;
    const entry = getEntry(collection, other, slug);
    if (entry) return { raw: entry, fallback: true };
  }
  return null;
}

export function getCollectionItems(
  collection: Collection,
  locale: Locale,
): CollectionItem[] {
  const items: CollectionItem[] = [];
  for (const slug of listAllSlugs(collection)) {
    const resolved = resolveRaw(collection, locale, slug);
    if (!resolved) continue;
    if (resolved.raw.frontmatter.draft === true && !isDev) continue;
    items.push(toItem(collection, resolved.raw, resolved.fallback));
  }
  return items.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getCollectionItem(
  collection: Collection,
  locale: Locale,
  slug: string,
): CollectionItem | null {
  const resolved = resolveRaw(collection, locale, slug);
  if (!resolved) return null;
  if (resolved.raw.frontmatter.draft === true && !isDev) return null;
  return toItem(collection, resolved.raw, resolved.fallback);
}
