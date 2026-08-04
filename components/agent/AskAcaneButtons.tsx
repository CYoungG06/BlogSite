"use client";

import { Sparkle } from "@phosphor-icons/react";
import { openAgent } from "@/lib/agent/bus";

/**
 * 情境化入口按钮组:文章页底部「帮我总结 / 出题考考我」、
 * 速递页「按口味筛一遍」等。label/prompt 由服务端组件用 i18n 组好传入。
 */
export interface AskItem {
  label: string;
  prompt: string;
}

export default function AskAcaneButtons({
  heading,
  items,
}: {
  heading?: string;
  items: AskItem[];
}) {
  return (
    <div>
      {heading ? (
        <p className="flex items-center gap-1.5 font-mono text-xs text-muted">
          <Sparkle size={12} className="text-accent" aria-hidden />
          {heading}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => openAgent({ prompt: item.prompt })}
            className="rounded-full border border-hairline px-3.5 py-1.5 text-sm text-muted transition-colors duration-300 ease-premium hover:border-accent hover:text-accent"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
