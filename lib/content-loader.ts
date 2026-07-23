import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { routing, type Locale } from "@/i18n/routing";

/**
 * MDX 文件扫描/解析底层。
 * 目录约定:content/{collection}/{locale}/*.{md,mdx}
 */

export const CONTENT_ROOT = path.join(process.cwd(), "content");

export type Collection = "blog" | "notes" | "distilled" | "reading";

export interface RawEntry {
  slug: string;
  locale: Locale;
  /** 去掉 frontmatter 的 MDX 源码 */
  content: string;
  frontmatter: Record<string, unknown>;
}

/** YAML 的 date: 2026-05-22(不带引号)会被解析成 Date 对象,统一规整为 YYYY-MM-DD */
export function normalizeDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s.slice(0, 10);
}

function readEntry(
  collection: Collection,
  locale: Locale,
  file: string,
): RawEntry {
  const fullPath = path.join(CONTENT_ROOT, collection, locale, file);
  const raw = fs.readFileSync(fullPath, "utf8");
  const { data, content } = matter(raw);
  return {
    slug: file.replace(/\.mdx?$/, ""),
    locale,
    content,
    frontmatter: data,
  };
}

/** 某 collection + locale 下的全部条目(含 draft,由上层过滤) */
export function listEntries(
  collection: Collection,
  locale: Locale,
): RawEntry[] {
  const dir = path.join(CONTENT_ROOT, collection, locale);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => /\.mdx?$/.test(file))
    .map((file) => readEntry(collection, locale, file));
}

export function getEntry(
  collection: Collection,
  locale: Locale,
  slug: string,
): RawEntry | null {
  for (const ext of [".mdx", ".md"]) {
    const fullPath = path.join(CONTENT_ROOT, collection, locale, slug + ext);
    if (fs.existsSync(fullPath)) {
      return readEntry(collection, locale, slug + ext);
    }
  }
  return null;
}

/** 全 locale 的 slug 并集(静态参数用,英文站也能 SSG 出中文原文页) */
export function listAllSlugs(collection: Collection): string[] {
  const slugs = new Set<string>();
  for (const locale of routing.locales) {
    for (const entry of listEntries(collection, locale)) {
      slugs.add(entry.slug);
    }
  }
  return [...slugs];
}

/** 某 slug 在哪些 locale 下存在(决定双语切换徽章) */
export function slugLocales(
  collection: Collection,
  slug: string,
): Partial<Record<Locale, string>> {
  const found: Partial<Record<Locale, string>> = {};
  for (const locale of routing.locales) {
    if (getEntry(collection, locale, slug)) {
      found[locale] = slug;
    }
  }
  return found;
}
