import { ArrowSquareOut, GithubLogo } from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { imageUrl } from "@/lib/images";
import type { Project } from "@/lib/projects";

/**
 * ProjectCard(Double-Bezel 嵌套):
 * 外壳 rounded-[1.75rem] bg-surface p-1.5 ring-hairline,
 * 内芯 rounded-[calc(...)] bg-background ring-hairline overflow-hidden;
 * hover 整体 -translate-y-0.5 + shadow-soft 浮现,封面 scale 1.02。
 * 标题是 stretched-link,GitHub/Live 是真实 <a>(relative z-10 抬升)。
 */
export default function ProjectCard({ project }: { project: Project }) {
  const t = useTranslations("projects");

  return (
    <div className="group relative rounded-[1.75rem] bg-surface p-1.5 ring-1 ring-hairline transition-all duration-500 ease-premium hover:-translate-y-0.5 hover:shadow-soft">
      <div className="overflow-hidden rounded-[calc(1.75rem-0.375rem)] bg-background ring-1 ring-hairline">
        {project.cover ? (
          <div className="overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl(project.cover)}
              alt={project.title}
              loading="lazy"
              className="aspect-[2/1] w-full object-cover transition-transform duration-500 ease-premium group-hover:scale-[1.02]"
            />
          </div>
        ) : null}
        <div className="p-5">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold tracking-tight">
              {project.hasDetail ? (
                <Link
                  href={`/projects/${project.slug}`}
                  className="transition-colors duration-300 ease-premium after:absolute after:inset-0 group-hover:text-accent"
                >
                  {project.title}
                </Link>
              ) : (
                project.title
              )}
            </h3>
            {project.featured ? (
              <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-[0.7rem] text-muted ring-1 ring-hairline">
                {t("featured")}
              </span>
            ) : null}
          </div>
          {project.description ? (
            <p className="mt-1.5 line-clamp-2 text-sm text-muted">
              {project.description}
            </p>
          ) : null}
          {project.tags.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
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
          {project.github || project.live ? (
            <div className="mt-4 flex items-center gap-4 text-sm">
              {project.github ? (
                <a
                  href={project.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative z-10 inline-flex items-center gap-1.5 text-muted transition-colors duration-300 ease-premium hover:text-foreground"
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
                  className="relative z-10 inline-flex items-center gap-1.5 text-muted transition-colors duration-300 ease-premium hover:text-foreground"
                >
                  <ArrowSquareOut size={15} />
                  {t("live")}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
