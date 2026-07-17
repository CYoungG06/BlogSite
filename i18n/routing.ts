import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["zh", "en"],
  defaultLocale: "zh",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

export const localeNames: Record<Locale, string> = {
  zh: "中文",
  en: "English",
};

export function isLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}

export function assertLocale(value: string): Locale {
  if (!isLocale(value)) {
    throw new Error(`Invalid locale: ${value}`);
  }
  return value;
}
