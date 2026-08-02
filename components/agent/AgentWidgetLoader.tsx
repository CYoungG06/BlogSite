"use client";

import dynamic from "next/dynamic";

/**
 * AgentWidget 懒加载入口:面板(含 react-markdown)不进首屏 HTML 与主 bundle,
 * 水合后异步加载;未配 NEXT_PUBLIC_AGENT_API 时组件自身返回 null。
 */
const AgentWidget = dynamic(() => import("./AgentWidget"), { ssr: false });

export default function AgentWidgetLoader() {
  return <AgentWidget />;
}
