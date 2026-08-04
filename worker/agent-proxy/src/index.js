/**
 * blogsite-agent-proxy —— 博客 AI 助手的 DeepSeek 代理。
 * 职责只有三件事:藏 API key、CORS 白名单、按 IP 限流。
 * 不含业务逻辑;所有工具数据都是站内公开静态 JSON,由浏览器直接 fetch。
 */

const ALLOWED_ORIGINS = new Set([
  "https://cyoungg06.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const UPSTREAM_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash";
const MAX_MESSAGES = 40; // 深度调研:多轮工具交换 + 历史,预留余量
const MAX_MESSAGE_CHARS = 80_000; // read_paper 全文工具结果可到数万字符
const MAX_COMPLETION_TOKENS = 8192; // 深度模式的结构化长报告

// /paper 全文代理:主源 alphaXiv 全文 md,回退 arXiv HTML(HTMLRewriter 抽正文)
const ARXIV_ID_RE = /^\d{4}\.\d{4,5}(v\d+)?$/;
const PAPER_TEXT_LIMIT = 400_000; // 上游文本上限,防异常大文件
const PAPER_CACHE_TTL = 3600; // 边缘缓存 1h

/** arXiv HTML → 纯文本:HTMLRewriter 收集 text 节点,script/style 跳过 */
class TextExtractor {
  constructor() {
    this.chunks = [];
    this.skipDepth = 0;
  }
  element(el) {
    const tag = el.tagName;
    if (tag === "script" || tag === "style" || tag === "noscript") {
      this.skipDepth += 1;
      el.onEndTag(() => {
        this.skipDepth -= 1;
      });
    }
  }
  text(node) {
    if (this.skipDepth === 0) this.chunks.push(node.text);
  }
}

function htmlToText(html) {
  const extractor = new TextExtractor();
  return (async () => {
    // eslint-disable-next-line no-undef
    const rewriter = new HTMLRewriter().on("*", extractor);
    // transform 是流式的:必须消费掉 body,text 回调才会被执行
    await rewriter.transform(new Response(html)).text();
    return extractor.chunks
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  })();
}

/** 拉论文全文:alphaXiv md 优先,404 回退 arXiv HTML;返回 { text, source } 或 null */
async function fetchPaperText(arxivId) {
  const cf = { cacheTtl: PAPER_CACHE_TTL, cacheEverything: true };

  const alphaRes = await fetch(`https://alphaxiv.org/abs/${arxivId}.md`, {
    redirect: "follow",
    cf,
  });
  if (alphaRes.ok) {
    const text = (await alphaRes.text()).slice(0, PAPER_TEXT_LIMIT);
    if (text.length > 500) return { text, source: "alphaxiv" };
  }

  const htmlRes = await fetch(`https://arxiv.org/html/${arxivId}`, { cf });
  if (htmlRes.ok) {
    const html = (await htmlRes.text()).slice(0, PAPER_TEXT_LIMIT * 3);
    const text = (await htmlToText(html)).slice(0, PAPER_TEXT_LIMIT);
    if (text.length > 500) return { text, source: "arxiv-html" };
  }
  return null;
}

async function handlePaper(request, origin) {
  const url = new URL(request.url);
  const arxivId = url.searchParams.get("arxiv") ?? "";
  if (!ARXIV_ID_RE.test(arxivId)) {
    return jsonError(400, "invalid arxiv id", origin);
  }
  const paper = await fetchPaperText(arxivId);
  if (!paper) {
    return jsonError(404, "full text not available", origin);
  }
  return new Response(
    JSON.stringify({ arxiv: arxivId, source: paper.source, text: paper.text }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${PAPER_CACHE_TTL}`,
        ...corsHeaders(origin),
      },
    },
  );
}

/** arXiv API(Atom XML)正则抽条目:S2 限流时的兜底检索源 */
async function searchArxivApi(query, limit) {
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 6);
  const q = terms.map((t) => `all:${encodeURIComponent(t)}`).join("+AND+");
  const res = await fetch(
    `https://export.arxiv.org/api/query?search_query=${q}&start=0&max_results=${limit}&sortBy=relevance`,
    { cf: { cacheTtl: PAPER_CACHE_TTL, cacheEverything: true } },
  );
  if (!res.ok) return null;
  const xml = await res.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries.map((m) => {
    const entry = m[1];
    const pick = (tag) => {
      const hit = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return hit ? hit[1].trim() : "";
    };
    const arxivId = pick("id").replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
    return {
      arxivId: arxivId || undefined,
      title: pick("title").replace(/\s+/g, " "),
      year: pick("published").slice(0, 4) || undefined,
      abstract: pick("summary").replace(/\s+/g, " ").slice(0, 400),
      authors: [...entry.matchAll(/<name>([^<]+)<\/name>/g)].slice(0, 3).map((a) => a[1]),
      url: arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined,
    };
  }).filter((r) => r.arxivId);
}

/** 外部论文检索:Semantic Scholar 主源(JSON 带引用数/TLDR),429 等失败回退 arXiv API */
async function handleSearchPapers(request, origin) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("query") ?? "").trim().slice(0, 200);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 8, 1), 10);
  if (!query) return jsonError(400, "empty query", origin);

  const s2Url =
    "https://api.semanticscholar.org/graph/v1/paper/search" +
    `?query=${encodeURIComponent(query)}&limit=${limit}` +
    "&fields=title,abstract,year,citationCount,externalIds,tldr,authors";
  const res = await fetch(s2Url, {
    cf: { cacheTtl: PAPER_CACHE_TTL, cacheEverything: true },
    headers: { "User-Agent": "blogsite-agent-proxy/1.0" },
  });

  let payload;
  if (res.ok) {
    const data = await res.json();
    payload = {
      query,
      source: "semanticscholar",
      total: data.total ?? 0,
      results: (data.data ?? []).map((p) => ({
        arxivId: p.externalIds?.ArXiv ?? undefined,
        title: p.title,
        year: p.year,
        citations: p.citationCount,
        tldr: p.tldr?.text ?? undefined,
        abstract: typeof p.abstract === "string" ? p.abstract.slice(0, 400) : undefined,
        authors: (p.authors ?? []).slice(0, 3).map((a) => a.name),
        url: p.externalIds?.ArXiv ? `https://arxiv.org/abs/${p.externalIds.ArXiv}` : undefined,
      })),
    };
  } else {
    // S2 公共池经常 429:回退 arXiv API(无引用数/TLDR,但稳定)
    const results = await searchArxivApi(query, limit);
    if (!results) return jsonError(res.status === 429 ? 429 : 502, "upstream search failed", origin);
    payload = { query, source: "arxiv", total: results.length, results };
  }

  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${PAPER_CACHE_TTL}`,
      ...corsHeaders(origin),
    },
  });
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonError(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

/** 只保留白名单字段重建上游请求体,model/stream 强制覆盖 */
function sanitize(payload) {
  if (!payload || !Array.isArray(payload.messages)) return null;
  const messages = payload.messages;
  if (messages.length === 0 || messages.length > MAX_MESSAGES) return null;
  for (const m of messages) {
    if (!m || !["system", "user", "assistant", "tool"].includes(m.role)) return null;
    if (typeof m.content === "string" && m.content.length > MAX_MESSAGE_CHARS) return null;
  }
  return {
    model: MODEL,
    messages,
    tools: Array.isArray(payload.tools) ? payload.tools : undefined,
    stream: true,
    max_tokens: Math.min(Number(payload.max_tokens) || 2048, MAX_COMPLETION_TOKENS),
  };
}

const proxy = {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (!ALLOWED_ORIGINS.has(origin)) {
      return new Response(JSON.stringify({ error: "forbidden origin" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ip = request.headers.get("CF-Connecting-IP") ?? "anonymous";
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) return jsonError(429, "rate limited, slow down a bit", origin);

    // 论文全文代理:GET /paper?arxiv=2607.28568
    if (request.method === "GET" && url.pathname === "/paper") {
      return handlePaper(request, origin);
    }
    // 外部论文检索:GET /search-papers?query=...&limit=8
    if (request.method === "GET" && url.pathname === "/search-papers") {
      return handleSearchPapers(request, origin);
    }

    if (request.method !== "POST") {
      return jsonError(405, "method not allowed", origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonError(400, "invalid json", origin);
    }
    const safe = sanitize(payload);
    if (!safe) return jsonError(400, "invalid payload", origin);

    const upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(safe),
    });

    // SSE 流原样透传(错误响应也是,状态码保留,前端按 !res.ok 处理)
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "text/event-stream",
        "Cache-Control": "no-cache",
        ...corsHeaders(origin),
      },
    });
  },
};

export default proxy;
