"use client";

import { useLocale } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import {
  loadSearchIndex,
  type SearchDocument,
  type SearchResultItem,
} from "@/lib/search/load-index";
import type MiniSearch from "minisearch";

/**
 * 共享搜索 hook — 见 DESIGN.md §5.2 / §6.3。
 * 顶栏 HeaderSearch 与 /search 独立页共用;索引加载见 lib/search/load-index.ts。
 */

export type { SearchResultItem };

/**
 * enabled=false 时不加载索引。索引是整站全文(压缩后约 250 KB),
 * 顶栏搜索在每个页面都挂载,所以要等用户真的打开搜索再拉。
 */
export function useSearch(enabled = true) {
  const locale = useLocale();
  const [index, setIndex] = useState<MiniSearch<SearchDocument> | null>(null);
  // 按 locale 记错误,切语言自然失效,不用在 effect 里同步重置
  const [errorLocale, setErrorLocale] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadSearchIndex(locale).then(
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
  }, [locale, enabled]);

  const error = errorLocale === locale;

  const search = useCallback(
    (query: string, limit = 20): SearchResultItem[] => {
      const trimmed = query.trim();
      if (!index || !trimmed) return [];
      return index
        .search(trimmed, { prefix: true, fuzzy: 0.15, combineWith: "AND" })
        .slice(0, limit)
        .map((result): SearchResultItem => {
          // storeFields 保证这些字段存在;SearchResult 的索引签名是 any,这里显式收窄
          const { type, slug, href, title, description } =
            result as unknown as SearchResultItem;
          return { type, slug, href, title, description };
        });
    },
    [index],
  );

  return { ready: index !== null, error, search };
}
