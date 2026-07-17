import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/format";
import type { Post } from "@/lib/posts";
import type { Locale } from "@/i18n/routing";

/**
 * PostCard:发丝行,mono 元信息行 + 标题 + 摘要 + 中性 pill 标签;
 * hover 标题变 accent + 右侧 ArrowUpRight 淡入位移。
 */
export default function PostCard({
  post,
  locale,
}: {
  post: Post;
  locale: Locale;
}) {
  const t = useTranslations("blog");

  return (
    <article className="group relative border-b border-hairline py-8">
      <p className="font-mono text-xs text-muted">
        <time dateTime={post.date}>{formatDate(post.date, locale)}</time>
        {" · "}
        {t("readingTime", { minutes: post.readingMinutes })}
      </p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight">
        <Link
          href={`/blog/${post.slug}`}
          className="transition-colors duration-300 ease-premium after:absolute after:inset-0 group-hover:text-accent"
        >
          {post.title}
        </Link>
      </h2>
      {post.description ? (
        <p className="mt-2 line-clamp-2 text-muted">{post.description}</p>
      ) : null}
      {post.tags.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-surface px-2.5 py-0.5 font-mono text-xs text-muted ring-1 ring-hairline"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
      <ArrowUpRight
        size={18}
        aria-hidden
        className="absolute top-8 right-1 -translate-x-1 translate-y-1 text-accent opacity-0 transition-all duration-300 ease-premium group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100"
      />
    </article>
  );
}
