import type { Locale } from "@/i18n/routing";
import { getCollectionItem, getCollectionItems } from "./collection";
import { listAllSlugs } from "./content-loader";

export type Reading = ReturnType<typeof getReadings>[number];

export function getReadings(locale: Locale) {
  return getCollectionItems("reading", locale);
}

export function getReading(locale: Locale, slug: string) {
  return getCollectionItem("reading", locale, slug);
}

export function getReadingSlugs(): string[] {
  return listAllSlugs("reading");
}
