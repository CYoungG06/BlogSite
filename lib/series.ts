import fs from "node:fs";
import path from "node:path";
import type { Locale } from "@/i18n/routing";
import { CONTENT_ROOT } from "./content-loader";

/**
 * 专题:content/series/<slug>/series.json + lessons/*.html(独立的交互课件,原样保存)。
 * 课件经 scripts/build-series.mjs 注入站点配色后输出到 public/series/<slug>/,
 * 页面用 iframe 嵌入。这里只从课件 HTML 里读标题、导语和正文文本,不改动它。
 * 课件只有中文;英文站显示同一份课件,canonical 指向中文页。
 */

const SERIES_DIR = path.join(CONTENT_ROOT, "series");

type Localized = Record<Locale, string>;

interface SeriesFile {
  title: Localized;
  description: Localized;
  note?: Localized;
  date: string;
  tags: string[];
  benchUrl?: string;
  lessons: { slug: string; date: string }[];
}

export interface Lesson {
  seriesSlug: string;
  slug: string;
  /** 从 1 开始 */
  number: number;
  date: string;
  /** 课件 <h1>,如「把 KV cache 切成页」 */
  title: string;
  /** 课件 <title>,较短,如「KV Cache 分页」 */
  shortTitle: string;
  /** 课件页眉里 h1 后面的第一段 */
  lede: string;
  /** 课件里的全部可读文字(搜索用,不含脚本、样式、图) */
  text: string;
}

export interface Series {
  slug: string;
  title: string;
  description: string;
  note: string;
  date: string;
  tags: string[];
  lessons: Lesson[];
}

const stripTags = (html: string) =>
  html
    .replace(/<(script|style|svg|title)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function readLesson(seriesSlug: string, slug: string, number: number, date: string): Lesson {
  const html = fs.readFileSync(path.join(SERIES_DIR, seriesSlug, "lessons", `${slug}.html`), "utf8");
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const lede = html.match(/<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "";
  return {
    seriesSlug,
    slug,
    number,
    date,
    title: stripTags(h1) || slug,
    shortTitle: stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "") || stripTags(h1),
    lede: stripTags(lede),
    text: stripTags(html),
  };
}

const cache = new Map<string, Series>();

export function getSeriesSlugs(): string[] {
  if (!fs.existsSync(SERIES_DIR)) return [];
  return fs
    .readdirSync(SERIES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(SERIES_DIR, d.name, "series.json")))
    .map((d) => d.name)
    .sort();
}

export function getSeries(slug: string, locale: Locale): Series | null {
  const key = `${slug}/${locale}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const file = path.join(SERIES_DIR, slug, "series.json");
  if (!fs.existsSync(file)) return null;
  const meta = JSON.parse(fs.readFileSync(file, "utf8")) as SeriesFile;
  const series: Series = {
    slug,
    title: meta.title[locale] ?? meta.title.zh,
    description: meta.description[locale] ?? meta.description.zh,
    note: meta.note?.[locale] ?? meta.note?.zh ?? "",
    date: meta.date,
    tags: meta.tags,
    lessons: meta.lessons.map((l, i) => readLesson(slug, l.slug, i + 1, l.date)),
  };
  if (process.env.NODE_ENV === "production") cache.set(key, series);
  return series;
}

export function getAllSeries(locale: Locale): Series[] {
  return getSeriesSlugs()
    .map((slug) => getSeries(slug, locale))
    .filter((s): s is Series => s !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
}
