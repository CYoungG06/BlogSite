/**
 * 专题(content/series/<slug>/)→ public/series/<slug>/<lesson>.html(构建产物,已 gitignore)。
 *
 * 课件是独立的单文件交互页面(content/series/<slug>/lessons/*.html,原样保存,不手改),
 * 站点用 iframe 嵌进 /[locale]/series/<slug>/<lesson>/(见 components/series/LessonFrame.tsx)。
 * 复制时注入三样东西,原文件保持可以直接覆盖更新:
 * 1. 博客配色:把课件的中性色(背景、文字、描边)换成站点的 token,prefill 蓝换成站点的 accent;
 *    其余数据配色(decode 橙、cache 绿等)保留课件自己的设计。背景透明,露出站点的点阵底。
 * 2. 深浅色同步:跟随父页面 <html class="dark">(next-themes),父页面切换时实时跟着变;
 *    单独打开时读 localStorage.theme。
 * 3. 课与课互链:正文里的「第 N 课」改成链到对应课的链接(target=_top,跳转整页);
 *    课件给单个段落也加了 .prose(纵向 flex),插进链接会把一段拆成上下几块,
 *    所以注入的样式把 p.prose 改回普通块级(纯文字段落看起来完全一样)。
 *    series.json 里有 benchUrl 时,把 <code>bench/</code> 链到压测脚本目录。
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const seriesRoot = path.join(root, "content", "series");
const outRoot = path.join(root, "public", "series");
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const PALETTE = `
/* —— 以下由 scripts/build-series.mjs 注入:博客配色、深浅色同步、课间链接 —— */
:root{color-scheme:light;--bg:#ffffff;--surface:#fafafa;--surface-2:#f1f1f3;--ink:#09090b;--ink-2:#52525b;--ink-3:#71717a;--line:#d4d4d8;--waste:#a1a1aa;--prefill:#2952e3}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#09090b;--surface:#101013;--surface-2:#1b1b1f;--ink:#f4f4f5;--ink-2:#a1a1aa;--ink-3:#8b8b94;--line:#2c2c31;--waste:#52525b}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#09090b;--surface:#101013;--surface-2:#1b1b1f;--ink:#f4f4f5;--ink-2:#a1a1aa;--ink-3:#8b8b94;--line:#2c2c31;--waste:#52525b}
body{background:transparent}
p.prose{display:block}
a.lesson-ref{color:inherit;text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:3px}
a.lesson-ref:hover{color:var(--prefill);text-decoration-color:currentColor}
`;

// 尽早执行,避免先按系统主题画一帧再闪成站点主题
const THEME_SCRIPT = `<script>(function(){var r=document.documentElement;function set(d){r.setAttribute("data-theme",d?"dark":"light")}
try{if(window.parent!==window){var p=window.parent.document.documentElement;set(p.classList.contains("dark"));
new MutationObserver(function(){set(p.classList.contains("dark"))}).observe(p,{attributes:true,attributeFilter:["class"]});
document.addEventListener("DOMContentLoaded",function(){var m=window.parent.location.pathname.match(/\\/(zh|en)\\/series\\//);
if(m&&m[1]!=="zh"){document.querySelectorAll("a.lesson-ref").forEach(function(a){a.href=a.getAttribute("href").replace("/zh/series/","/"+m[1]+"/series/")})}});}
else{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")set(t==="dark")}}catch(e){}})();</script>`;

/** 这些元素里的文字不改写(代码、图、按钮、脚本、已有链接) */
const SKIP_TAGS = new Set(["script", "style", "svg", "code", "pre", "a", "button", "title", "textarea", "option", "label"]);

/** 把正文文本里的「第 N 课」换成链接;课件页眉(eyebrow)和其他不该改的地方跳过 */
function linkLessons(html, lessons, current, seriesSlug) {
  const parts = html.split(/(<[^>]+>)/);
  let skip = 0;
  let inEyebrow = false;
  let links = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("<")) {
      const m = part.match(/^<(\/?)([a-zA-Z][\w-]*)/);
      if (!m) continue;
      const [, closing, tag] = m;
      const name = tag.toLowerCase();
      if (name === "div" && !closing && /class="[^"]*\beyebrow\b/.test(part)) inEyebrow = true;
      else if (name === "div" && closing && inEyebrow) inEyebrow = false;
      if (SKIP_TAGS.has(name) && !part.endsWith("/>")) skip += closing ? -1 : 1;
      continue;
    }
    if (skip > 0 || inEyebrow || !part.includes("课")) continue;
    parts[i] = part.replace(/第 ([1-9]) 课/g, (text, n) => {
      const target = lessons[Number(n) - 1];
      if (!target || target === current) return text;
      links += 1;
      return `<a class="lesson-ref" href="${BASE_PATH}/zh/series/${seriesSlug}/${target}/" target="_top">${text}</a>`;
    });
  }
  return { html: parts.join(""), links };
}

async function buildSeries(slug) {
  const dir = path.join(seriesRoot, slug);
  const meta = JSON.parse(await readFile(path.join(dir, "series.json"), "utf8"));
  const lessons = meta.lessons.map((l) => l.slug);
  const outDir = path.join(outRoot, slug);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  let totalLinks = 0;
  for (const lesson of lessons) {
    let html = await readFile(path.join(dir, "lessons", `${lesson}.html`), "utf8");
    const styleEnd = html.indexOf("</style>");
    if (styleEnd < 0) throw new Error(`[series] ${slug}/${lesson}: 找不到 <style>,无法注入配色`);
    html = html.slice(0, styleEnd) + PALETTE + html.slice(styleEnd);
    html = html.replace(/<meta charset="utf-8">/i, (m) => m + THEME_SCRIPT);
    const linked = linkLessons(html, lessons, lesson, slug);
    html = linked.html;
    totalLinks += linked.links;
    if (meta.benchUrl) {
      html = html.replace(
        "<code>bench/</code>",
        `<a href="${meta.benchUrl}" target="_blank" rel="noopener"><code>bench/</code></a>`,
      );
    }
    await writeFile(path.join(outDir, `${lesson}.html`), html);
  }
  console.log(`[series] ${slug}: ${lessons.length} lesson(s), ${totalLinks} cross-lesson link(s)`);
}

if (existsSync(seriesRoot)) {
  for (const entry of await readdir(seriesRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(path.join(seriesRoot, entry.name, "series.json"))) {
      await buildSeries(entry.name);
    }
  }
}
