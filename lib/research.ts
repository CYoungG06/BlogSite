import fs from "node:fs";
import path from "node:path";
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
