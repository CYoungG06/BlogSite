"use client";

import { useEffect } from "react";

/**
 * 鼠标探照灯:mousemove 时把坐标写到 <html> 的 --mx/--my 自定义属性上,
 * 不写 React state,零重渲染;触屏无 mousemove 自然不出现;
 * prefers-reduced-motion 不挂监听。
 */
export default function MouseSpotlight() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const root = document.documentElement;
    let raf = 0;
    const onMove = (event: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        root.style.setProperty("--mx", `${event.clientX}px`);
        root.style.setProperty("--my", `${event.clientY}px`);
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
