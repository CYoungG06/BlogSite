#!/usr/bin/env node
/**
 * 生成内容导出文件(public/export/):
 * - 文章/蒸馏/精读/深度解读:.md 源文件去 frontmatter,加 H1 标题
 * - 论文速递:content/papers/*.json 渲染为可读 Markdown 清单(仅相关论文)
 * 构建期运行(npm run export:files),产物随静态站点发布。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CONTENT = path.join(ROOT, "content");
const OUT = path.join(ROOT, "public", "export");

/** 导出的 .md 脱离站点使用,站内图片相对路径改写为绝对 URL(联网可加载) */
const SITE_ORIGIN = "https://cyoungg06.github.io/BlogSite";

function absolutizeImages(body) {
  return body
    .replace(/(\]\()\//g, `$1${SITE_ORIGIN}/`)
    .replace(/(src=["'])\//g, `$1${SITE_ORIGIN}/`);
}

/** frontmatter 分隔:--- ... ---(仅取 title/date,其余丢弃) */
function parseDoc(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { title: "", date: "", body: text };
  const fm = m[1];
  const title = fm.match(/^title:\s*"?([^"\n]+?)"?\s*$/m)?.[1] ?? "";
  const date = fm.match(/^date:\s*"?([^"\n]+?)"?\s*$/m)?.[1] ?? "";
  return { title, date, body: m[2].trim() };
}

function writeDoc(relPath, title, date, body) {
  const out = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const head = title ? `# ${title}\n\n` : "";
  const dateLine = date ? `> ${date}\n\n` : "";
  fs.writeFileSync(out, `${head}${dateLine}${absolutizeImages(body)}\n`, "utf-8");
  return 1;
}

/** 收集 {contentDir} 下 {locale} 的 .md,导出到 export/{locale}/{section}/ */
function exportSection(contentDir, section) {
  let n = 0;
  for (const locale of ["zh", "en"]) {
    const dir = path.join(CONTENT, contentDir, locale);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const slug = file.replace(/\.md$/, "");
      const { title, date, body } = parseDoc(fs.readFileSync(path.join(dir, file), "utf-8"));
      n += writeDoc(path.join(locale, section, `${slug}.md`), title, date, body);
    }
  }
  return n;
}

/** insights 只有中文一层目录 */
function exportInsights() {
  const dir = path.join(CONTENT, "insights");
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const slug = file.replace(/\.md$/, "");
    const { title, date, body } = parseDoc(fs.readFileSync(path.join(dir, file), "utf-8"));
    n += writeDoc(path.join("zh", "insights", `${slug}.md`), title, date, body);
  }
  return n;
}

function paperBlock(p) {
  const lines = [];
  lines.push(`### ${p.titleZh ?? p.title}`);
  if (p.titleZh) lines.push(`- ${p.title}`);
  const meta = [
    p.score != null ? `评分 ${p.score}` : null,
    p.upvotes ? `▲ ${p.upvotes}` : null,
    p.primaryCategory ?? null,
    p.deepDive ? "精读候选" : null,
  ].filter(Boolean);
  if (meta.length) lines.push(`- ${meta.join(" · ")}`);
  lines.push(`- ${p.urls.abs} ｜ ${p.urls.pdf}`);
  const summary = p.summaryZh ?? p.abstract ?? "";
  return `${lines.join("\n")}\n\n${summary}\n`;
}

function exportPapers() {
  const dir = path.join(CONTENT, "papers");
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
    const digest = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
    const relevant = (list) => (list ?? []).filter((p) => p.relevant !== false);
    const hf = relevant(digest.hf);
    const arxiv = relevant(digest.arxiv);
    const parts = [`# 论文速递 ${digest.date}`];
    if (hf.length) {
      parts.push(`## Hugging Face 热门(${hf.length} 篇)\n`);
      parts.push(hf.map(paperBlock).join("\n---\n\n"));
    }
    if (arxiv.length) {
      parts.push(`## arXiv 新论文(${arxiv.length} 篇)\n`);
      parts.push(arxiv.map(paperBlock).join("\n---\n\n"));
    }
    const out = path.join(OUT, "papers", file.replace(/\.json$/, ".md"));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${parts.join("\n\n")}\n`, "utf-8");
    n += 1;
  }
  return n;
}

fs.rmSync(OUT, { recursive: true, force: true });
const counts = {
  blog: exportSection("blog", "blog"),
  distilled: exportSection("distilled", "distilled"),
  reading: exportSection("reading", "reading"),
  insights: exportInsights(),
  papers: exportPapers(),
};
console.log(
  `[export] ${Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")}`,
);
