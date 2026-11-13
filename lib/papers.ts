import fs from "node:fs";
import path from "node:path";
import { CONTENT_ROOT } from "./content-loader";

/**
 * 论文速递数据层。
 * 目录约定:content/papers/YYYY-MM-DD.json,由 scripts/fetch-daily-papers.py 生成
 * (GitHub Actions 每日自动提交)。空数据日(周末/入库延迟)无文件。
 * arXiv 部分是「全量候选打分、按分入选」(规则见 scripts/digest_select.py):
 * arxiv = 主栏目入选,embodied = 具身栏目入选,overflow = 过了入选线但超出篇数上限的。
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
  /** AI 兴趣评分 0–10(依据 scripts/interest-profile*.md);≤4 派生 relevant:false。
   *  入选线附近的论文判两次取平均,所以可能是 7.5 这样的半分 */
  score?: number;
  /** "embodied" = 按具身画像评分的论文;缺省为主栏目 */
  track?: "embodied";
  /** AI 打分依据(一句中文) */
  reason?: string;
  /** AI 标记的深度解读候选(每日至多 10 个) */
  deepDive?: boolean;
  /** AI 相关性判定:false = 不在读者关注方向(缺省视为相关) */
  relevant?: boolean;
  urls: { abs: string; pdf: string };
}

/** 缺省视为相关,只有显式 false 才被过滤 */
export function isRelevant(paper: PaperItem): boolean {
  return paper.relevant !== false;
}

/** 过了入选线但没进正文的论文,只留标题与分数 */
export interface OverflowItem {
  id: string;
  title: string;
  titleZh?: string;
  score: number;
  primaryCategory?: string;
  track?: "embodied";
  urls: { abs: string; pdf: string };
}

export interface PapersDigest {
  date: string;
  generatedAt: string;
  categories: string[];
  hf: PaperItem[];
  arxiv: PaperItem[];
  /** 具身智能栏目(2026-11 起;旧数据没有) */
  embodied?: PaperItem[];
  overflow?: OverflowItem[];
  /** 当天参与打分的 arXiv 候选总数(入选是从这里面挑的) */
  pool?: { main: number; embodied: number };
  /** 缺省为旧版数据;待公告或暂时失败的来源会在后续运行中补抓。 */
  arxivStatus?: "pending" | "complete" | "error";
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
