/**
 * 构建搜索索引 — 见 DESIGN.md §6.3。
 * 覆盖:文章 / 笔记 / 蒸馏 / 精读(content/{collection}/{zh,en}/)、
 * 论文深度解读(content/insights/)、研究详情(content/research/*.mdx)、项目(content/projects/)。
 * 剥 markdown 后建 MiniSearch 索引(CJK bigram 分词),写 public/search-index/{zh,en}.json。
 *
 * 语言回退与站点一致:某篇没有英文版时,英文站显示中文原文,英文索引也收中文原文
 * (否则英文站能看到 30 多篇文章,却几乎什么都搜不到)。
 * 每条记录存好站内路径 href(不含 locale),搜索框、/search 页与 AI 助手直接用。
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
const DEFAULT_LOCALE = "zh";
const COLLECTIONS = [
  { dir: "blog", type: "post" },
  { dir: "notes", type: "note" },
  { dir: "distilled", type: "distilled" },
  { dir: "reading", type: "reading" },
];

const isMarkdown = (file) => /\.mdx?$/.test(file);
const slugOf = (file) => file.replace(/\.mdx?$/, "");
const tagsOf = (data) => (Array.isArray(data.tags) ? data.tags.join(" ") : "");
/** 项目的 title / description 可能是 { zh, en },按 locale 取,缺了回退 */
const pick = (value, locale) =>
  value && typeof value === "object"
    ? String(value[locale] ?? value[DEFAULT_LOCALE] ?? value.en ?? "")
    : String(value ?? "");

async function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter(isMarkdown).sort();
}

async function readDoc(file) {
  return matter(await readFile(file, "utf8"));
}

/** 文章类集合:每个 slug 取该语言的版本,没有就回退默认语言(与 lib/collection.ts 一致) */
async function collectionDocs(locale) {
  const docs = [];
  for (const { dir, type } of COLLECTIONS) {
    const byLocale = {};
    for (const l of LOCALES) {
      byLocale[l] = new Set((await listFiles(path.join(contentRoot, dir, l))).map((f) => f));
    }
    const files = new Set(LOCALES.flatMap((l) => [...byLocale[l]]));
    for (const file of [...files].sort()) {
      const source =
        [locale, DEFAULT_LOCALE, ...LOCALES].find((l) => byLocale[l].has(file)) ?? DEFAULT_LOCALE;
      const { data, content } = await readDoc(path.join(contentRoot, dir, source, file));
      if (data.draft === true) continue;
      const slug = slugOf(file);
      docs.push({
        id: `${type}/${slug}`,
        type,
        slug,
        href: `/${dir}/${slug}/`,
        title: String(data.title ?? ""),
        description: String(data.description ?? ""),
        content: stripMarkdown(content),
        tags: tagsOf(data),
      });
    }
  }
  return docs;
}

/** 论文深度解读:只有中文,两种语言的索引都收 */
async function insightDocs() {
  const dir = path.join(contentRoot, "insights");
  const docs = [];
  for (const file of await listFiles(dir)) {
    const { data, content } = await readDoc(path.join(dir, file));
    const slug = slugOf(file);
    docs.push({
      id: `insight/${slug}`,
      type: "insight",
      slug,
      href: `/papers/insights/${slug}/`,
      title: String(data.title ?? slug),
      description: String(data.description ?? data.paperTitle ?? ""),
      content: stripMarkdown(content),
      tags: tagsOf(data),
    });
  }
  return docs;
}

/** 研究详情页:content/research/<slug>.mdx */
async function researchDocs() {
  const dir = path.join(contentRoot, "research");
  const docs = [];
  for (const file of await listFiles(dir)) {
    const { data, content } = await readDoc(path.join(dir, file));
    const slug = slugOf(file);
    docs.push({
      id: `research/${slug}`,
      type: "research",
      slug,
      href: `/research/${slug}/`,
      title: String(data.title ?? slug),
      description: String(data.tldr ?? data.subtitle ?? ""),
      content: stripMarkdown(content),
      tags: [data.venue, data.subtitle].filter(Boolean).join(" "),
    });
  }
  return docs;
}

/** 项目:单文件双语;有详情页的链到详情,否则链到项目列表 */
async function projectDocs(locale) {
  const dir = path.join(contentRoot, "projects");
  const docs = [];
  for (const file of await listFiles(dir)) {
    const { data, content } = await readDoc(path.join(dir, file));
    if (data.draft === true) continue;
    const slug = slugOf(file);
    docs.push({
      id: `project/${slug}`,
      type: "project",
      slug,
      href: data.hasDetail === true ? `/projects/${slug}/` : "/projects/",
      title: pick(data.title, locale) || slug,
      description: pick(data.description, locale),
      content: data.hasDetail === true ? stripMarkdown(content) : "",
      tags: tagsOf(data),
    });
  }
  return docs;
}

await mkdir(outDir, { recursive: true });

for (const locale of LOCALES) {
  const docs = [
    ...(await collectionDocs(locale)),
    ...(await insightDocs()),
    ...(await researchDocs()),
    ...(await projectDocs(locale)),
  ];
  const index = new MiniSearch({
    fields: ["title", "description", "content", "tags"],
    storeFields: ["type", "slug", "title", "description", "href"],
    tokenize,
  });
  index.addAll(docs);
  await writeFile(
    path.join(outDir, `${locale}.json`),
    JSON.stringify(index),
    "utf8",
  );
  const byType = docs.reduce((m, d) => ((m[d.type] = (m[d.type] ?? 0) + 1), m), {});
  console.log(`[search-index] ${locale}: ${docs.length} 篇文档 ${JSON.stringify(byType)}`);
}
