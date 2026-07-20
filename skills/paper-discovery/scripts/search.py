#!/usr/bin/env python3
"""Search papers on arXiv (default) and/or Hugging Face papers.

Outputs a JSON object per source to stdout; diagnostics go to stderr.
Abstracts are truncated to 600 chars unless --full-abstract is given.
Page through arXiv results with --start using the next_start field.
"""
import argparse
import urllib.parse

import common


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  python3 scripts/search.py "mixture of experts" --max-results 5
  python3 scripts/search.py "diffusion transformer" --category cs.CV,cs.LG --since 2026-01-01
  python3 scripts/search.py --author "Yoshua Bengio" --sort-by submittedDate
  python3 scripts/search.py 'ti:"attention is all you need"'   # explicit field syntax
  python3 scripts/search.py "rlhf" --source hf --format md""",
    )
    ap.add_argument(
        "query",
        nargs="?",
        help="free text, or explicit arXiv field syntax if it contains ':' (ti:/au:/abs:/cat:)",
    )
    ap.add_argument("--source", choices=["arxiv", "hf", "both"], default="arxiv")
    ap.add_argument("--category", help="comma-separated arXiv categories, e.g. cs.CL,cs.LG")
    ap.add_argument("--author", help='author name, e.g. "Yann LeCun" (arXiv only)')
    ap.add_argument("--since", help="submitted on/after this date, YYYY-MM-DD or YYYYMMDD (filtered client-side)")
    ap.add_argument("--until", help="submitted on/before this date (filtered client-side)")
    ap.add_argument(
        "--sort-by",
        choices=["relevance", "submittedDate", "lastUpdatedDate"],
        default="relevance",
    )
    ap.add_argument("--start", type=int, default=0, help="arXiv paging offset")
    ap.add_argument("--max-results", type=int, default=10, help="1..100, default 10")
    ap.add_argument("--format", choices=["json", "md"], default="json")
    ap.add_argument("--full-abstract", action="store_true", help="do not truncate abstracts")
    args = ap.parse_args()

    if not 1 <= args.max_results <= 100:
        common.die("--max-results must be between 1 and 100")

    result = {}
    if args.source in ("arxiv", "both"):
        sq = common.build_search_query(
            query=args.query,
            categories=args.category,
            author=args.author,
        )
        since = common.parse_date_bound(args.since, end=False) if args.since else None
        until = common.parse_date_bound(args.until, end=True) if args.until else None
        date_filtered = since is not None or until is not None
        # date filtering is client-side (arXiv's submittedDate range syntax is
        # broken in the current backend), so over-fetch to compensate
        fetch_n = min(max(args.max_results * 4, 50), 200) if date_filtered else args.max_results
        data = common.arxiv_get(
            {
                "search_query": sq,
                "start": args.start,
                "max_results": fetch_n,
                "sortBy": args.sort_by,
                "sortOrder": "descending",
            }
        )
        papers, total = common.parse_atom(data)
        if date_filtered:
            papers = [p for p in papers if common.in_date_range(p, since, until)]
            papers = papers[: args.max_results]
        if not args.full_abstract:
            papers = common.truncate_abstracts(papers)
        next_start = args.start + fetch_n
        result["arxiv"] = {
            "total": total,
            "start": args.start,
            "count": len(papers),
            "next_start": (
                None
                if date_filtered
                else (next_start if (total is not None and next_start < total) else None)
            ),
            "papers": papers,
        }
        common.warn(
            f"arXiv: {len(papers)} results (total {total}"
            + (", date-filtered client-side" if date_filtered else "")
            + ")"
        )

    if args.source in ("hf", "both"):
        if not args.query:
            common.die("--source hf requires a free-text query")
        items = common.hf_get(
            "/api/papers/search?"
            + urllib.parse.urlencode({"q": args.query, "limit": min(args.max_results, 50)})
        )
        papers = [common.norm_hf(x) for x in items]
        if not args.full_abstract:
            papers = common.truncate_abstracts(papers)
        result["hf"] = {"count": len(papers), "papers": papers}
        common.warn(f"HF: {len(papers)} results")

    if args.format == "json":
        common.emit_json(result)
    else:
        for src, block in result.items():
            print(f"## {src} results\n")
            print(common.to_markdown(block["papers"]))
            print()


if __name__ == "__main__":
    main()
