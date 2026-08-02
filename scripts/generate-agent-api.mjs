/**
 * 生成 AI 助手(Agent)静态数据,构建期输出到 public/api/agent/(已 gitignore):
 * - site.{locale}.json        站点地图:栏目说明 + 全部文章索引(标题/描述/路径)
 * - articles/{locale}/*.json  单篇文章纯文本(read_article 工具按需拉取)
 *
 * 覆盖 blog / notes / distilled / reading / insights / research(mori)。
 * 依赖 Node ≥ 22 原生 type-stripping;不要 import 带 "@/" 别名的 ts 文件。
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { stripMarkdown } from "../lib/markdown.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(root, "content");
const outDir = path.join(root, "public", "api", "agent");

const LOCALES = ["zh", "en"];

/** type → 路由前缀(locale 相对,结尾带 /)与栏目名 */
const COLLECTIONS = [
  { dir: "blog", type: "post", route: "/blog/", label: { zh: "博客文章", en: "Blog" } },
  { dir: "notes", type: "note", route: "/notes/", label: { zh: "笔记", en: "Notes" } },
  { dir: "distilled", type: "distilled", route: "/distilled/", label: { zh: "蒸馏(转载翻译)", en: "Distilled" } },
  { dir: "reading", type: "reading", route: "/reading/", label: { zh: "论文精读", en: "Reading" } },
];

const INSIGHT_ROUTE = "/papers/insights/";

async function scanCollection(dir, locale) {
  const dirPath = path.join(contentRoot, dir, locale);
  if (!existsSync(dirPath)) return [];
  const files = (await readdir(dirPath)).filter((f) => /\.mdx?$/.test(f)).sort();
  const docs = [];
  for (const file of files) {
    const source = await readFile(path.join(dirPath, file), "utf8");
    const { data, content } = matter(source);
    if (data.draft === true) continue;
    docs.push({
      slug: file.replace(/\.mdx?$/, ""),
      title: String(data.title ?? ""),
      description: String(data.description ?? ""),
      date: String(data.date ?? ""),
      text: stripMarkdown(content),
    });
  }
  return docs;
}

/** insights 无 locale 子目录,中英文站共用同一份中文解读 */
async function scanInsights() {
  const dirPath = path.join(contentRoot, "insights");
  if (!existsSync(dirPath)) return [];
  const files = (await readdir(dirPath)).filter((f) => /\.mdx?$/.test(f)).sort();
  const docs = [];
  for (const file of files) {
    const source = await readFile(path.join(dirPath, file), "utf8");
    const { data, content } = matter(source);
    if (data.draft === true) continue;
    docs.push({
      slug: String(data.paperId ?? file.replace(/\.mdx?$/, "")),
      title: String(data.title ?? ""),
      description: String(data.description ?? ""),
      date: String(data.date ?? ""),
      text: stripMarkdown(content),
    });
  }
  return docs;
}

/** research/mori.mdx,同上中英共用 */
async function scanResearch() {
  const file = path.join(contentRoot, "research", "mori.mdx");
  if (!existsSync(file)) return [];
  const { data, content } = matter(await readFile(file, "utf8"));
  return [
    {
      slug: "mori",
      title: String(data.title ?? "MoRI"),
      description: String(data.description ?? ""),
      date: String(data.date ?? ""),
      text: stripMarkdown(content),
    },
  ];
}

async function researchSummary() {
  const file = path.join(contentRoot, "research", "research.json");
  if (!existsSync(file)) return "";
  const data = JSON.parse(await readFile(file, "utf8"));
  const pubs = (data.publications ?? [])
    .map((p) => `${p.title}(${p.venue}):${p.tldr}`)
    .join("\n");
  return [data.intro, data.group, pubs].filter(Boolean).join("\n");
}

async function aboutSummary(locale) {
  const file = path.join(contentRoot, "about", `${locale}.mdx`);
  if (!existsSync(file)) return "";
  const { content } = matter(await readFile(file, "utf8"));
  return stripMarkdown(content).slice(0, 1200);
}

async function writeArticle(locale, type, doc, route) {
  const file = path.join(outDir, "articles", locale, `${type}--${doc.slug}.json`);
  const body = {
    type,
    slug: doc.slug,
    title: doc.title,
    description: doc.description,
    date: doc.date,
    path: `${route}${doc.slug}/`,
    text: doc.text,
  };
  await writeFile(file, JSON.stringify(body), "utf8");
}

async function main() {
  const insights = await scanInsights();
  const research = await scanResearch();
  const researchText = await researchSummary();

  for (const locale of LOCALES) {
    await mkdir(path.join(outDir, "articles", locale), { recursive: true });
    const sections = [];

    for (const { dir, type, route, label } of COLLECTIONS) {
      const docs = await scanCollection(dir, locale);
      if (!docs.length) continue;
      for (const doc of docs) await writeArticle(locale, type, doc, route);
      sections.push({
        type,
        label: label[locale],
        path: route,
        items: docs.map(({ text: _text, ...meta }) => ({
          ...meta,
          path: `${route}${meta.slug}/`,
        })),
      });
    }

    if (insights.length) {
      for (const doc of insights) await writeArticle(locale, "insight", doc, INSIGHT_ROUTE);
      sections.push({
        type: "insight",
        label: locale === "zh" ? "论文深度解读" : "Paper Insights",
        path: "/papers/",
        items: insights.map(({ text: _text, ...meta }) => ({
          ...meta,
          path: `${INSIGHT_ROUTE}${meta.slug}/`,
        })),
      });
    }

    if (research.length) {
      for (const doc of research) await writeArticle(locale, "research", doc, "/research/");
    }

    const site = {
      name: locale === "zh" ? "相对性阿卡内" : "Relativity Acane",
      description:
        locale === "zh"
          ? "个人博客:LLM / 后训练 / Agent 方向的长文与笔记,每日论文速递(arXiv + Hugging Face 热门,附 AI 中文导读),以及转载翻译的「蒸馏」栏目。"
          : "Personal blog on LLMs, post-training and agents, with a daily paper digest (arXiv + Hugging Face trending, AI-written Chinese summaries) and translated articles.",
      generatedAt: new Date().toISOString(),
      sections,
      pages: [
        {
          id: "papers",
          title: locale === "zh" ? "论文速递" : "Paper Digest",
          path: "/papers/",
          summary:
            locale === "zh"
              ? "每日更新的论文速递:Hugging Face 热门 + arXiv 新论文,附 AI 评分与中文导读。用 list_digests / read_digest 工具查询具体内容。"
              : "Daily paper digest: Hugging Face trending + arXiv new papers with AI scores and Chinese summaries. Use list_digests / read_digest tools.",
        },
        {
          id: "research",
          title: locale === "zh" ? "研究" : "Research",
          path: "/research/",
          summary: researchText,
        },
        {
          id: "about",
          title: locale === "zh" ? "关于" : "About",
          path: "/about/",
          summary: await aboutSummary(locale),
        },
        {
          id: "music",
          title: locale === "zh" ? "音乐" : "Music",
          path: "/music/",
          summary:
            locale === "zh"
              ? "夜鹿(ヨルシカ / Yorushika)主题页:Suis is All You Need。"
              : "A fan page for Yorushika (ヨルシカ). Suis is All You Need.",
        },
      ],
    };
    await writeFile(
      path.join(outDir, `site.${locale}.json`),
      JSON.stringify(site, null, 2) + "\n",
      "utf8",
    );
    console.log(
      `[agent-api] ${locale}: ${sections.reduce((n, s) => n + s.items.length, 0)} 篇文章索引`,
    );
  }
}

await main();
