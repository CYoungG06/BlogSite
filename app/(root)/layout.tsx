import type { ReactNode } from "react";

/**
 * 根路径 `/` 的独立最小 root layout(自带 <html>/<body>)。
 * 只做语言检测重定向,不加载全站样式与组件。
 */
export default function RootRedirectLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
