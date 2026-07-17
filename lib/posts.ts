import type { Locale } from "@/i18n/routing";
import { getCollectionItem, getCollectionItems } from "./collection";
import { listAllSlugs } from "./content-loader";

export type Post = ReturnType<typeof getPosts>[number];

export function getPosts(locale: Locale) {
  return getCollectionItems("blog", locale);
}

export function getPost(locale: Locale, slug: string) {
  return getCollectionItem("blog", locale, slug);
}

export function getPostSlugs(): string[] {
  return listAllSlugs("blog");
}
