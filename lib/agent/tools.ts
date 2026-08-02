import { basePath } from "@/lib/images";
import { loadSearchIndex, type SearchResultItem } from "@/lib/search/load-index";

/**
 * AI 助手的工具集:OpenAI tools schema + 浏览器端执行器。
 * 所有工具都只是 fetch 站内公开静态 JSON(构建期由
 * scripts/generate-agent-api.mjs / generate-papers-api.mjs / build-search-index.mjs 产出),
 * Worker 代理不含任何业务逻辑。
 */

/** type → 站内路由前缀(locale 相对);与 scripts/generate-agent-api.mjs 保持一致 */
const TYPE_ROUTES: Record<string, string> = {
  post: "/blog/",
  note: "/notes/",
  distilled: "/distilled/",
  reading: "/reading/",
  insight: "/papers/insights/",
  research: "/research/",
};

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_site_map",
      description:
        "获取站点地图:博客有哪些栏目、每篇文章的标题/简介/路径、以及研究/关于/音乐等页面摘要。需要了解站点结构或找文章时先调它。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_site",
      description:
        "全站全文检索(博客文章、笔记、蒸馏、精读)。按内容关键词找文章时用,返回标题、简介与路径。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索关键词,中英均可" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_article",
      description:
        "读取指定文章的完整正文(纯文本)。type 与 slug 来自 get_site_map 或 search_site 的结果。",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["post", "note", "distilled", "reading", "insight", "research"],
          },
          slug: { type: "string" },
        },
        required: ["type", "slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_digests",
      description:
        "列出论文速递的日期索引:哪些天有速递、每天多少篇、最新一期是哪天。查论文前先调它确定日期。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_digest",
      description:
        "读取某一天的论文速递(Hugging Face 热门 + arXiv 新论文),含 AI 评分、中文导读、深度解读标记与链接。已过滤低相关论文。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          source: {
            type: "string",
            enum: ["hf", "arxiv"],
            description: "可选,只看某一来源",
          },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate",
      description:
        "向用户展示一个站内跳转卡片(用户点击后跳转)。当用户明确想找某个页面/栏目时使用,path 必须是站内路径。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "站内路径,如 /papers/、/music/、/blog/lora/",
          },
          label: { type: "string", description: "卡片上显示的名称" },
        },
        required: ["path", "label"],
      },
    },
  },
] as const;

export type AgentToolName =
  | "get_site_map"
  | "search_site"
  | "read_article"
  | "list_digests"
  | "read_digest"
  | "navigate";

/** 一次工具调用的记录,UI 用来渲染「正在查资料」与跳转卡片 */
export interface ToolCallRecord {
  name: AgentToolName;
  args: Record<string, unknown>;
}

interface DigestPaper {
  id: string;
  title: string;
  titleZh?: string;
  summaryZh?: string;
  score?: number;
  deepDive?: boolean;
  relevant?: boolean;
  upvotes?: number;
  urls?: { abs?: string };
}

async function getSiteMap(locale: string): Promise<string> {
  const res = await fetch(`${basePath}/api/agent/site.${locale}.json`);
  if (!res.ok) throw new Error(`site map ${res.status}`);
  const site = await res.json();
  const slim = {
    name: site.name,
    description: site.description,
    sections: (site.sections ?? []).map(
      (s: { type: string; label: string; path: string; items: { slug: string; title: string; description?: string; path: string }[] }) => ({
        type: s.type,
        label: s.label,
        path: s.path,
        items: s.items.map((it) => ({
          slug: it.slug,
          title: it.title,
          description: truncate(it.description ?? "", 120),
          path: it.path,
        })),
      }),
    ),
    pages: site.pages ?? [],
  };
  return JSON.stringify(slim);
}

async function searchSite(query: string, locale: string): Promise<string> {
  const index = await loadSearchIndex(locale);
  const results = index
    .search(query.trim(), { prefix: true, fuzzy: 0.15, combineWith: "AND" })
    .slice(0, 8)
    .map((r) => {
      const { type, slug, title, description } =
        r as unknown as SearchResultItem;
      return {
        type,
        slug,
        title,
        description: truncate(description ?? "", 120),
        path: `${TYPE_ROUTES[type] ?? "/"}${slug}/`,
      };
    });
  return JSON.stringify({ results });
}

async function readArticle(
  type: string,
  slug: string,
  locale: string,
): Promise<string> {
  const res = await fetch(
    `${basePath}/api/agent/articles/${locale}/${type}--${slug}.json`,
  );
  if (!res.ok) return JSON.stringify({ error: "article not found" });
  const article = await res.json();
  return JSON.stringify({
    title: article.title,
    path: article.path,
    text: truncate(String(article.text ?? ""), 8000),
  });
}

async function listDigests(): Promise<string> {
  const res = await fetch(`${basePath}/api/papers/index.json`);
  if (!res.ok) throw new Error(`digests index ${res.status}`);
  const index = await res.json();
  return JSON.stringify({
    latest: index.latest,
    dates: (index.dates ?? []).slice(0, 14),
  });
}

async function readDigest(date: string, source: string | undefined): Promise<string> {
  const res = await fetch(`${basePath}/api/papers/${date}.json`);
  if (!res.ok) return JSON.stringify({ error: `no digest for ${date}` });
  const digest = await res.json();
  const slim = (p: DigestPaper) => ({
    id: p.id,
    title: p.title,
    titleZh: p.titleZh,
    summary: truncate(p.summaryZh ?? "", 350),
    score: p.score,
    deepDive: p.deepDive === true,
    upvotes: p.upvotes || undefined,
    url: p.urls?.abs,
  });
  const relevant = (p: DigestPaper) => p.relevant !== false;
  const out: Record<string, unknown> = { date };
  if (source !== "arxiv") out.hf = (digest.hf ?? []).filter(relevant).map(slim);
  if (source !== "hf") out.arxiv = (digest.arxiv ?? []).filter(relevant).map(slim);
  return JSON.stringify(out);
}

/** 执行工具,返回给模型的 tool message 内容(JSON 字符串) */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  locale: string,
): Promise<string> {
  try {
    switch (name) {
      case "get_site_map":
        return await getSiteMap(locale);
      case "search_site":
        return await searchSite(String(args.query ?? ""), locale);
      case "read_article":
        return await readArticle(String(args.type ?? ""), String(args.slug ?? ""), locale);
      case "list_digests":
        return await listDigests();
      case "read_digest":
        return await readDigest(
          String(args.date ?? ""),
          args.source ? String(args.source) : undefined,
        );
      case "navigate": {
        const path = String(args.path ?? "");
        if (!path.startsWith("/")) return JSON.stringify({ error: "invalid path" });
        return JSON.stringify({ presented: true, path, label: String(args.label ?? path) });
      }
      default:
        return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  } catch (error) {
    return JSON.stringify({ error: String(error) });
  }
}
