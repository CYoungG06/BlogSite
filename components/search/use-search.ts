"use client";

import MiniSearch from "minisearch";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { basePath } from "@/lib/images";
import { tokenize } from "@/lib/search/tokenize";

/**
 * 共享搜索 hook — 见 DESIGN.md §5.2 / §6.3。
 * 顶栏 HeaderSearch 与 /search 独立页共用;索引模块级缓存,
 * 同 locale 只 fetch + 反序列化一次。
 */

/** 必须与 scripts/build-search-index.mjs 的索引配置一致,否则 loadJSON 反序列化会挂 */
const FIELDS = ["title", "description", "content", "tags"];
const STORE_FIELDS = ["type", "slug", "title", "description"];

interface SearchDocument {
  id: string;
  type: "post" | "note" | "distilled";
  slug: string;
  title: string;
  description: string;
  content: string;
  tags: string;
}

export interface SearchResultItem {
  type: "post" | "note" | "distilled";
  slug: string;
  title: string;
  description: string;
}

const indexCache = new Map<string, Promise<MiniSearch<SearchDocument>>>();

function loadIndex(locale: string): Promise<MiniSearch<SearchDocument>> {
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
        fields: FIELDS,
        storeFields: STORE_FIELDS,
        tokenize,
      }),
    );
  indexCache.set(locale, promise);
  // 失败则移出缓存,给下次切换/重试留机会
  promise.catch(() => indexCache.delete(locale));
  return promise;
}

export function useSearch() {
  const locale = useLocale();
  const [index, setIndex] = useState<MiniSearch<SearchDocument> | null>(null);
  // 按 locale 记错误,切语言自然失效,不用在 effect 里同步重置
  const [errorLocale, setErrorLocale] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadIndex(locale).then(
      (loaded) => {
        if (!cancelled) setIndex(loaded);
      },
      () => {
        if (!cancelled) setErrorLocale(locale);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const error = errorLocale === locale;

  const search = useCallback(
    (query: string, limit = 20): SearchResultItem[] => {
      const trimmed = query.trim();
      if (!index || !trimmed) return [];
      return index
        .search(trimmed, { prefix: true, fuzzy: 0.15, combineWith: "AND" })
        .slice(0, limit)
        .map((result): SearchResultItem => {
          // storeFields 保证这四个字段存在;SearchResult 的索引签名是 any,这里显式收窄
          const { type, slug, title, description } =
            result as unknown as SearchResultItem;
          return { type, slug, title, description };
        });
    },
    [index],
  );

  return { ready: index !== null, error, search };
}
