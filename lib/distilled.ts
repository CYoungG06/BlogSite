import type { Locale } from "@/i18n/routing";
import { getCollectionItem, getCollectionItems } from "./collection";
import { listAllSlugs } from "./content-loader";

export type Distilled = ReturnType<typeof getDistilled>[number];

export function getDistilled(locale: Locale) {
  return getCollectionItems("distilled", locale);
}

export function getDistilledItem(locale: Locale, slug: string) {
  return getCollectionItem("distilled", locale, slug);
}

export function getDistilledSlugs(): string[] {
  return listAllSlugs("distilled");
}
