import type { ReactNode } from "react";

/** 页头:标题 + 描述;children(操作按钮、订阅链接等)放在页头内部,不另起一段留白 */
export default function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="py-12 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tighter sm:text-4xl">
        {title}
      </h1>
      {description ? (
        <p className="mt-3 max-w-2xl text-muted">{description}</p>
      ) : null}
      {children}
    </header>
  );
}
