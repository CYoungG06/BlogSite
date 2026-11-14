import type { MetadataRoute } from "next";
import { routing, type Locale } from "@/i18n/routing";
import { getCollectionItems } from "@/lib/collection";
import type { Collection } from "@/lib/content-loader";
import { getAllInsights } from "@/lib/insights";
import { getDigest, getDigestDates } from "@/lib/papers";
import { getProjects } from "@/lib/projects";
import { getResearchWorkSlugs } from "@/lib/research";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-static";

const STATIC_PAGES = [
  "/",
  "/blog/",
  "/distilled/",
  "/reading/",
  "/notes/",
  "/papers/",
  "/research/",
  "/projects/",
  "/archive/",
  "/about/",
  "/music/",
  "/friends/",
];
const COLLECTIONS: Collection[] = ["blog", "distilled", "reading", "notes"];

/**
 * 站点地图(构建期生成 sitemap.xml)。只列 canonical 地址:
 * 英文站回退显示中文原文的文章、只有中文的深度解读,只列中文页。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const urls: MetadataRoute.Sitemap = [];
  const add = (locale: Locale, path: string, lastModified?: string) =>
    urls.push({ url: absoluteUrl(`/${locale}${path}`), ...(lastModified ? { lastModified } : {}) });

  for (const locale of routing.locales) {
    for (const path of STATIC_PAGES) add(locale, path);
    for (const kind of COLLECTIONS) {
      for (const item of getCollectionItems(kind, locale)) {
        if (!item.fallback) add(locale, `/${kind}/${item.slug}/`, item.date);
      }
    }
    for (const date of getDigestDates()) {
      add(locale, `/papers/${date}/`, getDigest(date)?.generatedAt);
    }
    for (const slug of getResearchWorkSlugs()) add(locale, `/research/${slug}/`);
    for (const project of getProjects(locale)) {
      if (project.hasDetail) add(locale, `/projects/${project.slug}/`, project.date ?? undefined);
    }
  }
  for (const insight of getAllInsights()) {
    add("zh", `/papers/insights/${insight.paperId}/`, insight.date);
  }
  return urls;
}
