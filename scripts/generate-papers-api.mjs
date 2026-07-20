/**
 * 生成论文速递静态 JSON API。
 * content/papers/*.json 原样复制到 public/api/papers/,
 * 另写 index.json(归档索引 + 最新指针 + feed 地址)。
 * 构建期生成,public/api/ 已 gitignore。字段只增不删,保证消费方兼容。
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const papersDir = path.join(root, "content", "papers");
const outDir = path.join(root, "public", "api", "papers");

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const SITE = (process.env.SITE_URL ?? "https://cyoungg06.github.io") + BASE_PATH;
const FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;
const relevant = (p) => p.relevant !== false;

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
      papers: digest.hf.length + digest.arxiv.length,
      relevant:
        digest.hf.filter(relevant).length + digest.arxiv.filter(relevant).length,
    });
  }

  const index = {
    name: "论文速递 · 相对性阿卡内",
    apiVersion: "1",
    feed: `${SITE}/feed.xml`,
    latest: entries[0]?.date ?? null,
    dates: entries,
  };
  await writeFile(path.join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  console.log(`[api] wrote public/api/papers/ (${entries.length} digest(s) + index)`);
}

await main();
