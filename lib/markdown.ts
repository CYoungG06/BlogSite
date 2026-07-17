import GithubSlugger from "github-slugger";

/**
 * markdown 文本工具:搜索索引、笔记预览、TOC 提取共用。
 * 全部工作在源码字符串上(构建期),不依赖 MDX 编译结果。
 */

/** 逐行扫描,跳过围栏代码块(``` / ~~~),返回有效行 */
function* iterNonCodeLines(source: string): Generator<string> {
  let inFence = false;
  let fenceMark = "";
  for (const line of source.split("\n")) {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMark = fence[1][0];
      } else if (fence[1][0] === fenceMark) {
        inFence = false;
      }
      continue;
    }
    if (!inFence) yield line;
  }
}

/** 剥掉 markdown 语法,留下纯文本(供搜索索引 / 预览) */
export function stripMarkdown(source: string): string {
  const lines: string[] = [];
  for (const line of iterNonCodeLines(source)) {
    lines.push(line);
  }
  return lines
    .join("\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // 图片 → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接 → 文本
    .replace(/^#{1,6}\s+/gm, "") // 标题标记
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // 粗体
    .replace(/(\*|_)(.*?)\1/g, "$2") // 斜体
    .replace(/~~(.*?)~~/g, "$1") // 删除线
    .replace(/`([^`]*)`/g, "$1") // 行内 code
    .replace(/\$\$([^$]*)\$\$/g, "$1") // 块级公式
    .replace(/\$([^$\n]*)\$/g, "$1") // 行内公式
    .replace(/^\s*>\s?/gm, "") // 引用
    .replace(/^\s*[-*+]\s+/gm, "") // 无序列表
    .replace(/^\s*\d+\.\s+/gm, "") // 有序列表
    .replace(/<[^>]+>/g, "") // HTML 标签
    .replace(/\|/g, " ") // 表格
    .replace(/[-:]{3,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 首段预览:取第一段非标题、非引用、非列表的正文,截到 max 字 */
export function firstParagraphPreview(source: string, max = 160): string {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of iterNonCodeLines(source)) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current.length) {
        blocks.push(current.join(" "));
        current = [];
      }
      continue;
    }
    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith(">") ||
      /^[-*+]\s/.test(trimmed) ||
      /^\d+\.\s/.test(trimmed) ||
      trimmed.startsWith("$$") ||
      trimmed.startsWith("|") ||
      trimmed.startsWith("<")
    ) {
      if (current.length) {
        blocks.push(current.join(" "));
        current = [];
      }
      continue;
    }
    current.push(trimmed);
  }
  if (current.length) blocks.push(current.join(" "));

  const first = stripMarkdown(blocks[0] ?? "");
  if (first.length <= max) return first;
  return `${first.slice(0, max).trimEnd()}…`;
}

const CJK_CHAR_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/** 阅读时长估算:CJK 约 400 字/分钟,拉丁约 200 词/分钟 */
export function estimateReadingMinutes(source: string): number {
  const text = stripMarkdown(source);
  const cjkChars = (text.match(CJK_CHAR_RE) ?? []).length;
  const latinWords = (text.replace(CJK_CHAR_RE, " ").match(/[\p{L}\p{N}]+/gu) ??
    [])
    .length;
  return Math.max(1, Math.round(cjkChars / 400 + latinWords / 200));
}

export interface TocItem {
  depth: 2 | 3;
  text: string;
  slug: string;
}

/** TOC 展示文本:剥掉 $...$(目录不渲染公式)与强调/链接语法 */
function cleanHeadingText(raw: string): string {
  return raw
    .replace(/\$([^$\n]*)\$/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

/**
 * 解析 markdown 的 h2/h3 生成 TOC。
 * slug 用 github-slugger — 必须和 rehype-slug 同款,否则锚点对不上。
 */
export function extractHeadings(source: string): TocItem[] {
  const slugger = new GithubSlugger();
  const items: TocItem[] = [];
  for (const line of iterNonCodeLines(source)) {
    const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const depth = match[1].length as 2 | 3;
    const text = cleanHeadingText(match[2]);
    if (!text) continue;
    items.push({ depth, text, slug: slugger.slug(text) });
  }
  return items;
}
