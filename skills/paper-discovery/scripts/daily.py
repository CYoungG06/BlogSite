#!/usr/bin/env python3
"""Daily paper digest: Hugging Face Daily Papers (community-curated, with
upvotes) and/or arXiv new submissions per category.

Shown paper ids are recorded in a local seen-file (~/.cache/paper-discovery/
seen.json); pass --new-only to only show papers not shown before.
Outputs Markdown by default (--format json for machine consumption).
"""
import argparse
import datetime as dt
import urllib.parse

import common


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  python3 scripts/daily.py                          # HF trending + arXiv new (cs.CL,cs.LG,cs.AI)
  python3 scripts/daily.py --source hf --limit 10   # only HF daily, top 10 by upvotes
  python3 scripts/daily.py --source arxiv --categories cs.CL --days 1
  python3 scripts/daily.py --new-only               # only papers not shown before""",
    )
    ap.add_argument("--source", choices=["both", "arxiv", "hf"], default="both")
    ap.add_argument(
        "--categories",
        default="cs.CL,cs.LG,cs.AI",
        help="comma-separated arXiv categories (default cs.CL,cs.LG,cs.AI)",
    )
    ap.add_argument(
        "--days",
        type=int,
        default=3,
        help="arXiv lookback window in days (default 3, covers weekends)",
    )
    ap.add_argument("--date", help="HF daily-papers date, YYYY-MM-DD (default: latest)")
    ap.add_argument("--limit", type=int, default=15, help="max papers per source")
    ap.add_argument(
        "--sort",
        choices=["upvotes", "time"],
        default="upvotes",
        help="HF ordering (default upvotes)",
    )
    ap.add_argument("--new-only", action="store_true", help="hide previously shown papers")
    ap.add_argument("--no-mark-seen", action="store_true", help="do not record shown ids")
    ap.add_argument("--format", choices=["md", "json"], default="md")
    ap.add_argument("--full-abstract", action="store_true")
    args = ap.parse_args()

    if args.limit < 1:
        common.die("--limit must be >= 1")
    if args.days < 1:
        common.die("--days must be >= 1")

    seen = common.load_seen()
    sections = {}

    if args.source in ("hf", "both"):
        q = {"limit": max(args.limit * 3, 50)}
        if args.date:
            q["date"] = args.date
        items = common.hf_get("/api/daily_papers?" + urllib.parse.urlencode(q))
        papers = [common.norm_hf(x) for x in items]
        if args.sort == "upvotes":
            papers.sort(key=lambda p: p.get("upvotes") or 0, reverse=True)
        sections["hf"] = papers[: args.limit]
        common.warn(f"HF daily: {len(items)} papers, showing {len(sections['hf'])}")

    if args.source in ("arxiv", "both"):
        since_date = dt.date.today() - dt.timedelta(days=args.days)
        since = dt.datetime.combine(since_date, dt.time.min, tzinfo=dt.timezone.utc)
        sq = common.build_search_query(categories=args.categories)
        data = common.arxiv_get(
            {
                "search_query": sq,
                "start": 0,
                # newest-first; over-fetch then filter by v1 published date,
                # since arXiv's submittedDate range syntax is unreliable
                "max_results": min(max(args.limit * 6, 100), 500),
                "sortBy": "submittedDate",
                "sortOrder": "descending",
            }
        )
        papers, total = common.parse_atom(data)
        papers = [p for p in papers if common.in_date_range(p, since, None)]
        sections["arxiv"] = papers[: args.limit]
        common.warn(
            f"arXiv new ({args.categories}, last {args.days}d): "
            f"{len(papers)} in window, showing {len(sections['arxiv'])}"
        )

    if args.new_only:
        for k in sections:
            sections[k] = [p for p in sections[k] if p["id"] not in seen]

    if not args.full_abstract:
        for k in sections:
            sections[k] = common.truncate_abstracts(sections[k])

    if not args.no_mark_seen:
        ids = set(seen)
        for papers in sections.values():
            ids.update(p["id"] for p in papers if p.get("id"))
        common.save_seen(ids)

    if args.format == "json":
        common.emit_json(sections)
        return

    if "hf" in sections:
        date_note = f" ({args.date})" if args.date else ""
        print(f"## Hugging Face Daily Papers{date_note} — top by upvotes\n")
        print(common.to_markdown(sections["hf"]) or "(none)")
        print()
    if "arxiv" in sections:
        print(f"## arXiv new submissions — {args.categories}, last {args.days} day(s)\n")
        print(common.to_markdown(sections["arxiv"]) or "(none)")
        print()


if __name__ == "__main__":
    main()
