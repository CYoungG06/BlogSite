import { GithubLogo } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Container from "./Container";

export default async function Footer() {
  const t = await getTranslations();
  const year = new Date().getFullYear();

  const navItems = [
    { href: "/blog", label: t("nav.blog") },
    { href: "/notes", label: t("nav.notes") },
    { href: "/projects", label: t("nav.projects") },
    { href: "/about", label: t("nav.about") },
  ];

  const moreItems = [
    { href: "/friends", label: t("nav.friends") },
    { href: "/search", label: t("footer.search") },
  ];

  return (
    <footer className="mt-16 border-t border-hairline">
      <Container className="py-12">
        <div className="grid gap-10 sm:grid-cols-3">
          <div>
            <p className="font-semibold tracking-tight">{t("site.name")}</p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
              {t("site.description")}
            </p>
          </div>
          <nav aria-label={t("footer.nav")}>
            <p className="font-mono text-xs text-muted">{t("footer.nav")}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {navItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-muted transition-colors duration-300 ease-premium hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="font-mono text-xs text-muted">{t("footer.more")}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {moreItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-muted transition-colors duration-300 ease-premium hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href="https://github.com/CYoungG06"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-muted transition-colors duration-300 ease-premium hover:text-foreground"
                >
                  <GithubLogo size={15} />
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>
        <p className="mt-10 border-t border-hairline pt-6 font-mono text-xs text-muted">
          {t("footer.copyright", { year, name: t("site.name") })}
        </p>
      </Container>
    </footer>
  );
}
