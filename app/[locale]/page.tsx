import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import NoteCard from "@/components/notes/NoteCard";
import ProjectCard from "@/components/projects/ProjectCard";
import Container from "@/components/layout/Container";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { isoDate } from "@/lib/format";
import { getNotes } from "@/lib/notes";
import { getLatestDigest, isRelevant } from "@/lib/papers";
import { getPosts, type Post } from "@/lib/posts";
import { getProjects } from "@/lib/projects";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site" });
  // 标题走 layout 的 default,避免 template 拼成 "站名 · 站名"
  return { description: t("description") };
}

/** 首页:Hero → 最近文章 → 最新笔记 → 精选项目,全部条件渲染 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale });
  const allPosts = getPosts(locale);
  const featuredPosts = allPosts.filter((post) => post.featured);
  // 精选已在上面单独展示,最近文章排除避免重复
  const posts = allPosts.filter((post) => !post.featured).slice(0, 5);
  const notes = getNotes(locale).slice(0, 4);
  const projects = getProjects(locale)
    .filter((project) => project.featured)
    .slice(0, 2);
  // 论文速递:最新一期,HF 热门(已按 upvotes 排序)优先,arXiv 补足 5 条;
  // 只取 AI 判定相关的论文
  const digest = getLatestDigest();
  const paperItems = digest
    ? [...digest.hf, ...digest.arxiv].filter(isRelevant).slice(0, 5)
    : [];

  const stagger = (index: number) =>
    ({ "--stagger": `${index * 100}ms` }) as CSSProperties;

  return (
    <Container>
      {/* Hero */}
      <section className="py-16 sm:py-24">
        <p
          className="animate-fade-up mb-6 inline-flex items-center rounded-full bg-surface px-3 py-1 font-mono text-xs text-muted ring-1 ring-hairline"
          style={stagger(0)}
        >
          {t("home.construction")}
        </p>
        <h1
          className="animate-fade-up max-w-3xl text-4xl font-semibold tracking-tighter sm:text-5xl"
          style={stagger(1)}
        >
          {t("home.heroTitle")}
          {/* 竖条光标:em 尺寸跟随标题字号 */}
          <span
            aria-hidden
            className="animate-blink ml-[0.1em] inline-block h-[0.82em] w-[0.09em] translate-y-[0.1em] rounded-[1px] bg-accent"
          />
        </h1>
        <p
          className="animate-fade-up mt-5 max-w-2xl text-muted"
          style={stagger(2)}
        >
          {t("home.heroSubtitle")}
        </p>
        <div className="animate-fade-up mt-8 flex gap-3" style={stagger(3)}>
          <Link
            href="/blog"
            className="group inline-flex h-12 items-center gap-3 rounded-full bg-foreground pr-2 pl-6 text-sm font-medium text-background transition-transform duration-300 ease-premium active:scale-[0.98]"
          >
            {t("home.primaryCta")}
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/15 transition-transform duration-300 ease-premium group-hover:translate-x-0.5 group-hover:scale-105">
              <ArrowRight size={15} />
            </span>
          </Link>
          <Link
            href="/about"
            className="inline-flex h-12 items-center rounded-full px-6 text-sm font-medium ring-1 ring-hairline transition-colors duration-300 ease-premium hover:bg-foreground/5 active:scale-[0.98]"
          >
            {t("home.secondaryCta")}
          </Link>
        </div>
      </section>

      {/* 文章:md 以上两栏(精选 | 最近),共用一个区块头,紧凑排版 */}
      {featuredPosts.length > 0 || posts.length > 0 ? (
        <section className="animate-fade-up py-16" style={stagger(4)}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold tracking-tight">
              {t("home.posts")}
            </h2>
            <Link
              href="/blog"
              className="group inline-flex items-center gap-1 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:text-foreground"
            >
              {t("home.viewAll")}
              <ArrowUpRight
                size={13}
                className="transition-transform duration-300 ease-premium group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </div>
          <div className="grid gap-x-10 md:grid-cols-2">
            {featuredPosts.length > 0 ? (
              <div>
                <p className="mt-6 font-mono text-xs text-muted">
                  {t("home.featuredPosts")}
                </p>
                <PostRows posts={featuredPosts} compact />
              </div>
            ) : null}
            {posts.length > 0 ? (
              <div>
                <p className="mt-6 font-mono text-xs text-muted">
                  {t("home.latestPosts")}
                </p>
                <PostRows posts={posts} compact />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 论文速递:最新一期 Top5,行内外链 arXiv,区块头链归档 */}
      {digest && paperItems.length > 0 ? (
        <section className="animate-fade-up py-16" style={stagger(5)}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold tracking-tight">
              {t("home.papers")}
            </h2>
            <Link
              href="/papers"
              className="group inline-flex items-center gap-1 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:text-foreground"
            >
              {t("home.viewAll")}
              <ArrowUpRight
                size={13}
                className="transition-transform duration-300 ease-premium group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </div>
          <p className="mt-6 font-mono text-xs text-muted">{digest.date}</p>
          <ul className="mt-3">
            {paperItems.map((paper) => (
              <li
                key={paper.id}
                className="border-b border-hairline first:border-t"
              >
                <a
                  href={paper.urls.abs}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-baseline gap-3 py-3"
                >
                  {paper.upvotes ? (
                    <span className="w-12 shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-center font-mono text-xs text-accent">
                      ▲ {paper.upvotes}
                    </span>
                  ) : (
                    <span className="w-12 shrink-0 font-mono text-xs text-muted">
                      {paper.primaryCategory}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium transition-colors duration-300 ease-premium group-hover:text-accent">
                    {locale === "zh" && paper.titleZh
                      ? paper.titleZh
                      : paper.title}
                  </span>
                  <ArrowUpRight
                    size={15}
                    aria-hidden
                    className="shrink-0 -translate-x-1 self-center text-accent opacity-0 transition-all duration-300 ease-premium group-hover:translate-x-0 group-hover:opacity-100"
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 最新笔记:银灰 Double-Bezel 面板 */}
      {notes.length > 0 ? (
        <section className="animate-fade-up py-16" style={stagger(6)}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold tracking-tight">
              {t("home.latestNotes")}
            </h2>
            <Link
              href="/notes"
              className="group inline-flex items-center gap-1 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:text-foreground"
            >
              {t("home.viewAll")}
              <ArrowUpRight
                size={13}
                className="transition-transform duration-300 ease-premium group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </div>
          <div className="mt-6 rounded-[1.75rem] bg-surface p-1.5 ring-1 ring-hairline">
            <div className="rounded-[calc(1.75rem-0.375rem)] bg-background px-6 ring-1 ring-hairline">
              {notes.map((note) => (
                <NoteCard key={note.slug} note={note} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* 精选项目:2 列卡片 */}
      {projects.length > 0 ? (
        <section className="animate-fade-up py-16" style={stagger(7)}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold tracking-tight">
              {t("home.featuredProjects")}
            </h2>
            <Link
              href="/projects"
              className="group inline-flex items-center gap-1 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:text-foreground"
            >
              {t("home.viewAll")}
              <ArrowUpRight
                size={13}
                className="transition-transform duration-300 ease-premium group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {projects.map((project) => (
              <ProjectCard key={project.slug} project={project} />
            ))}
          </div>
        </section>
      ) : null}
    </Container>
  );
}

/** 文章行:mono 日期列 + 标题 + hover 箭头(精选/最近共用;compact 收紧行距) */
function PostRows({
  posts,
  compact = false,
}: {
  posts: Post[];
  compact?: boolean;
}) {
  return (
    <ul className={compact ? "mt-3" : "mt-6"}>
      {posts.map((post) => (
        <li key={post.slug} className="border-b border-hairline first:border-t">
          <Link
            href={`/blog/${post.slug}`}
            className={`group flex items-baseline ${compact ? "gap-3 py-3" : "gap-4 py-4"}`}
          >
            <time
              dateTime={post.date}
              className="w-20 shrink-0 font-mono text-xs text-muted"
            >
              {isoDate(post.date)}
            </time>
            <span className="min-w-0 flex-1 truncate font-medium transition-colors duration-300 ease-premium group-hover:text-accent">
              {post.title}
            </span>
            <ArrowUpRight
              size={15}
              aria-hidden
              className="shrink-0 -translate-x-1 self-center text-accent opacity-0 transition-all duration-300 ease-premium group-hover:translate-x-0 group-hover:opacity-100"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
