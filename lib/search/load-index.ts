import MiniSearch from "minisearch";
import { basePath } from "@/lib/images";
import { tokenize } from "./tokenize";

/**
 * 搜索索引加载(模块级缓存)——配置必须与 scripts/build-search-index.mjs
 * 一致,否则 loadJSON 反序列化会挂。HeaderSearch、/search 页与
 * AI 助手的 search_site 工具共用这一份。
 */
export const SEARCH_FIELDS = ["title", "description", "content", "tags"];
export const SEARCH_STORE_FIELDS = ["type", "slug", "title", "description"];

export interface SearchDocument {
  id: string;
  type: "post" | "note" | "distilled" | "reading";
  slug: string;
  title: string;
  description: string;
  content: string;
  tags: string;
}

export interface SearchResultItem {
  type: "post" | "note" | "distilled" | "reading";
  slug: string;
  title: string;
  description: string;
}

const indexCache = new Map<string, Promise<MiniSearch<SearchDocument>>>();

export function loadSearchIndex(
  locale: string,
): Promise<MiniSearch<SearchDocument>> {
  const cached = indexCache.get(locale);
  if (cached) return cached;
  const promise = fetch(`${basePath}/search-index/${locale}.json`)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`搜索索引加载失败:${response.status}`);
      }
      return response.text();
    })
    .then((json) =>
      MiniSearch.loadJSON<SearchDocument>(json, {
        fields: SEARCH_FIELDS,
        storeFields: SEARCH_STORE_FIELDS,
        tokenize,
      }),
    );
  indexCache.set(locale, promise);
  // 失败则移出缓存,给下次切换/重试留机会
  promise.catch(() => indexCache.delete(locale));
  return promise;
}
