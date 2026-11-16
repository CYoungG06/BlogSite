"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 课件 iframe:通栏宽度,高度跟随课件内容(同源,直接量课件文档)。
 * 不让 iframe 自己出滚动条 —— 整页只有一个滚动条,读起来和普通文章一样。
 * 量 documentElement.offsetHeight 而不是 scrollHeight:后者不会小于 iframe 当前高度,
 * 内容变短(折叠、切换模拟)时就缩不回去。
 */
export default function LessonFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const attach = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      const fit = () => setHeight(Math.ceil(doc.documentElement.offsetHeight));
      fit();
      observer?.disconnect();
      observer = new ResizeObserver(fit);
      observer.observe(doc.body);
    };
    // iframe 可能在水合前就加载完了:先试一次,再等 load(真正的课件文档)
    if (frame.contentDocument?.readyState === "complete") attach();
    frame.addEventListener("load", attach);
    return () => {
      frame.removeEventListener("load", attach);
      observer?.disconnect();
    };
  }, [src]);

  return (
    <iframe
      ref={ref}
      src={src}
      title={title}
      className="block w-full border-0"
      style={{ height: height ?? "100vh" }}
    />
  );
}
