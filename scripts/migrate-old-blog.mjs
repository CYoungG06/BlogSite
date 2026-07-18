#!/usr/bin/env node
/**
 * 一次性:旧 Hexo 站文章迁移(search.xml → MDX)。
 *
 * 用法:
 *   node scripts/migrate-old-blog.mjs [旧站目录]
 *   默认 /Users/guchenyang/Downloads/CYoungG06.github.io-main
 *
 * 做的事:
 *   1. 解析 search.xml 的 <entry>(title / link / CDATA HTML 正文)
 *   2. 从每篇文章自己的 index.html 抓 /tags/ 链接作为标签
 *   3. HTML → Markdown:
 *      - 去掉 headerlink 锚点和首个 h1(与 frontmatter 标题重复)
 *      - <figure class="highlight lang"> → 围栏代码块(去 gutter,解码实体)
 *      - $...$ / $$...$$ 原始 LaTeX 提取占位(旧站没渲染公式),
 *        还原时 \\ → \(Hexo 把反斜杠转义成了双写)
 *      - 其余走 turndown + gfm(表格/删除线)
 *   4. 写 content/blog/zh/{slug}.md,frontmatter 带 title/date/description/tags
 *   5. 引用的 /images/* 复制到 public/images/
 *
 * 产出后跑一遍 npm run build 验证。
 */

import fs from "node:fs";
import path from "node:path";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { stripMarkdown } from "../lib/markdown.ts";

const OLD_SITE =
  process.argv[2] ?? "/Users/guchenyang/Downloads/CYoungG06.github.io-main";
const OUT_DIR = path.resolve("content/blog/zh");
const IMG_OUT = path.resolve("public/images");

/** title → 新 slug(干净 URL;fallback 用旧 URL 段 slugify) */
const SLUGS = new Map([
  ["emnlp2024论文研读-参数高效稀疏化", "emnlp2024-pesc"],
  ["学习 Transformer 的初始化、参数化与标准化", "transformer-init-param-norm"],
  ["LoRA 及其论文研读", "lora"],
  ["MoE 论文研读", "moe"],
  [
    "Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer 论文研读",
    "sparsely-gated-moe",
  ],
  [
    "Adaptive Mixtures of Local Experts 论文研读",
    "adaptive-mixtures-of-local-experts",
  ],
  ["RoPE", "rope"],
  ["RMSNorm", "rmsnorm"],
  ["Understanding from seq2seq to attention", "attention-pt1-seq2seq-to-attention"],
  [
    "Understanding from attention to self-attention",
    "attention-pt2-self-attention",
  ],
  ["KV cache", "kv-cache"],
  ["COSTAR", "costar"],
  ["Learning Prompt", "learning-prompt"],
  ["Yorushika", "yorushika"],
  ["Language Model Overview", "language-model-overview"],
]);

const ENCODED_ENTITIES = [
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&nbsp;/g, " "],
  [/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))],
  [/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))],
  [/&amp;/g, "&"], // 必须最后
];

function decodeEntities(text) {
  let out = text;
  for (const [re, ch] of ENCODED_ENTITIES) out = out.replace(re, ch);
  return out;
}

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

/** 解析 search.xml → [{ title, link, html }] */
function parseSearchXml(xmlPath) {
  const xml = fs.readFileSync(xmlPath, "utf8");
  const entries = [];
  const re =
    /<entry>\s*<title>([\s\S]*?)<\/title>\s*<link href="([^"]+)"\/>[\s\S]*?<content type="html"><!\[CDATA\[([\s\S]*?)\]\]><\/content>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    entries.push({ title: m[1].trim(), link: m[2], html: m[3] });
  }
  return entries;
}

/** 从文章页 index.html 抓标签 */
function tagsFromPostPage(oldDir, link) {
  const rel = decodeURIComponent(link).replace(/^\//, "");
  const file = path.join(oldDir, rel, "index.html");
  if (!fs.existsSync(file)) return [];
  const html = fs.readFileSync(file, "utf8");
  const tags = new Set();
  for (const m of html.matchAll(/href="\/tags\/([^/"]+)\/"/g)) {
    tags.add(decodeURIComponent(m[1]));
  }
  return [...tags];
}

/** figure.highlight → 围栏代码块占位;返回处理后的 html 与代码块列表 */
function extractCodeFigures(html) {
  const blocks = [];
  const out = html.replace(
    /<figure class="highlight(?:\s+([a-zA-Z0-9#+_-]+))?"[^>]*>([\s\S]*?)<\/figure>/g,
    (_, lang, inner) => {
      const preMatch = inner.match(
        /<td class="code"><pre>([\s\S]*?)<\/pre><\/td>/,
      );
      if (!preMatch) return "";
      // Hexo 行结构是 <span class="line">…</span><br>,先把 <br> 换成换行再剥标签
      const code = decodeEntities(
        preMatch[1]
          .replace(/<br\s*\/?>/g, "\n")
          .replace(/<[^>]+>/g, ""),
      );
      blocks.push({ lang: lang ?? "", code });
      return `<p>MIGRATECODE${blocks.length - 1}MIGRATE</p>`;
    },
  );
  return { html: out, blocks };
}

