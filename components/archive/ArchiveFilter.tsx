"use client";

import { useSearchParams } from "next/navigation";
import ArchiveList, { type ArchiveRow } from "./ArchiveList";

/** 读 ?tag= 交给 ArchiveList 筛选。静态导出时须包在 Suspense 里(fallback 是不筛选的完整列表) */
export default function ArchiveFilter({
  rows,
  tags,
}: {
  rows: ArchiveRow[];
  tags: { tag: string; count: number }[];
}) {
  const selected = useSearchParams().get("tag");
  return <ArchiveList rows={rows} tags={tags} selected={selected} />;
}
