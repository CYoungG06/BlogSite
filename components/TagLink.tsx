import { Link } from "@/i18n/navigation";

/** 标签胶囊:点开是归档页按该标签筛选的列表 */
export default function TagLink({ tag, className = "" }: { tag: string; className?: string }) {
  return (
    <Link
      href={{ pathname: "/archive", query: { tag } }}
      className={`rounded-full bg-surface px-2.5 py-0.5 font-mono text-xs text-muted ring-1 ring-hairline transition-colors duration-300 ease-premium hover:text-accent hover:ring-accent/40 ${className}`}
    >
      {tag}
    </Link>
  );
}
