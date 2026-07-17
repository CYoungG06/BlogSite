import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { Link } from "@/i18n/navigation";
import { isoDate } from "@/lib/format";
import type { Note } from "@/lib/notes";

/** NoteCard:轻量版 PostCard,py-5,标题一行截断 */
export default function NoteCard({ note }: { note: Note }) {
  return (
    <article className="group relative border-b border-hairline py-5 last:border-b-0">
      <div className="flex items-baseline gap-4">
        <time
          dateTime={note.date}
          className="hidden shrink-0 font-mono text-xs text-muted sm:block sm:w-20"
        >
          {isoDate(note.date)}
        </time>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium tracking-tight">
            <Link
              href={`/notes/${note.slug}`}
              className="transition-colors duration-300 ease-premium after:absolute after:inset-0 group-hover:text-accent"
            >
              {note.title}
            </Link>
          </h3>
          {note.preview ? (
            <p className="mt-1 line-clamp-1 text-sm text-muted">
              {note.preview}
            </p>
          ) : null}
        </div>
        <ArrowUpRight
          size={15}
          aria-hidden
          className="shrink-0 -translate-x-1 self-center text-accent opacity-0 transition-all duration-300 ease-premium group-hover:translate-x-0 group-hover:opacity-100"
        />
      </div>
    </article>
  );
}
