"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export default function LanguageToggle() {
  const t = useTranslations("header");
  const locale = useLocale();
  const pathname = usePathname();
  const next = locale === "zh" ? "en" : "zh";

  return (
    <Link
      href={pathname}
      locale={next}
      aria-label={t("switchLanguage")}
      title={t("switchLanguage")}
      className="flex h-9 items-center justify-center rounded-full px-3 font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:text-foreground active:scale-[0.98]"
    >
      {locale === "zh" ? "EN" : "中"}
    </Link>
  );
}
