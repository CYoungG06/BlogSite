import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import DigestToc, { type TocItem } from "@/components/papers/DigestToc";
import PaperCard from "@/components/papers/PaperCard";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  getDigest,
  getDigestDates,
  isRelevant,
  type PaperItem,
} from "@/lib/papers";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getDigestDates().map((date) => ({ locale, date })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; date: string }>;
}): Promise<Metadata> {
  const { locale, date } = await params;
  const t = await getTranslations({ locale, namespace: "papers" });
  return { title: t("digestTitle", { date }) };
}

/** 分区标题:大标题 + 计数 + 分隔线,页面内的视觉锚点 */
function SectionHeader({ label, count }: { label: string; count: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-hairline pb-3">
      <h2 className="text-xl font-semibold tracking-tight">{label}</h2>
      <span className="font-mono text-xs text-muted">{count}</span>
    </div>
  );
}

/** 单日速递:今日焦点(Top3 HF 面板)→ HF 热门 → arXiv 新论文(分组),底部期号导航;宽屏右侧 sticky 索引 */
export default async function PaperDigestPage({
  params,
}: {
  params: Promise<{ locale: string; date: string }>;
}) {
  const { locale, date } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const digest = getDigest(date);
  if (!digest) notFound();

  const t = await getTranslations({ locale, namespace: "papers" });
  const cardT = {
    code: t("code"),
    project: t("project"),
    etAl: t("etAl"),
  };

  // 相关性过滤:正文只显示相关论文,被过滤的收进底部折叠区
  const hfRel = digest.hf.filter(isRelevant);
  const arxivRel = digest.arxiv.filter(isRelevant);
  const filtered = [...digest.hf, ...digest.arxiv].filter((p) => !isRelevant(p));

  // 今日焦点:HF 榜前 3,面板突出;其余 HF 进入常规列表
  const focus = hfRel.slice(0, 3);
  const hfRest = hfRel.slice(3);

  // 保持 JSON 中分类声明的顺序,只展示实际有论文的分类
  const byCategory = new Map<string, PaperItem[]>();
  for (const paper of arxivRel) {
    const cat = paper.primaryCategory ?? "other";
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), paper]);
  }
  const groups = [
    ...digest.categories.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !digest.categories.includes(c)),
  ];

  // 侧边索引项(与实际渲染的分区一一对应)
  const tocItems: TocItem[] = [];
  if (focus.length > 0) tocItems.push({ id: "focus", label: t("focus") });
  if (hfRel.length > 0) tocItems.push({ id: "hf", label: t("hfSection") });
  if (arxivRel.length > 0) {
    tocItems.push({ id: "arxiv", label: t("arxivSection") });
    for (const cat of groups) {
      tocItems.push({ id: `arxiv-${cat}`, label: cat, sub: true });
    }
  }
  if (filtered.length > 0) {
    tocItems.push({
      id: "filtered",
      label: t("filteredCount", { count: filtered.length }),
    });
  }

  // 期号导航(dates 倒序:index-1 是更新的一期,index+1 是更旧的一期)
  const dates = getDigestDates();
  const idx = dates.indexOf(date);
  const newer = idx > 0 ? dates[idx - 1] : null;
  const older = idx >= 0 && idx < dates.length - 1 ? dates[idx + 1] : null;

  return (
    <Container>
      <PageHeader
        title={t("digestTitle", { date: digest.date })}
        description={`${t("hfCount", { count: hfRel.length })} · ${t("arxivCount", { count: arxivRel.length })}${filtered.length > 0 ? ` · ${t("filteredCount", { count: filtered.length })}` : ""}`}
      />

      <div className="relative">
        {/* 宽屏右侧 sticky 索引 */}
        <aside className="absolute left-full ml-12 hidden h-full w-40 xl:block">
          <DigestToc items={tocItems} title={t("tocIndex")} />
        </aside>

        {focus.length > 0 ? (
          <section id="focus" className="scroll-mt-24 pb-12">
            <SectionHeader
              label={t("focus")}
              count={t("hfCount", { count: focus.length })}
            />
            <div className="mt-4 rounded-[1.75rem] bg-surface p-1.5 ring-1 ring-hairline">
              <div className="rounded-[calc(1.75rem-0.375rem)] bg-background px-6 ring-1 ring-hairline [&>article:first-child]:border-t-0">
                {focus.map((paper) => (
                  <PaperCard
                    key={paper.id}
                    paper={paper}
                    locale={locale}
                    t={cardT}
                  />
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {hfRest.length > 0 ? (
          <section id="hf" className="scroll-mt-24 pb-12">
            <SectionHeader
              label={t("hfSection")}
              count={t("hfCount", { count: hfRel.length })}
            />
            <div className="mt-4">
              {hfRest.map((paper) => (
                <PaperCard
                  key={paper.id}
                  paper={paper}
                  locale={locale}
                  t={cardT}
                />
              ))}
            </div>
          </section>
        ) : null}

        {arxivRel.length > 0 ? (
          <section id="arxiv" className="scroll-mt-24 pb-12">
            <SectionHeader
              label={t("arxivSection")}
              count={t("arxivCount", { count: arxivRel.length })}
            />
            {groups.map((cat) => (
              <div key={cat} id={`arxiv-${cat}`} className="mt-6 scroll-mt-24">
                <h3 className="font-mono text-xs text-accent">{cat}</h3>
                <div className="mt-2">
                  {byCategory.get(cat)!.map((paper) => (
                    <PaperCard
                      key={paper.id}
                      paper={paper}
                      locale={locale}
                      t={cardT}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {/* 被兴趣过滤掉的论文:折叠保留,可展开捞回 */}
        {filtered.length > 0 ? (
          <details
            id="filtered"
            className="group mb-12 scroll-mt-24 rounded-2xl bg-surface px-5 py-3 ring-1 ring-hairline"
          >
            <summary className="cursor-pointer select-none font-mono text-xs text-muted transition-colors duration-300 ease-premium hover:text-foreground">
              {t("filteredCount", { count: filtered.length })}
            </summary>
            <ul className="mt-3 border-t border-hairline pt-3">
              {filtered.map((paper) => (
                <li key={paper.id} className="py-1">
                  <a
                    href={paper.urls.abs}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm text-muted transition-colors duration-300 ease-premium hover:text-accent"
                  >
                    {locale === "zh" && paper.titleZh
                      ? paper.titleZh
                      : paper.title}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {/* 期号导航 */}
        <nav className="flex items-center justify-between border-t border-hairline py-6 font-mono text-xs">
          {older ? (
            <Link
              href={`/papers/${older}`}
              className="text-muted transition-colors duration-300 ease-premium hover:text-foreground"
            >
              ← {older}
            </Link>
          ) : (
            <span />
          )}
          {newer ? (
            <Link
              href={`/papers/${newer}`}
              className="text-muted transition-colors duration-300 ease-premium hover:text-foreground"
            >
              {newer} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </Container>
  );
}
