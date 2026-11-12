/**
 * blogsite-agent-proxy —— 博客 AI 助手的 DeepSeek 代理 + 全站访客统计。
 * 代理职责:藏 API key、CORS 白名单、按 IP 限流,以及费用兜底 ——
 * system prompt 与 tools 由服务端注入(客户端传不进来)、消息结构严格校验、
 * 单次请求字符上限、全站每日预算(D1 计数)。
 * Origin 头在浏览器之外可以随意伪造,所以它只是 CORS 手段,不当鉴权用;
 * 真正限制滥用成本的是上面这几道。
 * 统计职责:/pv 打点(D1 计数)、/stats 查询。
 * 工具数据都是站内公开静态 JSON,由浏览器直接 fetch。
 */
import { buildSuggestPrompt, buildSystemPrompt } from "../../../lib/agent/system.ts";
import { AGENT_TOOLS } from "../../../lib/agent/tool-schemas.ts";

const ALLOWED_ORIGINS = new Set([
  "https://cyoungg06.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const UPSTREAM_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash";
const MAX_MESSAGES = 64; // 深度调研 16 轮工具交换 + 历史,预留余量
const MAX_MESSAGE_CHARS = 80_000; // read_paper 全文工具结果可到数万字符
const MAX_TOTAL_CHARS = 400_000; // 单次请求全部消息的字符总量上限
const MAX_BODY_CHARS = 600_000; // 请求体上限(JSON 转义与结构开销留余量)
const MAX_TOOL_CALLS = 16; // 单条 assistant 消息里的并行工具调用上限
// 与前端 lib/agent/chat.ts 的 NORMAL_LIMITS / DEEP_LIMITS / 建议请求保持一致
const MAX_TOKENS = { chat: 4096, deep: 8192, suggest: 512 };
const TOOL_NAMES = new Set(AGENT_TOOLS.map((t) => t.function.name));
// 当前页面路径会拼进 system prompt:只放行普通 URL 路径字符,防提示词注入
const PATH_RE = /^\/[A-Za-z0-9\-._~%/]{0,199}$/;

// 全站每日预算(UTC 日)默认值;可在 wrangler.toml [vars] 里覆盖。
// 计数存 D1 kv 表,键 budget:requests:<日期> / budget:chars:<日期>,也可当用量日志查。
const DEFAULT_DAILY_REQUESTS = 1500;
const DEFAULT_DAILY_INPUT_CHARS = 30_000_000;

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

// 访客统计:爬虫 UA 过滤(打点由站内 JS 触发,这只是兜底)
const BOT_UA_RE =
  /bot|crawler|spider|slurp|headless|phantom|curl|wget|python|axios|go-http/i;
const VID_RE = /^[0-9a-f-]{8,64}$/i;

/** PV 打点:POST /pv,body {vid, path}(text/plain 发送以免 CORS 预检);前端按会话去重 */
async function handlePv(request, env, origin) {
  const ua = request.headers.get("User-Agent") ?? "";
  if (BOT_UA_RE.test(ua)) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json", origin);
  }
  const vid = typeof body?.vid === "string" ? body.vid : "";
  const path = typeof body?.path === "string" ? body.path : "";
  if (!VID_RE.test(vid) || !path.startsWith("/") || path.length > 200) {
    return jsonError(400, "invalid payload", origin);
  }

  const now = Date.now();
  await env.STATS_DB.batch([
    env.STATS_DB.prepare(
      "INSERT INTO kv (key, value) VALUES ('total_pv', 1) ON CONFLICT(key) DO UPDATE SET value = value + 1",
    ),
    env.STATS_DB.prepare(
      `INSERT INTO visitors (vid, first_seen, last_seen, visits) VALUES (?, ?, ?, 1)
       ON CONFLICT(vid) DO UPDATE SET last_seen = excluded.last_seen, visits = visits + 1`,
    ).bind(vid, now, now),
  ]);
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

/** 全站统计:GET /stats → { pv, uv };响应可缓存 60s */
async function handleStats(env, origin) {
  const [pvResult, uvResult] = await env.STATS_DB.batch([
    env.STATS_DB.prepare("SELECT value FROM kv WHERE key = 'total_pv'"),
    env.STATS_DB.prepare("SELECT COUNT(*) AS n FROM visitors"),
  ]);
  const pv = pvResult.results[0]?.value ?? 0;
  const uv = uvResult.results[0]?.n ?? 0;
  return new Response(JSON.stringify({ pv, uv }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
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
    Vary: "Origin",
  };
}

function jsonError(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

/**
 * 旧版前端(本次改造前的缓存 JS)还会自己上传 system 消息、不带 kind 字段:
 * 从它的 system 文本里认出语言/模式,再换成服务端自己的提示词。
 * 旧缓存淘汰后可删除本函数。
 */
function legacyHints(payload) {
  const sys =
    payload.messages.find((m) => m?.role === "system" && typeof m.content === "string")
      ?.content ?? "";
  const suggest = /^(根据用户的提问和助手的回答|Given the user's question)/.test(sys);
  return {
    kind: suggest ? "suggest" : "chat",
    locale: /^(You are Acane|Given the user's question)/.test(sys) ? "en" : "zh",
    deep: sys.includes("【深度调研模式】") || sys.includes("[DEEP RESEARCH MODE]"),
    tools: Array.isArray(payload.tools),
  };
}

/** 校验并按白名单字段重建一条对话消息;非法返回 null。chars 累加进 counter.total */
function cleanMessage(m, counter) {
  if (!m || typeof m !== "object") return null;
  const text = (value) => {
    if (typeof value !== "string" || value.length > MAX_MESSAGE_CHARS) return null;
    counter.total += value.length;
    return value;
  };

  if (m.role === "user") {
    const content = text(m.content);
    return content === null ? null : { role: "user", content };
  }
  if (m.role === "tool") {
    const content = text(m.content);
    if (content === null || typeof m.tool_call_id !== "string" || m.tool_call_id.length > 128) {
      return null;
    }
    return { role: "tool", tool_call_id: m.tool_call_id, content };
  }
  if (m.role === "assistant") {
    const content = m.content == null ? null : text(m.content);
    if (m.content != null && content === null) return null;
    if (m.tool_calls == null) {
      return content === null ? null : { role: "assistant", content };
    }
    if (!Array.isArray(m.tool_calls) || m.tool_calls.length === 0 || m.tool_calls.length > MAX_TOOL_CALLS) {
      return null;
    }
    const toolCalls = [];
    for (const tc of m.tool_calls) {
      const name = tc?.function?.name;
      const args = text(tc?.function?.arguments);
      if (typeof tc?.id !== "string" || tc.id.length > 128 || !TOOL_NAMES.has(name) || args === null) {
        return null;
      }
      toolCalls.push({ id: tc.id, type: "function", function: { name, arguments: args } });
    }
    return { role: "assistant", content, tool_calls: toolCalls };
  }
  return null;
}

/**
 * 校验客户端请求并重建上游请求体。
 * 客户端能影响的只有:对话消息(user/assistant/tool,逐字段白名单)和几个提示字段
 * (kind/locale/currentPath/deep/tools 开关);system prompt、tools schema、model、
 * stream 全部由这里决定。返回 { body, chars } 或 null。
 */
function buildUpstream(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.messages)) return null;
  const hints = typeof payload.kind === "string" ? payload : legacyHints(payload);
  if (hints.kind !== "chat" && hints.kind !== "suggest") return null;
  const locale = hints.locale === "en" ? "en" : "zh";
  const deep = hints.deep === true;

  // 客户端传来的 system 消息一律丢弃(新版前端本就不传)
  const incoming = payload.messages.filter((m) => m?.role !== "system");
  if (incoming.length === 0 || incoming.length > MAX_MESSAGES) return null;
  const counter = { total: 0 };
  const messages = [];
  for (const m of incoming) {
    const clean = cleanMessage(m, counter);
    if (!clean) return null;
    messages.push(clean);
  }
  if (counter.total > MAX_TOTAL_CHARS) return null;

  let system;
  let tools;
  let cap;
  if (hints.kind === "suggest") {
    system = buildSuggestPrompt(locale);
    cap = MAX_TOKENS.suggest;
  } else {
    const path =
      typeof hints.currentPath === "string" && PATH_RE.test(hints.currentPath)
        ? hints.currentPath
        : undefined;
    system = buildSystemPrompt(locale, path, deep);
    tools = hints.tools === false ? undefined : AGENT_TOOLS;
    cap = deep ? MAX_TOKENS.deep : MAX_TOKENS.chat;
  }

  const requested = Number(payload.max_tokens);
  return {
    chars: counter.total + system.length,
    body: {
      model: MODEL,
      messages: [{ role: "system", content: system }, ...messages],
      tools,
      stream: true,
      max_tokens: requested > 0 ? Math.min(Math.floor(requested), cap) : Math.min(2048, cap),
    },
  };
}

/**
 * 全站每日预算:请求数与输入字符数各一个计数器,先原子自增再比较。
 * 任一超限即拒绝(当天不再转发上游,UTC 零点自动恢复)。
 * D1 异常时抛错由顶层兜成 502 —— 费用闸门宁可误拒,不能失效放行。
 */
async function consumeBudget(env, chars) {
  const limit = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const maxRequests = limit(env.DAILY_REQUEST_BUDGET, DEFAULT_DAILY_REQUESTS);
  const maxChars = limit(env.DAILY_INPUT_CHAR_BUDGET, DEFAULT_DAILY_INPUT_CHARS);
  const day = new Date().toISOString().slice(0, 10);
  const bump =
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value RETURNING value";
  const [requests, used] = await env.STATS_DB.batch([
    env.STATS_DB.prepare(bump).bind(`budget:requests:${day}`, 1),
    env.STATS_DB.prepare(bump).bind(`budget:chars:${day}`, chars),
  ]);
  return (
    requests.results[0].value <= maxRequests && used.results[0].value <= maxChars
  );
}

const proxy = {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    // 顶层兜底:任何未捕获异常(上游 DNS/TLS 失败等)都返回带 CORS 的 502,
    // 否则 CF 的默认 500 没有 CORS 头,浏览器只报 "Failed to fetch",无法排查
    try {
      return await handle(request, env, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const safeOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "";
      return jsonError(502, `proxy internal error: ${message}`, safeOrigin);
    }
  },
};

async function handle(request, env, origin) {
    const url = new URL(request.url);

    // 健康检查:GET /health,区分 worker 挂了还是上游挂了(不占限流额度)
    if (request.method === "GET" && url.pathname === "/health") {
      if (!ALLOWED_ORIGINS.has(origin)) {
        return new Response(JSON.stringify({ error: "forbidden origin" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

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
    // 访客统计:GET /stats 查询;POST /pv 打点
    if (request.method === "GET" && url.pathname === "/stats") {
      return handleStats(env, origin);
    }
    if (request.method === "POST" && url.pathname === "/pv") {
      return handlePv(request, env, origin);
    }

    if (request.method !== "POST") {
      return jsonError(405, "method not allowed", origin);
    }

    if (Number(request.headers.get("Content-Length")) > MAX_BODY_CHARS * 4) {
      return jsonError(413, "payload too large", origin);
    }
    let payload;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_CHARS) return jsonError(413, "payload too large", origin);
      payload = JSON.parse(raw);
    } catch {
      return jsonError(400, "invalid json", origin);
    }
    const upstreamRequest = buildUpstream(payload);
    if (!upstreamRequest) return jsonError(400, "invalid payload", origin);

    if (!(await consumeBudget(env, upstreamRequest.chars))) {
      return jsonError(429, "daily budget exhausted, try again tomorrow", origin);
    }

    const upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(upstreamRequest.body),
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
}

export default proxy;
