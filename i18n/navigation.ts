/**
 * 站内导航 API。Link 是按意图预取的版本(components/IntentLink.tsx):
 * 默认的 next/link 一进视口就预取整页数据,列表页会因此一次拉几十个请求,
 * 还会顺带下载目标页的首屏大图。
 */
export { redirect, usePathname, useRouter, getPathname } from "./navigation-base";
export { default as Link } from "@/components/IntentLink";
