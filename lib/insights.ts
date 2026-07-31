import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { CONTENT_ROOT, normalizeDate } from "./content-loader";

/**
 * 论文深度解读数据层。
 * 目录约定:content/insights/<arxivId>.md(如 2607.22529.md),
 * 通过 paperId 关联速递卡片(徽章),通过 digestDate 回链当日速递。
 */

export interface InsightMeta {
  /** 中文解读标题 */
  title: string;
  /** 英文原题 */
  paperTitle: string;
  /** arXiv ID,与文件名一致(路由参数) */
  paperId: string;
  /** 论文发布/上榜日期 */
  paperDate: string;
  /** 对应速递日期,回链 /papers/<digestDate> */
  digestDate: string;
  /** 解读发布日期(列表排序用) */
  date: string;
  authors: string[];
  /** 卡片用一句话导读 */
  description: string;
  tags: string[];
}

const INSIGHTS_DIR = path.join(CONTENT_ROOT, "insights");

function listInsightFiles(): string[] {
  if (!fs.existsSync(INSIGHTS_DIR)) return [];
  return fs.readdirSync(INSIGHTS_DIR).filter((f) => f.endsWith(".md"));
}

function parseInsight(file: string): { meta: InsightMeta; content: string } {
  const raw = fs.readFileSync(path.join(INSIGHTS_DIR, file), "utf8");
  const { data, content } = matter(raw);
  const fileId = file.replace(/\.md$/, "");
  const meta: InsightMeta = {
    title: String(data.title ?? fileId),
    paperTitle: String(data.paperTitle ?? ""),
    paperId: String(data.paperId ?? fileId),
    paperDate: normalizeDate(data.paperDate) ?? "",
    digestDate: normalizeDate(data.digestDate) ?? "",
    date: normalizeDate(data.date) ?? "",
    authors: Array.isArray(data.authors) ? data.authors.map(String) : [],
    description: String(data.description ?? ""),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
  };
  return { meta, content };
}

/** 全部解读,按发布日期倒序(最新在前) */
export function getAllInsights(): InsightMeta[] {
  return listInsightFiles()
    .map((file) => parseInsight(file).meta)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getInsight(
  id: string,
): { meta: InsightMeta; content: string } | null {
  const file = `${id}.md`;
  if (!listInsightFiles().includes(file)) return null;
  return parseInsight(file);
}

/** 有解读的 arXiv ID 集合(速递卡片徽章查询用,以文件名为准) */
export function getInsightIds(): Set<string> {
  return new Set(listInsightFiles().map((f) => f.replace(/\.md$/, "")));
}
