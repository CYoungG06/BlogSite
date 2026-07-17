import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import NoteCard from "@/components/notes/NoteCard";
import { routing } from "@/i18n/routing";
import { getNotes } from "@/lib/notes";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "notes" });
  return { title: t("title"), description: t("description") };
}

export default async function NotesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "notes" });
  const notes = getNotes(locale);

  return (
    <Container>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="rounded-[1.75rem] bg-surface p-1.5 ring-1 ring-hairline">
        <div className="rounded-[calc(1.75rem-0.375rem)] bg-background px-6 ring-1 ring-hairline">
          {notes.map((note) => (
            <NoteCard key={note.slug} note={note} />
          ))}
        </div>
      </div>
    </Container>
  );
}
