/**
 * 生成论文速递 RSS 2.0 feed。
 * 读 content/papers/*.json,取最近 14 期、每期仅 AI 判定相关的论文,
 * 写 public/feed.xml(构建期生成,已 gitignore)。每期一条 entry,
 * 内容为中文导读列表 HTML,可直接在阅读器里读完。
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const papersDir = path.join(root, "content", "papers");
const outFile = path.join(root, "public", "feed.xml");

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const SITE = (process.env.SITE_URL ?? "https://cyoungg06.github.io") + BASE_PATH;
const MAX_ISSUES = 14;
const FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const cdata = (s) => `<![CDATA[${String(s).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
const relevant = (p) => p.relevant !== false;

function digestHtml(digest) {
  const parts = [];
  const section = (label, papers) => {
    if (papers.length === 0) return;
    parts.push(`<h3>${label}</h3><ul>`);
    for (const p of papers) {
      const meta = [p.upvotes ? `▲${p.upvotes}` : null, p.primaryCategory]
        .filter(Boolean)
        .join(" · ");
      parts.push(
        `<li><p><a href="${p.urls.abs}">${esc(p.titleZh || p.title)}</a>` +
          (meta ? ` <small>${esc(meta)}</small>` : "") +
          (p.summaryZh ? `<br/>${esc(p.summaryZh)}` : "") +
          `</p></li>`,
      );
    }
    parts.push(`</ul>`);
  };
  section("Hugging Face 热门", digest.hf.filter(relevant));
  section("arXiv 新论文", digest.arxiv.filter(relevant));
  return parts.join("");
}

async function main() {
  const dates = existsSync(papersDir)
    ? (await readdir(papersDir))
        .filter((f) => FILE_RE.test(f))
        .map((f) => f.replace(/\.json$/, ""))
        .sort()
        .reverse()
        .slice(0, MAX_ISSUES)
    : [];

  const items = [];
  for (const date of dates) {
    const digest = JSON.parse(
      await readFile(path.join(papersDir, `${date}.json`), "utf8"),
    );
    const url = `${SITE}/zh/papers/${date}/`;
    const pubDate = new Date(
      digest.generatedAt ?? `${date}T02:00:00Z`,
    ).toUTCString();
    items.push(`    <item>
      <title>论文速递 ${date}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${cdata(digestHtml(digest))}</description>
    </item>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>论文速递 · 相对性阿卡内</title>
    <link>${SITE}/zh/papers/</link>
    <description>每日 arXiv 新论文与 Hugging Face 热门论文,AI 中文导读,按兴趣过滤。</description>
    <language>zh-cn</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.join("\n")}
  </channel>
</rss>
`;

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, xml);
  console.log(`[feed] wrote public/feed.xml with ${items.length} issue(s)`);
}

await main();
