"use client";

import { Check, Copy, DownloadSimple, Printer } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { basePath } from "@/lib/images";

/**
 * 内容导出按钮组:复制 Markdown / 下载 .md / 打印(浏览器另存 PDF)。
 * url 为构建期生成的导出文件路径(见 scripts/generate-export.mjs)。
 */
export default function ExportButtons({ url }: { url: string }) {
  const t = useTranslations("export");
  const [copied, setCopied] = useState(false);
  const full = `${basePath}${url}`;

  const copy = async () => {
    try {
      const res = await fetch(full);
      if (!res.ok) return;
      await navigator.clipboard.writeText(await res.text());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板或网络不可用时静默
    }
  };

  const btn =
    "inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:border-accent hover:text-accent";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={copy}
        aria-label={t("copy")}
        className={btn}
      >
        {copied ? (
          <Check size={12} className="text-accent" aria-hidden />
        ) : (
          <Copy size={12} aria-hidden />
        )}
        {copied ? t("copied") : t("copy")}
      </button>
      <a href={full} download className={btn}>
        <DownloadSimple size={12} aria-hidden />
        {t("download")}
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        aria-label={t("print")}
        className={btn}
      >
        <Printer size={12} aria-hidden />
        {t("print")}
      </button>
    </div>
  );
}
