import { ArrowLeft, ArrowSquareOut, GithubLogo } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import MDXContent from "@/components/mdx/MDXContent";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/format";
import {
  getDetailProjectSlugs,
  getProject,
  type Project,
} from "@/lib/projects";

/** hasDetail: true 的项目才生成详情页 */
export function generateStaticParams() {
  return getDetailProjectSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const project = getProject(locale, slug);
  if (!project) return {};
  return { title: project.title, description: project.description };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const project = getProject(locale, slug);
  if (!project || !project.hasDetail) notFound();

  const t = await getTranslations({ locale, namespace: "projects" });

  return (
    <Container>
      <div className="mx-auto max-w-3xl py-12">
        <ProjectHeader project={project} locale={locale} back={t("back")} />
        <div className="prose mt-10 max-w-none">
          <MDXContent source={project.content} />
        </div>
      </div>
    </Container>
  );
}

function ProjectHeader({
  project,
  locale,
  back,
}: {
  project: Project;
  locale: Locale;
  back: string;
}) {
  const t = useTranslations("projects");

  return (
    <header>
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:text-foreground"
      >
        <ArrowLeft size={13} />
        {back}
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tighter sm:text-4xl">
        {project.title}
      </h1>
      {project.date ? (
        <p className="mt-4 font-mono text-xs text-muted">
          <time dateTime={project.date}>
            {formatDate(project.date, locale)}
          </time>
        </p>
      ) : null}
      {project.description ? (
        <p className="mt-4 text-muted">{project.description}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {project.github ? (
          <a
            href={project.github}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-transform duration-300 ease-premium active:scale-[0.98]"
          >
            <GithubLogo size={15} />
            {t("source")}
          </a>
        ) : null}
        {project.live ? (
          <a
            href={project.live}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium ring-1 ring-hairline transition-colors duration-300 ease-premium hover:bg-foreground/5 active:scale-[0.98]"
          >
            <ArrowSquareOut size={15} />
            {t("live")}
          </a>
        ) : null}
      </div>
      {project.tags.length > 0 ? (
        <ul className="mt-6 flex flex-wrap gap-2">
          {project.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-surface px-2.5 py-0.5 font-mono text-xs text-muted ring-1 ring-hairline"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}
