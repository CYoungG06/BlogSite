"use client";

import { useState, type ComponentProps } from "react";
import { BaseLink } from "@/i18n/navigation-base";

/**
 * 只在「有意图」时才预取的站内链接:悬停 / 聚焦 / 触摸之后才打开 Next 的预取
 * (prefetch 从 false 变回默认值时,Next 会重新挂载可见性监听,链接可见即开始预取)。
 * 默认行为是一进视口就预取整页数据 —— 速递归档页曾因此一次拉 80 多个请求、2 MB,
 * 导航里「研究」下拉的链接还让每个页面多下载一张 534 KB 的海报。
 * 通过 @/i18n/navigation 的 Link 导出,全站链接统一走这里。
 */
export default function IntentLink({
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: ComponentProps<typeof BaseLink>) {
  const [armed, setArmed] = useState(false);
  return (
    <BaseLink
      {...props}
      prefetch={armed ? null : false}
      onMouseEnter={(event) => {
        setArmed(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        setArmed(true);
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        setArmed(true);
        onTouchStart?.(event);
      }}
    />
  );
}
