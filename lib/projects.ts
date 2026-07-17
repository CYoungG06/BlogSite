import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { Locale } from "@/i18n/routing";
import { CONTENT_ROOT, normalizeDate } from "./content-loader";

/**
 * 项目:content/projects/*.mdx,单文件双语。
 * title / description 可为字符串或 { zh, en } map;featured 置顶;
 * hasDetail: true 才生成详情页。
 */

const PROJECTS_DIR = path.join(CONTENT_ROOT, "projects");

export interface Project {
  slug: string;
  title: string;
  description: string;
  date: string | null;
  tags: string[];
  cover: string | null;
  github: string | null;
  live: string | null;
  featured: boolean;
  hasDetail: boolean;
  content: string;
}

type Localized = string | Partial<Record<Locale, string>> | undefined;

function pick(value: Localized, locale: Locale): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[locale] ?? value.zh ?? value.en ?? "";
}

function toProject(slug: string, locale: Locale): Project {
  const raw = fs.readFileSync(path.join(PROJECTS_DIR, `${slug}.mdx`), "utf8");
  const { data: fm, content } = matter(raw);
  const title = pick(fm.title as Localized, locale);
  if (!title) {
    throw new Error(`[content] projects/${slug}: 缺少 frontmatter.title`);
  }
  return {
    slug,
    title,
    description: pick(fm.description as Localized, locale),
    date: normalizeDate(fm.date),
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    cover: typeof fm.cover === "string" ? fm.cover : null,
    github: typeof fm.github === "string" ? fm.github : null,
    live: typeof fm.live === "string" ? fm.live : null,
    featured: fm.featured === true,
    hasDetail: fm.hasDetail === true,
    content,
  };
}

export function getProjectSlugs(): string[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs
    .readdirSync(PROJECTS_DIR)
    .filter((file) => /\.mdx?$/.test(file))
    .map((file) => file.replace(/\.mdx?$/, ""));
}

/** hasDetail: true 的项目 slug(与 locale 无关,静态参数用) */
export function getDetailProjectSlugs(): string[] {
  return getProjectSlugs().filter((slug) => {
    const raw = fs.readFileSync(path.join(PROJECTS_DIR, `${slug}.mdx`), "utf8");
    return matter(raw).data.hasDetail === true;
  });
}

/** featured 置顶,其余按日期倒序 */
export function getProjects(locale: Locale): Project[] {
  return getProjectSlugs()
    .map((slug) => toProject(slug, locale))
    .sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      if (a.date && b.date) return a.date < b.date ? 1 : -1;
      return a.date ? -1 : b.date ? 1 : 0;
    });
}

export function getProject(locale: Locale, slug: string): Project | null {
  if (!getProjectSlugs().includes(slug)) return null;
  return toProject(slug, locale);
}
