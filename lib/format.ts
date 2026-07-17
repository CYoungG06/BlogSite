import type { Locale } from "@/i18n/routing";

/** 本地化日期:zh → 2026年5月22日;en → May 22, 2026 */
export function formatDate(date: string | Date, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return String(date);
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: locale === "zh" ? "long" : "short",
    day: "numeric",
  }).format(d);
}

/** ISO 日期(YYYY-MM-DD),用于 <time dateTime> 与 mono 元信息行 */
export function isoDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return String(date);
  return d.toISOString().slice(0, 10);
}
