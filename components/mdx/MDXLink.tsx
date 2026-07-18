import type { ReactNode } from "react";
import { basePath } from "@/lib/images";

/**
 * 正文链接:站内绝对路径(如迁移文章的互链 /zh/blog/xxx)
 * 补 basePath 前缀,兼容 GitHub Pages 子路径部署;
 * 外链与锚点原样。
 */
export default function MDXLink({
  href,
  children,
  ...props
}: {
  href?: string;
  children?: ReactNode;
}) {
  if (href && href.startsWith("/") && !href.startsWith("//")) {
    return (
      <a href={`${basePath}${href}`} {...props}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
