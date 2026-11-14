/**
 * 生成论文速递静态 JSON API。
 * content/papers/*.json 原样复制到 public/api/papers/,
 * 另写 index.json(归档索引 + 最新指针 + feed 地址)。
 * 构建期生成,public/api/ 已 gitignore。字段只增不删,保证消费方兼容。
 *
 * titles/<YYYY-MM>.json:速递归档页论文搜索用的按月分片标题索引
 * (只收相关论文,字段名压缩;页面从最近的月份往前按需加载,见 components/papers/PaperSearch.tsx)。
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const papersDir = path.join(root, "content", "papers");
const outDir = path.join(root, "public", "api", "papers");

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const SITE = (process.env.SITE_URL ?? "https://cyoungg06.github.io") + BASE_PATH;
const FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;
const relevant = (p) => p.relevant !== false;

const truncate = (text, max) =>
  typeof text === "string" && text.length > max
    ? `${text.slice(0, max)}…`
    : (text ?? "");

async function main() {
  await mkdir(outDir, { recursive: true });
  const dates = existsSync(papersDir)
    ? (await readdir(papersDir))
        .filter((f) => FILE_RE.test(f))
        .map((f) => f.replace(/\.json$/, ""))
        .sort()
        .reverse()
    : [];

  const entries = [];
  const allPapers = [];
  /** month → 该月全部相关论文的标题行 */
  const titleShards = new Map();
  for (const date of dates) {
    const digest = JSON.parse(
      await readFile(path.join(papersDir, `${date}.json`), "utf8"),
    );
    await copyFile(
      path.join(papersDir, `${date}.json`),
      path.join(outDir, `${date}.json`),
    );
    entries.push({
      date,
      url: `${SITE}/api/papers/${date}.json`,
      page: `${SITE}/zh/papers/${date}/`,
      papers: digest.hf.length + digest.arxiv.length + (digest.embodied ?? []).length,
      arxivStatus: digest.arxivStatus,
      relevant:
        digest.hf.filter(relevant).length +
        digest.arxiv.filter(relevant).length +
        (digest.embodied ?? []).filter(relevant).length,
    });
    // 跨天检索索引(AI 助手 search_papers 工具用):只收相关论文,摘要截断控体积
    for (const source of ["hf", "arxiv", "embodied"]) {
      for (const p of (digest[source] ?? []).filter(relevant)) {
        const month = date.slice(0, 7);
        if (!titleShards.has(month)) titleShards.set(month, []);
        titleShards.get(month).push({
          d: date,
          i: p.id,
          t: p.title,
          ...(p.titleZh ? { z: p.titleZh } : {}),
          ...(p.score != null ? { s: p.score } : {}),
        });
        allPapers.push({
          date,
          source,
          id: p.id,
          title: p.title,
          titleZh: p.titleZh,
          summary: truncate(p.summaryZh, 240),
          score: p.score,
          deepDive: p.deepDive === true,
          upvotes: p.upvotes || undefined,
          url: p.urls?.abs,
        });
      }
    }
  }

  const index = {
    name: "论文速递 · 相对性阿卡内",
    apiVersion: "1",
    feed: `${SITE}/feed.xml`,
    latest: entries[0]?.date ?? null,
    dates: entries,
  };
  await writeFile(path.join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  // dates 已按日期倒序,allPapers 随之新→旧
  await writeFile(
    path.join(outDir, "all.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), papers: allPapers }),
  );
  const titlesDir = path.join(outDir, "titles");
  await rm(titlesDir, { recursive: true, force: true });
  await mkdir(titlesDir, { recursive: true });
  const months = [...titleShards.keys()].sort().reverse();
  for (const month of months) {
    await writeFile(path.join(titlesDir, `${month}.json`), JSON.stringify(titleShards.get(month)));
  }
  await writeFile(
    path.join(titlesDir, "index.json"),
    JSON.stringify({ months, issues: entries.length }),
  );
  console.log(`[api] wrote public/api/papers/ (${entries.length} digest(s) + index + all:${allPapers.length} papers + titles:${months.length} month(s))`);
}

await main();
