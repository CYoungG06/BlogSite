"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_AGENT_API ?? "";

/** 页脚全站统计:总访问量 · 访客数;拉取失败则不渲染 */
export default function SiteStats() {
  const t = useTranslations("footer");
  const [stats, setStats] = useState<{ pv: number; uv: number } | null>(null);

  useEffect(() => {
    if (!API_BASE) return;
    fetch(`${API_BASE}/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.pv === "number" && typeof d.uv === "number") {
          setStats({ pv: d.pv, uv: d.uv });
        }
      })
      .catch(() => {});
  }, []);

  if (!API_BASE || !stats) return null;
  return (
    <span className="font-mono text-xs tabular-nums text-muted">
      {t("siteStats", {
        pv: stats.pv.toLocaleString(),
        uv: stats.uv.toLocaleString(),
      })}
    </span>
  );
}