/**
 * <script type="math/tex; mode=display"> → $$ 块级公式占位。
 * script 体内是正常 LaTeX(单反斜杠,\\ 是换行),原样保留,不做清理。
 */
function extractDisplayMath(html) {
  const spans = [];
  const out = html.replace(
    /<script type="math\/tex; mode=display">([\s\S]*?)<\/script>/g,
    (_, body) => {
      spans.push(`$$\n${decodeEntities(body.trim())}\n$$`);
      return `<p>MIGRATEDM${spans.length - 1}MIGRATE</p>`;
    },
  );
  return { html: out, spans };
}

/** 行内 $...$:正文里的公式是转义过的双反斜杠(\\Delta),清理 \\ → \;
 *  旧渲染器把公式内 _{...} 当成强调生成了 <em>,还原为 _;实体(&lt; 等)解码 */
function extractMath(html) {
  const spans = [];
  const stash = (body) => {
    const cleaned = decodeEntities(
      body.replace(/\\\\/g, "\\").replace(/<\/?em>/g, "_"),
    ).trim();
    spans.push(`$${cleaned}$`);
    return `MIGRATEMATH${spans.length - 1}MIGRATE`;
  };
  const out = html.replace(/\$([^$\n]+?)\$/g, (_, body) => stash(body));
  return { html: out, spans };
}

function restoreMath(md, displaySpans, inlineSpans) {
  // 占位符独占一行但可能带列表缩进:整个 $$ 块按该行缩进重排,
  // 否则围栏与正文缩进不一致,micromark 解析失败,公式正文撞上 MDX 的 JSX 表达式
  let out = md.replace(
    /^([ \t]*(?:>[ \t]*)?)MIGRATEDM(\d+)MIGRATE[ \t]*$/gm,
    (_, ws, i) => {
      const span = displaySpans[Number(i)];
      if (span === undefined) throw new Error(`display math 占位越界:${i}`);
      return span
        .split("\n")
        .map((line) => ws + line)
        .join("\n");
    },
  );
  // 兜底:非行首占位(如引用块内)直接替换
  out = out.replace(/MIGRATEDM(\d+)MIGRATE/g, (_, i) => {
    const span = displaySpans[Number(i)];
    if (span === undefined) throw new Error(`display math 占位越界:${i}`);
    return span;
  });
  out = out.replace(/MIGRATEMATH(\d+)MIGRATE/g, (_, i) => {
    const span = inlineSpans[Number(i)];
    if (span === undefined) throw new Error(`inline math 占位越界:${i}`);
    return span;
  });
  return out;
}

function makeTurndown() {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
  });
  td.use(gfm);
  return td;
}

function htmlToMarkdown(html) {
  // 1. 去 headerlink 锚点
  let out = html.replace(/<a[^>]*class="headerlink"[^>]*><\/a>/g, "");
  // 2. 去首个 h1(与 frontmatter 标题重复)
  out = out.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/, "");
  // 3. 代码块先占位(防止 math 匹配进代码)
  const { html: noCode, blocks } = extractCodeFigures(out);
  // 4. 块级公式(script 标签)再占位
  const { html: noDisplay, spans: displaySpans } = extractDisplayMath(noCode);
  // 5. 行内公式占位
  const { html: noMath, spans: inlineSpans } = extractMath(noDisplay);
  // 6. turndown
  let md = makeTurndown().turndown(noMath);
  // 7. 还原代码块与公式(占位符独占一行但可能带列表缩进或引用块前缀,
  // 整块按该前缀重排,否则 micromark 解析失败/公式正文撞上 MDX 的 JSX 表达式)
  md = md.replace(
    /^([ \t]*(?:>[ \t]*)?)MIGRATECODE(\d+)MIGRATE[ \t]*$/gm,
    (_, ws, i) => {
      const { lang, code } = blocks[Number(i)];
      const fenced = `\`\`\`${lang}\n${code.replace(/\n+$/, "")}\n\`\`\``;
      return fenced
        .split("\n")
        .map((line) => ws + line)
        .join("\n");
    },
  );
  // 兜底:不在行首的占位(理论上没有)直接替换
  md = md.replace(
    /MIGRATECODE(\d+)MIGRATE/g,
    (_, i) => {
      const { lang, code } = blocks[Number(i)];
      return `\`\`\`${lang}\n${code.replace(/\n+$/, "")}\n\`\`\``;
    },
  );
  md = restoreMath(md, displaySpans, inlineSpans);
  // 8. 收敛空行
  return md.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function collectImages(md) {
  const srcs = new Set();
  for (const m of md.matchAll(/!\[[^\]]*\]\((\/images\/[^)\s]+)\)/g)) {
    srcs.add(m[1]);
  }
  return [...srcs];
}

