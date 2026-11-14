import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import Analytics from "@/components/Analytics";
import AgentWidgetLoader from "@/components/agent/AgentWidgetLoader";
import SelectionAsk from "@/components/agent/SelectionAsk";
import MouseSpotlight from "@/components/MouseSpotlight";
import PvBeacon from "@/components/PvBeacon";
import ThemeProvider from "@/components/ThemeProvider";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { routing } from "@/i18n/routing";
import { DEFAULT_OG_IMAGE, feedLinks } from "@/lib/metadata";
import { SITE_URL } from "@/lib/site";
import "katex/dist/katex.min.css";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site" });
  const lang = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  // 页面没有自己设置的部分(分享卡片、RSS 发现链接)都用这里的默认值,见 lib/metadata.ts
  return {
    metadataBase: new URL(`${SITE_URL}/`),
    title: {
      default: t("title"),
      template: `%s · ${t("name")}`,
    },
    description: t("description"),
    alternates: { types: feedLinks(lang) },
    openGraph: {
      type: "website",
      siteName: t("name"),
      locale: lang === "zh" ? "zh_CN" : "en_US",
      images: [DEFAULT_OG_IMAGE],
    },
    twitter: { card: "summary_large_image", images: [DEFAULT_OG_IMAGE.url] },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body>
        <NextIntlClientProvider>
          <ThemeProvider>
            <MouseSpotlight />
            <Header />
            <main>{children}</main>
            <Footer />
            <AgentWidgetLoader />
            <SelectionAsk />
          </ThemeProvider>
          <Analytics />
          <PvBeacon />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
