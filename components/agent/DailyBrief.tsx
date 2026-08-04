"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { basePath } from "@/lib/images";

/**
 * 每日快报卡:面板空状态时,在欢迎语下方展示最新一期速递焦点(Top3)。
 * 点击论文 = 以「详细说说这篇」自动发问。仅在面板首次打开时拉取一次。
 */

interface BriefPaper {
  id: string;
  title: string;
  titleZh?: string;
  score?: number;
  upvotes?: number;
  relevant?: boolean;
}

interface Brief {
  date: string;
  papers: BriefPaper[];
}

export default function DailyBrief({
  onAsk,
}: {
  onAsk: (prompt: string) => void;
}) {
  const t = useTranslations("agent");
  const [brief, setBrief] = useState<Brief | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const indexRes = await fetch(`${basePath}/api/papers/index.json`);
        if (!indexRes.ok) return;
        const index = await indexRes.json();
        const latest: string | undefined = index.latest;
        if (!latest) return;
        const digestRes = await fetch(`${basePath}/api/papers/${latest}.json`);
        if (!digestRes.ok) return;
        const digest = await digestRes.json();
        const papers: BriefPaper[] = [...(digest.hf ?? []), ...(digest.arxiv ?? [])]
          .filter((p: BriefPaper) => p.relevant !== false)
          .slice(0, 3);
        if (!cancelled && papers.length) setBrief({ date: latest, papers });
      } catch {
        // 网络失败静默,快报只是锦上添花
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!brief) return null;

  return (
    <div className="rounded-xl border border-hairline px-3 py-2.5">
      <p className="flex items-baseline justify-between font-mono text-xs text-muted">
        <span>{t("dailyBriefTitle")}</span>
        <span>{brief.date}</span>
      </p>
      <ul className="mt-2 space-y-1">
        {brief.papers.map((paper) => (
          <li key={paper.id}>
            <button
              type="button"
              onClick={() =>
                onAsk(t("paperDetailAsk", { title: paper.titleZh ?? paper.title }))
              }
              className="group flex w-full items-baseline gap-2 rounded-md px-1 py-1 text-left transition-colors duration-300 ease-premium hover:bg-accent/5"
            >
              {typeof paper.score === "number" ? (
                <span className="shrink-0 font-mono text-[0.7rem] text-accent">
                  ★{paper.score}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-xs leading-relaxed transition-colors duration-300 ease-premium group-hover:text-accent">
                {paper.titleZh ?? paper.title}
              </span>
              <ArrowRight
                size={11}
                aria-hidden
                className="shrink-0 self-center text-muted opacity-0 transition-opacity duration-300 ease-premium group-hover:opacity-100"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
