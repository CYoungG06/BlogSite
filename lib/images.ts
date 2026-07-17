/**
 * 图床抽象:
 * - 绝对 URL(http/https/data)原样返回
 * - 配了 NEXT_PUBLIC_IMAGE_BASE_URL(OSS 图床)→ CDN 前缀
 * - 否则走本地 public/,补 basePath 前缀
 */
const cdnBase = (process.env.NEXT_PUBLIC_IMAGE_BASE_URL ?? "").replace(
  /\/+$/,
  "",
);
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function imageUrl(src: string): string {
  if (!src) return src;
  if (/^(https?:)?\/\//.test(src) || src.startsWith("data:")) return src;
  const path = src.startsWith("/") ? src : `/${src}`;
  if (cdnBase) return `${cdnBase}${path}`;
  return `${basePath}${path}`;
}

export { basePath };