/** description:跳过链接堆/引用/列表等开头,取第一段 ≥30 字实质文本 */
function pickDescription(md, max = 120) {
  const linkOnly = /^\s*(\[[^\]]*\]\([^)]*\)\s*)+$/;
  const labelPlusLinks = /^[^。！？!?]{0,40}[:：]\s*(\[[^\]]*\]\([^)]*\)\s*)+$/;
  for (const para of md.split(/\n{2,}/)) {
    if (/^\s*(#|>|-|\d+\.|\||```|\$\$)/.test(para)) continue;
    if (linkOnly.test(para) || labelPlusLinks.test(para)) continue;
    const text = stripMarkdown(para)
      .replace(/https?:\/\/\S+/g, "")
      .trim();
    if (text.length >= 30) {
      return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
    }
  }
  return "";
}

/** 旧站站内互链(gcy-shili.github.io/yyyy/mm/dd/slug/)改写成新站 /zh/blog/{slug}/ */
function rewriteInternalLinks(md, urlToSlug) {
  return md.replace(
    /\[([^\]]*)\]\((?:https?:\/\/gcy-shili\.github\.io)?(\/20\d\d\/\d\d\/\d\d\/[^)\s]+?)\/?\)/g,
    (match, text, p) => {
      const key = p.replace(/\/$/, "");
      const slug =
        urlToSlug.get(key) ?? urlToSlug.get(decodeURIComponent(key));
      if (!slug) return match;
      const clean = text.split("|")[0].trim() || text;
      return `[${clean}](/zh/blog/${slug}/)`;
    },
  );
}

function main() {
  const xmlPath = path.join(OLD_SITE, "search.xml");
  if (!fs.existsSync(xmlPath)) {
    console.error(`找不到 ${xmlPath}`);
    process.exit(1);
  }
  const entries = parseSearchXml(xmlPath);
  console.log(`search.xml 共 ${entries.length} 篇`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(IMG_OUT, { recursive: true });

  // 第一遍:解析 slug / 日期,建旧 URL → 新 slug 映射(站内互链改写用)
  const resolved = [];
  const urlToSlug = new Map();
  for (const entry of entries) {
    const dateMatch = entry.link.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\//);
    if (!dateMatch) {
      console.error(`跳过:${entry.title}(URL 无日期:${entry.link})`);
      continue;
    }
    const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    const slug =
      SLUGS.get(entry.title) ??
      slugify(decodeURIComponent(entry.link).split("/").filter(Boolean).pop());
    resolved.push({ entry, date, slug });
    const key = entry.link.replace(/\/$/, "");
    urlToSlug.set(key, slug);
    urlToSlug.set(decodeURIComponent(key), slug);
  }

  // 第二遍:转换 + 写文件
  const copiedImgs = new Set();
  let done = 0;
  for (const { entry, date, slug } of resolved) {
    const tags = tagsFromPostPage(OLD_SITE, entry.link);
    const md = rewriteInternalLinks(htmlToMarkdown(entry.html), urlToSlug);
    const description = pickDescription(md);

    const frontmatter = [
      "---",
      `title: ${JSON.stringify(entry.title)}`,
      `date: ${JSON.stringify(date)}`,
      `description: ${JSON.stringify(description)}`,
      ...(tags.length ? [`tags: [${tags.map((t) => JSON.stringify(t)).join(", ")}]`] : []),
      "---",
      "",
    ].join("\n");

    fs.writeFileSync(path.join(OUT_DIR, `${slug}.md`), frontmatter + md);
    for (const src of collectImages(md)) copiedImgs.add(src);
    console.log(`✓ ${slug}  (${date}, tags: ${tags.join(",") || "-"})`);
    done++;
  }

  // 复制图片
  let imgCount = 0;
  const missing = [];
  for (const src of copiedImgs) {
    const from = path.join(OLD_SITE, src);
    const to = path.join(IMG_OUT, path.basename(src));
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, to);
      imgCount++;
    } else {
      missing.push(src);
    }
  }
  console.log(`\n迁移 ${done} 篇,复制图片 ${imgCount} 张`);
  if (missing.length) {
    console.warn(`缺失图片:${missing.join(", ")}`);
  }
}

main();
