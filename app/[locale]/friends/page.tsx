import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import GiscusComments from "@/components/Giscus";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { routing } from "@/i18n/routing";
import { getFriends } from "@/lib/friends";
import { getGiscusConfig } from "@/lib/giscus";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "friends" });
  return { title: t("title"), description: t("description") };
}

export default async function FriendsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "friends" });
  const friends = getFriends();
  const giscus = getGiscusConfig();

  return (
    <Container>
      <PageHeader title={t("title")} description={t("description")} />
      <ul className="grid gap-4 sm:grid-cols-2">
        {friends.map((friend) => (
          <li key={friend.url}>
            <a
              href={friend.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col rounded-3xl p-5 ring-1 ring-hairline transition-all duration-500 ease-premium hover:-translate-y-0.5 hover:shadow-soft"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold tracking-tight">
                  {friend.name}
                </span>
                <ArrowUpRight
                  size={15}
                  aria-hidden
                  className="shrink-0 text-muted transition-all duration-300 ease-premium group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent"
                />
              </span>
              {friend.description ? (
                <span className="mt-1.5 text-sm text-muted">
                  {friend.description}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>

      <section className="mt-16 pb-12">
        <h2 className="font-mono text-xs text-muted">{t("comments")}</h2>
        <div className="mt-4">
          {giscus ? (
            <GiscusComments config={giscus} />
          ) : (
            <div className="rounded-2xl bg-surface px-5 py-4 ring-1 ring-hairline">
              <p className="text-sm font-medium">
                {t("giscusNotConfigured")}
              </p>
              <p className="mt-1 text-sm text-muted">{t("giscusHint")}</p>
            </div>
          )}
        </div>
      </section>
    </Container>
  );
}
