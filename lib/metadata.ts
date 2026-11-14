import type { Metadata } from "next";
import { routing, type Locale } from "@/i18n/routing";
import { absoluteUrl } from "./site";

/**
 * 页面元数据的统一出口:canonical、hreflang、RSS 发现链接、分享卡片(Open Graph / Twitter)。
 * Next 合并 metadata 时 openGraph / alternates 是整块覆盖的,所以每个页面都要带全,
 * 不能只写差异 —— 页面里一律调用 pageMetadata()。
 */

const OG_LOCALE: Record<Locale, string> = { zh: "zh_CN", en: "en_US" };
const HREFLANG: Record<Locale, string> = { zh: "zh-CN", en: "en" };

export const DEFAULT_OG_IMAGE = {
  url: absoluteUrl("/og/default.png"),
  width: 1200,
  height: 630,
};

/** 全站 RSS:文章 + 论文速递(<link rel="alternate">,阅读器可自动发现) */
export function feedLinks(locale: Locale) {
  return {
    "application/rss+xml": [
      { url: absoluteUrl("/rss.xml"), title: locale === "zh" ? "相对性阿卡内 · 文章" : "Relativity Acane · Articles" },
      { url: absoluteUrl("/feed.xml"), title: locale === "zh" ? "相对性阿卡内 · 论文速递" : "Relativity Acane · Daily Papers" },
    ],
  };
}

export interface PageMetaInput {
  locale: Locale;
  /** 站内路径,不含 locale、带结尾斜杠,如 /blog/lora/ */
  path: string;
  title?: string;
  description?: string;
  /** 页面内容实际的语言:英文站回退显示中文原文时传 zh,canonical 指向中文页 */
  contentLocale?: Locale;
  /** 该路径在哪些语言下有自己的内容(hreflang);缺省为全部语言 */
  locales?: readonly Locale[];
  type?: "website" | "article";
  publishedTime?: string;
  tags?: string[];
}

export function pageMetadata({
  locale,
  path,
  title,
  description,
  contentLocale,
  locales = routing.locales,
  type = "website",
  publishedTime,
  tags,
}: PageMetaInput): Metadata {
  const url = absoluteUrl(`/${locale}${path}`);
  const canonical = absoluteUrl(`/${contentLocale ?? locale}${path}`);
  const languages = Object.fromEntries(
    locales.map((l) => [HREFLANG[l], absoluteUrl(`/${l}${path}`)]),
  );
  const siteName = locale === "zh" ? "相对性阿卡内" : "Relativity Acane";
  return {
    title,
    description,
    alternates: { canonical, languages, types: feedLinks(locale) },
    openGraph: {
      type,
      url,
      siteName,
      locale: OG_LOCALE[locale],
      title: title ?? siteName,
      description,
      images: [DEFAULT_OG_IMAGE],
      ...(type === "article" ? { publishedTime, tags } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: title ?? siteName,
      description,
      images: [DEFAULT_OG_IMAGE.url],
    },
  };
}
