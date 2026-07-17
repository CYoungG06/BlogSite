import type { ReactNode } from "react";

/**
 * 根 layout 是透传空壳:
 * - `/` 由 app/(root)/layout.tsx 提供 <html>/<body>
 * - `/{locale}/...` 由 app/[locale]/layout.tsx 提供 <html>/<body>
 * - 404 由 app/not-found.tsx 自带 <html>/<body>
 */
export default function PassthroughLayout({ children }: { children: ReactNode }) {
  return children;
}
