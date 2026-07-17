import rehypeShiki from "@shikijs/rehype";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";

/**
 * MDX 插件链(顺序敏感)— 见 DESIGN.md §6.1
 * rehype-katex 必须在 shiki 之前;CJK 两个插件处理中文相邻的强调/删除线。
 */
export const remarkPlugins: PluggableList = [
  remarkGfm,
  remarkCjkFriendlyGfmStrikethrough, // ~~删除线~~接中文能渲染
  remarkCjkFriendly, // **粗体**接中文能渲染(CommonMark flanking 坑)
  remarkMath,
];

export const rehypePlugins: PluggableList = [
  rehypeSlug, // 标题 id(TOC 依赖,与 lib/markdown.ts 的 github-slugger 同款)
  [
    rehypeAutolinkHeadings,
    {
      behavior: "append",
      properties: { className: ["anchor"], ariaHidden: true, tabIndex: -1 },
      content: { type: "text", value: "#" },
    },
  ],
  rehypeKatex,
  [
    rehypeShiki,
    {
      themes: { light: "github-light", dark: "github-dark" },
      addLanguageClass: true,
    },
  ],
];
