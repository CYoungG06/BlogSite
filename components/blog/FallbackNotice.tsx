import { useTranslations } from "next-intl";
import { localeNames, type Locale } from "@/i18n/routing";

/** 缺 locale 时的降级提示面板(中性色,rounded-2xl) */
export default function FallbackNotice({
  expected,
  actual,
  namespace,
}: {
  expected: Locale;
  actual: Locale;
  namespace: "blog" | "notes";
}) {
  const t = useTranslations(namespace);
  return (
    <p className="rounded-2xl bg-surface px-5 py-4 text-sm text-muted ring-1 ring-hairline">
      {t("fallbackNotice", {
        expected: localeNames[expected],
        actual: localeNames[actual],
      })}
    </p>
  );
}
