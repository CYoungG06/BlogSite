/**
 * 分享卡片:把助手回答渲染成 PNG(Canvas 2D)并触发下载。
 * 轻量实现:Markdown 转纯文本后按像素宽度折行,不做完整排版;
 * 配色固定浅色主题(accent #2952e3),分享出去不依赖站点暗色模式。
 */

const WIDTH = 840;
const PADDING = 48;
const ACCENT = "#2952e3";
const BG = "#fafafa";
const FG = "#09090b";
const MUTED = "#52525b";
const HAIRLINE = "#e4e4e7";
const BODY_FONT = "15px -apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif";
const LINE_HEIGHT = 26;
const MAX_TEXT_WIDTH = WIDTH - PADDING * 2;
/** 卡片正文最长行数,超出截断,避免超长回答生成巨型图片 */
const MAX_LINES = 40;

/** Markdown → 纯文本行:保留结构(标题/列表/引用),去掉标记符号 */
function mdToLines(md: string): string[] {
  const lines: string[] = [];
  let inCode = false;
  for (const raw of md.split("\n")) {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      if (raw.trim()) lines.push(`  ${raw}`);
      continue;
    }
    const line = raw
      .replace(/^#{1,6}\s*/, "")
      .replace(/^\s*>\s?/, "▎")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^\s*[-*+]\s+/, "· ")
      .replace(/~~([^~]+)~~/g, "$1")
      .trimEnd();
    lines.push(line);
  }
  return lines;
}

/** 按像素宽度折行;CJK 无空格,逐字符贪心即可 */
function wrapLine(ctx: CanvasRenderingContext2D, text: string): string[] {
  if (!text) return [""];
  const out: string[] = [];
  let current = "";
  for (const ch of text) {
    if (ctx.measureText(current + ch).width > MAX_TEXT_WIDTH && current) {
      out.push(current);
      current = ch.trimStart();
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out;
}

export function downloadShareCard(content: string): void {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.font = BODY_FONT;

  // 先排版算出高度,再正式绘制
  const bodyLines: string[] = [];
  for (const line of mdToLines(content)) {
    for (const wrapped of wrapLine(ctx, line)) {
      bodyLines.push(wrapped);
      if (bodyLines.length >= MAX_LINES) break;
    }
    if (bodyLines.length >= MAX_LINES) {
      bodyLines[bodyLines.length - 1] = `${bodyLines[bodyLines.length - 1].replace(/.$/, "…")}`;
      break;
    }
  }

  const headerH = 96;
  const footerH = 64;
  const bodyH = bodyLines.length * LINE_HEIGHT + 24;
  const height = headerH + bodyH + footerH;
  const scale = 2; // 2x 导出,保证清晰度

  canvas.width = WIDTH * scale;
  canvas.height = height * scale;
  ctx.scale(scale, scale);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, height);

  // 顶部 accent 条 + 抬头
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, WIDTH, 6);
  ctx.font = "600 20px -apple-system, 'PingFang SC', sans-serif";
  ctx.fillStyle = FG;
  ctx.fillText("阿卡内助手", PADDING, 52);
  ctx.font = "13px -apple-system, 'PingFang SC', sans-serif";
  ctx.fillStyle = MUTED;
  const site = "相对性阿卡内 · Relativity Acane";
  ctx.fillText(site, WIDTH - PADDING - ctx.measureText(site).width, 52);
  ctx.strokeStyle = HAIRLINE;
  ctx.beginPath();
  ctx.moveTo(PADDING, 72);
  ctx.lineTo(WIDTH - PADDING, 72);
  ctx.stroke();

  // 正文
  ctx.font = BODY_FONT;
  ctx.fillStyle = FG;
  let y = headerH + LINE_HEIGHT - 12;
  for (const line of bodyLines) {
    ctx.fillText(line, PADDING, y);
    y += LINE_HEIGHT;
  }

  // 底部日期与地址
  ctx.font = "12px -apple-system, 'PingFang SC', sans-serif";
  ctx.fillStyle = MUTED;
  ctx.fillText(new Date().toISOString().slice(0, 10), PADDING, height - 28);
  const url = "cyoungg06.github.io/BlogSite";
  ctx.fillText(url, WIDTH - PADDING - ctx.measureText(url).width, height - 28);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `acane-share-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
}
