import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { CONTENT_ROOT } from "./content-loader";

/**
 * 研究专栏数据层。
 * 数据在 content/research/research.json:研究方向简介、可选组介绍、
 * News 时间线与论文列表。站内保持匿名:不印作者名单与单位,
 * 贡献度用 contribution 徽章表达(first / co-first / author)。
 */

export type Contribution = "first" | "co-first" | "author";

export interface Publication {
  title: string;
  /** 发表 venue,如 "ICML 2026"、"arXiv preprint" */
  venue: string;
  /** YYYY-MM,用于排序与显示 */
  date: string;
  contribution: Contribution;
  /** 一句话中文简介 */
  tldr?: string;
  links?: { arxiv?: string; code?: string; project?: string; poster?: string };
  /** 海报预览图(点击跳转 links.poster 的 PDF) */
  posterImage?: string;
  /** 有详情页(content/research/<slug>.mdx)时,标题改为内部链接 */
  slug?: string;
  /** 代表作标记,排序时置顶 */
  selected?: boolean;
}

export interface ResearchNews {
  /** YYYY-MM */
  date: string;
  text: string;
}

export interface ResearchData {
  intro: string;
  group?: string;
  news: ResearchNews[];
  publications: Publication[];
}

export function getResearch(): ResearchData {
  const empty: ResearchData = { intro: "", news: [], publications: [] };
  const file = path.join(CONTENT_ROOT, "research", "research.json");
  if (!fs.existsSync(file)) return empty;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ResearchData>;
    return {
      intro: typeof data.intro === "string" ? data.intro : "",
      group: typeof data.group === "string" && data.group ? data.group : undefined,
      news: Array.isArray(data.news) ? data.news : [],
      publications: Array.isArray(data.publications) ? data.publications : [],
    };
  } catch {
    return empty;
  }
}

/** 论文排序:代表作优先,其余按日期倒序 */
export function sortPublications(pubs: Publication[]): Publication[] {
  return [...pubs].sort((a, b) => {
    if (Boolean(a.selected) !== Boolean(b.selected)) return a.selected ? -1 : 1;
    return b.date.localeCompare(a.date);
  });
}

/* ---------- 工作详情页(showcase):content/research/<slug>.mdx ---------- */

export interface ResearchWorkMeta {
  slug: string;
  /** 论文原标题 */
  title: string;
  /** 中文一句话副题 */
  subtitle?: string;
  venue: string;
  date: string;
  contribution: Contribution;
  selected?: boolean;
  /** TL;DR 卡片文字 */
  tldr: string;
  links?: { arxiv?: string; code?: string; project?: string; poster?: string };
  posterImage?: string;
}

const WORKS_DIR = path.join(CONTENT_ROOT, "research");

function listWorkFiles(): string[] {
  if (!fs.existsSync(WORKS_DIR)) return [];
  return fs.readdirSync(WORKS_DIR).filter((f) => f.endsWith(".mdx"));
}

/** 全部工作详情页 slug(以文件名为准,路由与列表互链用) */
export function getResearchWorkSlugs(): string[] {
  return listWorkFiles().map((f) => f.replace(/\.mdx$/, ""));
}

/** 读取单个工作详情:frontmatter 转 meta,正文为 MDX 源 */
export function getResearchWork(
  slug: string,
): { meta: ResearchWorkMeta; content: string } | null {
  const file = `${slug}.mdx`;
  if (!listWorkFiles().includes(file)) return null;
  const raw = fs.readFileSync(path.join(WORKS_DIR, file), "utf8");
  const { data, content } = matter(raw);
  const meta: ResearchWorkMeta = {
    slug,
    title: String(data.title ?? slug),
    subtitle: data.subtitle ? String(data.subtitle) : undefined,
    venue: String(data.venue ?? ""),
    date: String(data.date ?? ""),
    contribution: (data.contribution as Contribution) ?? "author",
    selected: Boolean(data.selected),
    tldr: String(data.tldr ?? ""),
    links: data.links ?? undefined,
    posterImage: data.posterImage ? String(data.posterImage) : undefined,
  };
  return { meta, content };
}
