"use client";

import { Check, Copy, Quotes } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * 「引用本文」BibTeX 块:展示生成的 BibTeX,一键复制。
 * citation key 取 站点名+年份+slug 首段;Accessed 日期按访问当天生成;
 * 蒸馏(转载翻译)文章在 note 里标注原文出处。
 */
export default function CiteBlock({
  title,
  url,
  date,
  sourceName,
}: {
  title: string;
  /** 文章绝对 URL */
  url: string;
  /** 文章发布日期 YYYY-MM-DD */
  date: string;
  /** 蒸馏文的原文来源名(可选) */
  sourceName?: string;
}) {
  const t = useTranslations("export");
  const [copied, setCopied] = useState(false);

  const [year, month] = date.split("-");
  const today = new Date().toISOString().slice(0, 10);
  const slugToken = url.replace(/\/$/, "").split("/").pop()?.split("-")[0] ?? "post";
  const key = `acane${year}${slugToken}`;
  const noteParts = [`Accessed: ${today}`];
  if (sourceName) noteParts.push(`Chinese translation of ${sourceName}`);

  const bibtex = `@misc{${key},
  author = {{Relativity Acane}},
  title = {${title}},
  year = {${year}},
  month = {${Number(month)}},
  howpublished = {\\url{${url}}},
  note = {${noteParts.join("; ")}}
}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bibtex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默
    }
  };

  return (
    <section aria-label={t("cite")} className="mt-10 rounded-xl border border-hairline bg-surface/60 px-4 py-3.5">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 font-mono text-xs text-muted">
          <Quotes size={13} aria-hidden />
          {t("cite")}
        </p>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-full border border-hairline px-2.5 py-1 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:border-accent hover:text-accent"
        >
          {copied ? (
            <Check size={12} className="text-accent" aria-hidden />
          ) : (
            <Copy size={12} aria-hidden />
          )}
          {copied ? t("copied") : t("copyBib")}
        </button>
      </div>
      <pre className="mt-3 overflow-x-auto font-mono text-[0.72rem] leading-relaxed text-muted select-all">
        {bibtex}
      </pre>
    </section>
  );
}
