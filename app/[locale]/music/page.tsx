import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getMusic } from "@/lib/music";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "music" });
  return { title: t("title"), description: t("description") };
}

export default async function MusicPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "music" });
  const music = getMusic();

  return (
    <Container>
      <PageHeader title={t("title")} description={t("description")} />

      {/* 乐队档案 */}
      <section className="pb-12">
        <h2 className="font-mono text-xs text-muted">{t("profile")}</h2>
        <p className="mt-4 max-w-3xl leading-relaxed text-muted">
          {t("profileText")}
        </p>
      </section>

      {/* 网易云歌单嵌入 */}
      <section className="pb-12">
        <h2 className="font-mono text-xs text-muted">{t("playlist")}</h2>
        <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-hairline">
          <iframe
            title={t("playlist")}
            src={`https://music.163.com/outchain/player?type=0&id=${music.playlistId}&auto=0&height=430`}
            className="h-[430px] w-full border-0"
            loading="lazy"
          />
        </div>
      </section>

      {/* 代表曲目 */}
      <section className="pb-12">
        <h2 className="font-mono text-xs text-muted">{t("tracks")}</h2>
        <ul className="mt-4">
          {music.tracks.map((track) => (
            <li
              key={track.name}
              className="flex items-baseline gap-3 border-b border-hairline py-3 first:border-t"
            >
              <span className="w-10 shrink-0 font-mono text-xs text-muted">
                {track.year}
              </span>
              <span className="min-w-0 flex-1 font-medium tracking-tight">
                {track.name}
              </span>
              <span className="hidden shrink-0 text-sm text-muted sm:block">
                {locale === "zh" ? track.zhTitle : track.enTitle}
              </span>
              <span className="hidden shrink-0 text-xs text-muted md:block md:max-w-56 md:text-right">
                {locale === "zh" ? track.noteZh : track.noteEn}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* 唱片 */}
      <section className="pb-12">
        <h2 className="font-mono text-xs text-muted">{t("albums")}</h2>
        <ul className="mt-4">
          {music.albums.map((album) => (
            <li
              key={album.name}
              className="flex items-baseline gap-3 border-b border-hairline py-3 first:border-t"
            >
              <span className="w-20 shrink-0 font-mono text-xs text-muted">
                {album.date}
              </span>
              <span className="min-w-0 flex-1 font-medium tracking-tight">
                {album.name}
              </span>
              <span className="shrink-0 rounded-full bg-surface px-2.5 py-0.5 font-mono text-xs text-muted ring-1 ring-hairline">
                {t(`type.${album.type}`)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* 链接 */}
      <section className="pb-12">
        <h2 className="font-mono text-xs text-muted">{t("links")}</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {music.links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm ring-1 ring-hairline transition-colors duration-300 ease-premium hover:bg-foreground/5 active:scale-[0.98]"
              >
                {link.label}
                <ArrowUpRight
                  size={13}
                  className="text-muted transition-all duration-300 ease-premium group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent"
                />
              </a>
            </li>
          ))}
        </ul>
      </section>

      {/* 相关文章 */}
      <section className="pb-12">
        <h2 className="font-mono text-xs text-muted">{t("related")}</h2>
        <Link
          href="/blog/yorushika"
          className="group mt-4 flex items-baseline justify-between gap-4 border-b border-hairline py-4 first:border-t"
        >
          <span className="min-w-0 flex-1 truncate font-medium transition-colors duration-300 ease-premium group-hover:text-accent">
            Yorushika
          </span>
          <span className="shrink-0 font-mono text-xs text-muted">
            2024-12-31
          </span>
        </Link>
      </section>
    </Container>
  );
}
