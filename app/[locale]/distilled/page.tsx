import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getDistilled } from "@/lib/distilled";
import { isoDate } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "distilled" });
  return { title: t("title"), description: t("description") };
}

/** 蒸馏列表:转载/译文,日期倒序,带来源徽章与转载声明 */
export default async function DistilledPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "distilled" });
  const items = getDistilled(locale);

  return (
    <Container>
      <PageHeader title={t("title")} description={t("description")} />
      <ul className="pb-8">
        {items.map((item) => (
          <li
            key={item.slug}
            className="border-b border-hairline first:border-t"
          >
            <Link
              href={`/distilled/${item.slug}`}
              className="group flex items-baseline gap-4 py-4"
            >
              <time
                dateTime={item.date}
                className="w-20 shrink-0 font-mono text-xs text-muted"
              >
                {isoDate(item.date)}
              </time>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium transition-colors duration-300 ease-premium group-hover:text-accent">
                  {item.title}
                </span>
                {item.source ? (
                  <span className="mt-1 block font-mono text-xs text-accent/80">
                    {t("fromSource", {
                      name: item.source.author ?? item.source.name ?? "",
                    })}
                  </span>
                ) : null}
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
      <p className="pb-16 font-mono text-xs text-muted">{t("disclaimer")}</p>
    </Container>
  );
}
