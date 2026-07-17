#!/usr/bin/env node
/**
 * 新文章脚手架:生成 content/blog/{locale}/{slug}.md,frontmatter 预填。
 *
 * 用法:
 *   npm run new-post -- <slug> [--title=...] [--locale=zh|en] [--tags=a,b,c] [--description=...] [--draft]
 *   --title 测试 与 --title=测试 两种写法都支持。
 *   不带 slug 时进入交互模式,用 readline 提问 slug(必填)与 title(留空默认 slug)。
 *
 * 纯 Node 标准库,不 import 任何项目代码。
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const LOCALES = ["zh", "en"];
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  let slug = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--draft") {
      options.draft = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        options[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
        options[body] = argv[++i];
      } else {
        fail(`参数 --${body} 缺少值(布尔参数只有 --draft)`);
      }
      continue;
    }
    if (slug !== null) fail(`多余的位置参数:${arg}`);
    slug = arg;
  }
  return { slug, options };
}

/** 本地时区的 YYYY-MM-DD */
function today() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 输出 YAML 双引号字符串 — JSON 转义是 YAML 双引号风格的子集 */
function yamlString(value) {
  return JSON.stringify(value);
}

async function askInteractively() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  // 用异步迭代器而不是 rl.question:同一 chunk 里到达的多行会被排队,
  // 不会因后一个 question 尚未注册而丢行(piped stdin 场景)
  const iterator = rl[Symbol.asyncIterator]();
  /** 返回 null 表示输入已结束(EOF) */
  const ask = async (question) => {
    process.stdout.write(question);
    const { value, done } = await iterator.next();
    return done ? null : value;
  };
  try {
    let slug = "";
    while (!SLUG_RE.test(slug)) {
      const input = await ask("slug(小写字母/数字/连字符,必填): ");
      if (input === null) fail("输入结束:slug 为必填项");
      slug = input.trim();
      if (!SLUG_RE.test(slug)) {
        console.error("  不合法:需匹配 /^[a-z0-9][a-z0-9-]*$/,请重新输入");
      }
    }
    const titleInput = await ask(`title(留空默认 "${slug}"): `);
    return { slug, title: (titleInput ?? "").trim() };
  } finally {
    rl.close();
  }
}

async function main() {
  const { slug: argSlug, options } = parseArgs(process.argv.slice(2));

  let slug = argSlug;
  let title = typeof options.title === "string" ? options.title.trim() : "";

  if (slug === null) {
    const answers = await askInteractively();
    slug = answers.slug;
    if (!title) title = answers.title;
  }

  if (!SLUG_RE.test(slug)) {
    fail(`slug "${slug}" 不合法,需匹配 ${SLUG_RE}`);
  }
  if (!title) title = slug;

  const locale = options.locale ?? "zh";
  if (!LOCALES.includes(locale)) {
    fail(`locale 只能是 ${LOCALES.join(" / ")},收到 "${locale}"`);
  }

  const tags =
    typeof options.tags === "string" && options.tags
      ? options.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
  const description =
    typeof options.description === "string" ? options.description : "";

  const lines = [
    "---",
    `title: ${yamlString(title)}`,
    `date: ${yamlString(today())}`,
    `description: ${yamlString(description)}`,
    `tags: [${tags.map(yamlString).join(", ")}]`,
  ];
  if (options.draft === true) lines.push("draft: true");
  lines.push("---", "");

  const body =
    locale === "en"
      ? [
          "## First heading",
          "",
          "Replace this placeholder with your first paragraph.",
          "",
        ]
      : ["## 第一个小标题", "", "在这里写第一段正文,把这句占位替换掉。", ""];

  const dir = path.join(process.cwd(), "content", "blog", locale);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.md`);
  if (fs.existsSync(file)) {
    fail(`文件已存在,未覆盖:content/blog/${locale}/${slug}.md`);
  }
  fs.writeFileSync(file, lines.join("\n") + "\n" + body.join("\n"), {
    flag: "wx",
  });
  console.log(`已创建 content/blog/${locale}/${slug}.md`);
}

await main();
