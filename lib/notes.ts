import type { Locale } from "@/i18n/routing";
import { getCollectionItem, getCollectionItems } from "./collection";
import { listAllSlugs } from "./content-loader";
import { firstParagraphPreview } from "./markdown";

export interface Note {
  slug: string;
  locale: Locale;
  fallback: boolean;
  locales: Locale[];
  title: string;
  date: string;
  description: string;
  /** 列表预览:description,缺省取正文首段 160 字 */
  preview: string;
  tags: string[];
  draft: boolean;
  readingMinutes: number;
  content: string;
}

function withPreview(
  item: ReturnType<typeof getCollectionItems>[number],
): Note {
  return {
    ...item,
    preview: item.description || firstParagraphPreview(item.content),
  };
}

export function getNotes(locale: Locale): Note[] {
  return getCollectionItems("notes", locale).map(withPreview);
}

export function getNote(locale: Locale, slug: string): Note | null {
  const item = getCollectionItem("notes", locale, slug);
  return item ? withPreview(item) : null;
}

export function getNoteSlugs(): string[] {
  return listAllSlugs("notes");
}
