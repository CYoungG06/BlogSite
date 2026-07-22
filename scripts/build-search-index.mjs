/**
 * 构建搜索索引 — 见 DESIGN.md §6.3。
 * 扫描 content/{blog,notes}/{zh,en}/ 下的 .md/.mdx,剥 markdown 后建
 * MiniSearch 索引(CJK bigram 分词),写 public/search-index/{zh,en}.json。
 *
 * 依赖 Node ≥ 22 的原生 type-stripping 直接 import .ts(分词器、
 * stripMarkdown 与客户端共享同一份源码);
 * 不要 import 带 "@/" 路径别名的 ts 文件 — Node 解析不了 tsconfig paths。
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import MiniSearch from "minisearch";
import { stripMarkdown } from "../lib/markdown.ts";
import { tokenize } from "../lib/search/tokenize.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(root, "content");
const outDir = path.join(root, "public", "search-index");

const LOCALES = ["zh", "en"];
const COLLECTIONS = [
  { dir: "blog", type: "post" },
  { dir: "notes", type: "note" },
  { dir: "distilled", type: "distilled" },
];

async function collectDocuments(locale) {
  const docs = [];
  for (const { dir, type } of COLLECTIONS) {
    const dirPath = path.join(contentRoot, dir, locale);
    if (!existsSync(dirPath)) continue;
    const files = (await readdir(dirPath))
      .filter((file) => /\.mdx?$/.test(file))
      .sort();
    for (const file of files) {
      const source = await readFile(path.join(dirPath, file), "utf8");
      const { data, content } = matter(source);
      if (data.draft === true) continue;
      const slug = file.replace(/\.mdx?$/, "");
      docs.push({
        id: `${type}/${slug}`,
        type,
        slug,
        title: String(data.title ?? ""),
        description: String(data.description ?? ""),
        content: stripMarkdown(content),
        tags: Array.isArray(data.tags) ? data.tags.join(" ") : "",
      });
    }
  }
  return docs;
}

await mkdir(outDir, { recursive: true });

for (const locale of LOCALES) {
  const docs = await collectDocuments(locale);
  const index = new MiniSearch({
    fields: ["title", "description", "content", "tags"],
    storeFields: ["type", "slug", "title", "description"],
    tokenize,
  });
  index.addAll(docs);
  await writeFile(
    path.join(outDir, `${locale}.json`),
    JSON.stringify(index),
    "utf8",
  );
  console.log(`[search-index] ${locale}: ${docs.length} 篇文档`);
}
