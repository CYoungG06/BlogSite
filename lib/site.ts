/**
 * 站点的公开地址:canonical、Open Graph、站点地图、引用链接等绝对 URL 都从这里拼。
 * 规则与 scripts/generate-feed.mjs 等构建脚本一致:域名 + basePath
 * (CI 里 NEXT_PUBLIC_BASE_PATH=/BlogSite;本地构建不带 basePath,链接也不带)。
 * 换域名时设 NEXT_PUBLIC_SITE_URL(完整地址,含路径)。
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  `https://cyoungg06.github.io${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`
).replace(/\/+$/, "");

/** 不带协议的展示形式,如分享卡片底部的 cyoungg06.github.io/BlogSite */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");

/** 站内路径(含 locale,如 /zh/blog/lora/)→ 绝对 URL */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
