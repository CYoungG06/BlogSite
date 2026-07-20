#!/usr/bin/env python3
"""Fetch the curated daily paper digest from the BlogSite static JSON API
(论文速递 · 相对性阿卡内: arXiv + Hugging Face papers with Chinese AI
summaries, relevance-filtered).

Default: show the latest issue. Fields include titleZh/summaryZh (Chinese
AI summary), upvotes, github links, and a relevant flag. Filtered-out papers
(relevant == false) are hidden unless --all is given.
"""
import argparse
import json
import os
import sys

import common

BASE = os.environ.get(
    "PAPERS_DIGEST_BASE", "https://cyoungg06.github.io/BlogSite"
).rstrip("/")
API = f"{BASE}/api/papers"


def fetch_json(url: str) -> dict:
    return json.loads(common.http_get(url).decode("utf-8"))


def to_skill_shape(p: dict) -> dict:
    """Map the digest JSON (camelCase) onto the skill's normalized shape."""
    return {
        "id": p.get("id"),
        "title": p.get("title"),
        "authors": p.get("authors") or [],
        "abstract": p.get("summaryZh") or p.get("abstract") or "",
        "primary_category": p.get("primaryCategory"),
        "published": p.get("published") or "",
        "upvotes": p.get("upvotes"),
        "github_repo": p.get("githubRepo"),
        "github_stars": p.get("githubStars"),
        "project_page": p.get("projectPage"),
        "urls": p.get("urls") or {},
    }


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  python3 scripts/digest.py                  # latest issue (relevant papers only)
  python3 scripts/digest.py --date 2026-07-20
  python3 scripts/digest.py --index          # list available dates
  python3 scripts/digest.py --all            # include interest-filtered papers""",
    )
    ap.add_argument("--date", help="issue date, YYYY-MM-DD (default: latest)")
    ap.add_argument("--index", action="store_true", help="only list the archive index")
    ap.add_argument("--all", action="store_true", help="include filtered-out papers")
    ap.add_argument("--format", choices=["md", "json"], default="md")
    args = ap.parse_args()

    index = fetch_json(f"{API}/index.json")
    if args.index:
        if args.format == "json":
            common.emit_json(index)
        else:
            print(f"## 论文速递归档(latest: {index.get('latest')})\n")
            for d in index.get("dates", []):
                print(f"- {d['date']} · {d['relevant']}/{d['papers']} 篇相关 · {d['page']}")
        return

    date = args.date or index.get("latest")
    if not date:
        common.die("No digests available yet.")
    digest = fetch_json(f"{API}/{date}.json")

    sections = {}
    for key in ("hf", "arxiv"):
        papers = digest.get(key, [])
        if not args.all:
            papers = [p for p in papers if p.get("relevant") is not False]
        sections[key] = papers

    if args.format == "json":
        common.emit_json({"date": date, **sections})
        return

    print(f"## 论文速递 {date}(HF {len(sections['hf'])} · arXiv {len(sections['arxiv'])})\n")
    for key, label in (("hf", "Hugging Face 热门"), ("arxiv", "arXiv 新论文")):
        if not sections[key]:
            continue
        print(f"### {label}\n")
        print(common.to_markdown([to_skill_shape(p) for p in sections[key]]))
        print()


if __name__ == "__main__":
    main()
