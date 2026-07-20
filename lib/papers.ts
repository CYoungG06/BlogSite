import fs from "node:fs";
import path from "node:path";
import { CONTENT_ROOT } from "./content-loader";

/**
 * 论文速递数据层。
 * 目录约定:content/papers/YYYY-MM-DD.json,由 scripts/fetch-daily-papers.py 生成
 * (GitHub Actions 每日自动提交)。空数据日(周末/入库延迟)无文件。
 */

export interface PaperItem {
  id: string;
  title: string;
  authors: string[];
  authorsTotal: number;
  abstract: string;
  published: string;
  primaryCategory?: string;
  /** arXiv 备注(页数/收录信息,如 "Accepted to NeurIPS") */
  comment?: string;
  upvotes?: number;
  githubRepo?: string;
  githubStars?: number;
  projectPage?: string;
  numComments?: number;
  /** AI 生成的中文译名与导读(scripts/summarize-digest.py,可能缺失) */
  titleZh?: string;
  summaryZh?: string;
  /** AI 相关性判定:false = 不在读者关注方向(缺省视为相关) */
  relevant?: boolean;
  urls: { abs: string; pdf: string };
}

/** 缺省视为相关,只有显式 false 才被过滤 */
export function isRelevant(paper: PaperItem): boolean {
  return paper.relevant !== false;
}

export interface PapersDigest {
  date: string;
  generatedAt: string;
  categories: string[];
  hf: PaperItem[];
  arxiv: PaperItem[];
}

const PAPERS_DIR = path.join(CONTENT_ROOT, "papers");
const FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

/** 全部速递日期,倒序(最新在前) */
export function getDigestDates(): string[] {
  if (!fs.existsSync(PAPERS_DIR)) return [];
  return fs
    .readdirSync(PAPERS_DIR)
    .filter((f) => FILE_RE.test(f))
    .map((f) => f.replace(/\.json$/, ""))
    .sort()
    .reverse();
}

export function getDigest(date: string): PapersDigest | null {
  const file = path.join(PAPERS_DIR, `${date}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as PapersDigest;
}

export function getLatestDigest(): PapersDigest | null {
  const [latest] = getDigestDates();
  return latest ? getDigest(latest) : null;
}
