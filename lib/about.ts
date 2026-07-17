import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { routing, type Locale } from "@/i18n/routing";
import { CONTENT_ROOT } from "./content-loader";

export interface AboutContent {
  content: string;
  title: string;
  description: string;
}

/** content/about/{locale}.mdx,缺 locale 回退默认语言 */
export function getAbout(locale: Locale): AboutContent | null {
  const candidates = [locale, routing.defaultLocale];
  for (const candidate of candidates) {
    const file = path.join(CONTENT_ROOT, "about", `${candidate}.mdx`);
    if (fs.existsSync(file)) {
      const { data, content } = matter(fs.readFileSync(file, "utf8"));
      return {
        content,
        title: typeof data.title === "string" ? data.title : "",
        description:
          typeof data.description === "string" ? data.description : "",
      };
    }
  }
  return null;
}
