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

const ARTICLE_TYPES = ["post", "note", "distilled", "reading", "insight", "research"] as const;

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
      name: "search_papers",
      description:
        "跨天检索论文速递:按关键词在全部历史速递(HF 热门 + arXiv)的标题/中文导读里检索,返回命中论文的日期、评分、导读与链接。回答「最近有哪些关于 X 的论文」「这周 RL 方向有什么新工作」这类跨天问题时用它,不要逐天 read_digest。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "检索关键词,空格分隔多个词时取交集(AND),中英均可,如「强化学习 RL」",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_articles",
      description:
        "一次读取 2-3 篇站内文章的正文用于对比。用户要求比较多篇文章(如「Seed 和 Frontis-MA1 的自进化思路有何异同」)时用,比多次 read_article 更省。",
      parameters: {
        type: "object",
        properties: {
          articles: {
            type: "array",
            description: "2-3 篇要对比的文章",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: [...ARTICLE_TYPES] },
                slug: { type: "string" },
              },
              required: ["type", "slug"],
            },
            minItems: 2,
            maxItems: 3,
          },
        },
        required: ["articles"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_paper",
      description:
        "读取 arXiv 论文全文的一段(纯文本)。默认从头返回 1.6 万字符;用 offset+limit 分页读后续段落。长论文推荐先用 search_in_paper 定位关键词位置,再按 offset 精读那一段。全文在浏览器端缓存,多次调用不重复下载。",
      parameters: {
        type: "object",
        properties: {
          arxiv_id: {
            type: "string",
            description: "arXiv id,形如 2607.28568(不带 abs/ 前缀)",
          },
          offset: {
            type: "number",
            description: "起始字符偏移,默认 0;接 search_in_paper 返回的 offset 或上一段的末尾",
          },
          limit: {
            type: "number",
            description: "本段长度,默认 16000,上限 16000",
          },
        },
        required: ["arxiv_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_in_paper",
      description:
        "在 arXiv 论文全文里检索关键词,返回命中处的上下文片段与字符偏移。读长论文的特定内容(某个公式、算法步骤、实验表格、消融)时先调它定位,再用 read_paper 带 offset 精读。",
      parameters: {
        type: "object",
        properties: {
          arxiv_id: { type: "string", description: "arXiv id,形如 2607.28568" },
          query: {
            type: "string",
            description: "定位关键词,空格分隔(英文术语命中率更高),如「KL divergence」「ablation」",
          },
        },
        required: ["arxiv_id", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_external_papers",
      description:
        "检索外部论文库(Semantic Scholar,覆盖全部 arXiv 与经典文献,带引用数与 TLDR)。站内速递只覆盖近期,问经典工作、源头论文、横向相关工作时用它;命中结果含 arXiv id,可用 read_paper / search_in_paper 继续深读。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "英文检索词,如「on-policy distillation language model」",
          },
        },
        required: ["query"],
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
  | "search_papers"
  | "compare_articles"
  | "read_paper"
  | "search_in_paper"
  | "search_external_papers"
  | "navigate";

/** 一次工具调用的记录,UI 用来渲染「正在查资料」与跳转卡片;detail 是给人看的过程描述 */
export interface ToolCallRecord {
  name: AgentToolName;
  args: Record<string, unknown>;
  /** 执行结果摘要,如「命中 8 篇」「《文章标题》」;执行失败或未执行时为空 */
  detail?: string;
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

/** all.json 里的跨天论文索引条目(scripts/generate-papers-api.mjs 产出) */
export interface IndexedPaper {
  date: string;
  source: "hf" | "arxiv";
  id: string;
  title: string;
  titleZh?: string;
  summary?: string;
  score?: number;
  deepDive?: boolean;
  upvotes?: number;
  url?: string;
}

/** 索引只在工具被调用时拉取,模块级缓存;失败时清缓存以便下次重试(富引用卡片也复用) */
let papersIndexPromise: Promise<IndexedPaper[]> | null = null;
export function loadPapersIndex(): Promise<IndexedPaper[]> {
  if (!papersIndexPromise) {
    papersIndexPromise = fetch(`${basePath}/api/papers/all.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`papers index ${res.status}`);
        return res.json();
      })
      .then((data) => (data.papers ?? []) as IndexedPaper[]);
    papersIndexPromise.catch(() => {
      papersIndexPromise = null;
    });
  }
  return papersIndexPromise;
}

async function searchPapers(query: string): Promise<string> {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!tokens.length) return JSON.stringify({ error: "empty query" });
  const papers = await loadPapersIndex();
  const hits = papers
    .map((p) => {
      const haystack = `${p.title} ${p.titleZh ?? ""} ${p.summary ?? ""}`.toLowerCase();
      // AND 语义:每个词都要命中;命中次数用于排序
      let count = 0;
      for (const token of tokens) {
        const n = haystack.split(token).length - 1;
        if (!n) return null;
        count += n;
      }
      return { p, rank: count + (p.score ?? 0) * 2 + (p.upvotes ?? 0) / 200 };
    })
    .filter((h): h is { p: IndexedPaper; rank: number } => h !== null)
    .sort((a, b) => b.rank - a.rank || b.p.date.localeCompare(a.p.date))
    .slice(0, 12)
    .map(({ p }) => ({
      date: p.date,
      source: p.source,
      title: p.title,
      titleZh: p.titleZh,
      summary: truncate(p.summary ?? "", 160),
      score: p.score,
      deepDive: p.deepDive === true,
      upvotes: p.upvotes,
      url: p.url,
      page: `/papers/${p.date}/`,
    }));
  return JSON.stringify({ query, total: hits.length, results: hits });
}

async function compareArticles(
  articles: { type: string; slug: string }[],
  locale: string,
): Promise<string> {
  const list = articles
    .filter((a) => ARTICLE_TYPES.includes(a.type as (typeof ARTICLE_TYPES)[number]) && a.slug)
    .slice(0, 3);
  if (list.length < 2) return JSON.stringify({ error: "need 2-3 valid articles" });
  const docs = await Promise.all(
    list.map(async ({ type, slug }) => {
      const res = await fetch(
        `${basePath}/api/agent/articles/${locale}/${type}--${slug}.json`,
      );
      if (!res.ok) return { slug, error: "not found" };
      const article = await res.json();
      return {
        title: article.title,
        path: article.path,
        text: truncate(String(article.text ?? ""), 6000),
      };
    }),
  );
  return JSON.stringify({ articles: docs });
}

/** 喂给模型的单段全文字符上限:覆盖方法/实验主体,又不至于撑爆上下文 */
const PAPER_TEXT_TOOL_LIMIT = 16_000;

/** 全文按 arXiv id 缓存(同一篇多次分段读/检索只拉一次);失败清缓存可重试 */
const paperTextCache = new Map<string, Promise<{ text: string; source: string }>>();

function fetchPaperTextCached(
  arxivId: string,
  apiUrl: string,
): Promise<{ text: string; source: string }> {
  let cached = paperTextCache.get(arxivId);
  if (!cached) {
    cached = (async () => {
      const res = await fetch(`${apiUrl}/paper?arxiv=${encodeURIComponent(arxivId)}`);
      if (!res.ok) throw new Error("full text not available");
      const data = await res.json();
      return { text: String(data.text ?? ""), source: String(data.source ?? "") };
    })();
    cached.catch(() => {
      paperTextCache.delete(arxivId);
    });
    paperTextCache.set(arxivId, cached);
  }
  return cached;
}

async function readPaper(
  arxivId: string,
  apiUrl: string,
  offset: number,
  limit: number,
): Promise<string> {
  if (!apiUrl) return JSON.stringify({ error: "paper proxy not configured" });
  let paper: { text: string; source: string };
  try {
    paper = await fetchPaperTextCached(arxivId, apiUrl);
  } catch (error) {
    return JSON.stringify({ error: String(error) });
  }
  const start = Math.max(0, Math.floor(offset));
  const size = Math.min(Math.max(1000, Math.floor(limit || PAPER_TEXT_TOOL_LIMIT)), PAPER_TEXT_TOOL_LIMIT);
  return JSON.stringify({
    arxiv: arxivId,
    source: paper.source,
    totalChars: paper.text.length,
    offset: start,
    returnedChars: Math.min(size, Math.max(0, paper.text.length - start)),
    text: paper.text.slice(start, start + size),
  });
}

/** 在全文里按关键词定位:返回命中片段(±220 字符)与偏移量,供 read_paper 按段精读 */
async function searchInPaper(
  arxivId: string,
  apiUrl: string,
  query: string,
): Promise<string> {
  if (!apiUrl) return JSON.stringify({ error: "paper proxy not configured" });
  let paper: { text: string; source: string };
  try {
    paper = await fetchPaperTextCached(arxivId, apiUrl);
  } catch (error) {
    return JSON.stringify({ error: String(error) });
  }
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  if (!tokens.length) return JSON.stringify({ error: "empty query" });
  const haystack = paper.text.toLowerCase();
  const hits: { offset: number; snippet: string }[] = [];
  for (const token of tokens) {
    let idx = haystack.indexOf(token);
    while (idx !== -1 && hits.length < 12) {
      hits.push({
        offset: idx,
        snippet: paper.text.slice(Math.max(0, idx - 220), idx + 220).replace(/\s+/g, " ").trim(),
      });
      idx = haystack.indexOf(token, idx + token.length);
    }
  }
  hits.sort((a, b) => a.offset - b.offset);
  return JSON.stringify({
    arxiv: arxivId,
    query,
    totalChars: paper.text.length,
    hits: hits.slice(0, 8),
    hint: hits.length
      ? "用 read_paper 带上感兴趣片段的 offset 继续精读该段"
      : "未命中,换个关键词(英文术语命中率更高)",
  });
}

/** 外部论文检索(Semantic Scholar,经 Worker 代理):站内速递之外的经典/相关工作 */
async function searchExternalPapers(query: string, apiUrl: string): Promise<string> {
  if (!apiUrl) return JSON.stringify({ error: "paper proxy not configured" });
  const res = await fetch(
    `${apiUrl}/search-papers?query=${encodeURIComponent(query)}&limit=8`,
  );
  if (!res.ok) return JSON.stringify({ error: `external search failed: ${res.status}` });
  const data = await res.json();
  return JSON.stringify(data);
}

/** 工具执行产出:result 喂给模型,detail 给 UI 展示「查了什么、命中多少」 */
export interface ToolExecution {
  result: string;
  detail?: string;
}

/** 从工具结果 JSON 里提取 UI 摘要;解析失败就只要 args 侧信息 */
function detailOf(name: string, args: Record<string, unknown>, result: string, locale: string): string | undefined {
  const zh = locale === "zh";
  try {
    const data = JSON.parse(result);
    if (data?.error) return zh ? "未找到" : "not found";
    switch (name) {
      case "get_site_map":
        return zh ? "站点地图" : "site map";
      case "search_site": {
        const n = data.results?.length ?? 0;
        return zh ? `「${args.query}」· 命中 ${n} 篇` : `"${args.query}" · ${n} hit(s)`;
      }
      case "read_article":
        return data.title ? `《${data.title}》` : undefined;
      case "list_digests":
        return zh ? `最新一期 ${data.latest}` : `latest: ${data.latest}`;
      case "read_digest": {
        const n = (data.hf?.length ?? 0) + (data.arxiv?.length ?? 0);
        return zh ? `${data.date} · ${n} 篇` : `${data.date} · ${n} paper(s)`;
      }
      case "search_papers": {
        const n = data.total ?? 0;
        return zh ? `「${args.query}」· 命中 ${n} 篇` : `"${args.query}" · ${n} hit(s)`;
      }
      case "compare_articles": {
        const titles = (data.articles ?? [])
          .map((a: { title?: string }) => a.title)
          .filter(Boolean);
        return titles.length ? titles.map((ti: string) => `《${ti}》`).join(" × ") : undefined;
      }
      case "read_paper": {
        const total = typeof data.totalChars === "number" ? data.totalChars : 0;
        const offset = typeof data.offset === "number" ? data.offset : 0;
        return zh
          ? `${args.arxiv_id} · 全文 ${total} 字 · 段@${offset}`
          : `${args.arxiv_id} · ${total} chars · chunk@${offset}`;
      }
      case "search_in_paper": {
        const n = data.hits?.length ?? 0;
        return zh
          ? `${args.arxiv_id} 内「${args.query}」· ${n} 处`
          : `${args.arxiv_id} "${args.query}" · ${n} spot(s)`;
      }
      case "search_external_papers": {
        const n = data.results?.length ?? 0;
        return zh ? `外部检索「${args.query}」· ${n} 篇` : `S2 "${args.query}" · ${n} paper(s)`;
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/** 执行工具,返回给模型的 tool message 内容(JSON 字符串)与 UI 摘要 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  locale: string,
  apiUrl = "",
): Promise<ToolExecution> {
  let result: string;
  try {
    switch (name) {
      case "get_site_map":
        result = await getSiteMap(locale);
        break;
      case "search_site":
        result = await searchSite(String(args.query ?? ""), locale);
        break;
      case "read_article":
        result = await readArticle(String(args.type ?? ""), String(args.slug ?? ""), locale);
        break;
      case "list_digests":
        result = await listDigests();
        break;
      case "read_digest":
        result = await readDigest(
          String(args.date ?? ""),
          args.source ? String(args.source) : undefined,
        );
        break;
      case "search_papers":
        result = await searchPapers(String(args.query ?? ""));
        break;
      case "compare_articles":
        result = await compareArticles(
          Array.isArray(args.articles) ? (args.articles as { type: string; slug: string }[]) : [],
          locale,
        );
        break;
      case "read_paper":
        result = await readPaper(
          String(args.arxiv_id ?? ""),
          apiUrl,
          Number(args.offset) || 0,
          Number(args.limit) || 0,
        );
        break;
      case "search_in_paper":
        result = await searchInPaper(
          String(args.arxiv_id ?? ""),
          apiUrl,
          String(args.query ?? ""),
        );
        break;
      case "search_external_papers":
        result = await searchExternalPapers(String(args.query ?? ""), apiUrl);
        break;
      case "navigate": {
        const path = String(args.path ?? "");
        result = path.startsWith("/")
          ? JSON.stringify({ presented: true, path, label: String(args.label ?? path) })
          : JSON.stringify({ error: "invalid path" });
        break;
      }
      default:
        result = JSON.stringify({ error: `unknown tool: ${name}` });
    }
  } catch (error) {
    result = JSON.stringify({ error: String(error) });
  }
  return { result, detail: detailOf(name, args, result, locale) };
}
