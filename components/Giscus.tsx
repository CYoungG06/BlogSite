"use client";

import Giscus from "@giscus/react";
import { useLocale } from "next-intl";
import { useTheme } from "next-themes";
import type { GiscusConfig } from "@/lib/giscus";
import { useMounted } from "@/lib/use-mounted";

export default function GiscusComments({ config }: { config: GiscusConfig }) {
  const { resolvedTheme } = useTheme();
  const locale = useLocale();
  // giscus widget 只在水合后渲染(resolvedTheme 也需要客户端值)
  const mounted = useMounted();

  if (!mounted) return null;

  return (
    <Giscus
      repo={config.repo as `${string}/${string}`}
      repoId={config.repoId}
      category={config.category}
      categoryId={config.categoryId}
      mapping="pathname"
      reactionsEnabled="1"
      emitMetadata="0"
      inputPosition="top"
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      lang={locale === "zh" ? "zh-CN" : "en"}
      loading="lazy"
    />
  );
}
