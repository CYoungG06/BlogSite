#!/usr/bin/env python3
"""Fetch details for specific papers by arXiv ID.

Accepts bare ids (1706.03762, 1706.03762v2), arXiv:1706.03762, or
https://arxiv.org/abs/1706.03762. Merges arXiv metadata with Hugging Face
extras (upvotes, ai_summary, github_repo) under the "hf" key when available.
"""
import argparse
import re
import urllib.error

import common

ID_RE = re.compile(r"(\d{4}\.\d{4,5})(v\d+)?")


def extract_id(s: str) -> str:
    m = ID_RE.search(s.strip())
    if not m:
        common.die(
            f'Could not parse an arXiv id from "{s}". '
            "Expected e.g. 1706.03762 or https://arxiv.org/abs/1706.03762"
        )
    return m.group(1)


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  python3 scripts/paper.py 1706.03762
  python3 scripts/paper.py 1706.03762 2305.15334 --format md""",
    )
    ap.add_argument("ids", nargs="+", help="arXiv ids or abs URLs (max 20)")
    ap.add_argument("--format", choices=["json", "md"], default="json")
    ap.add_argument("--full-abstract", action="store_true")
    args = ap.parse_args()

    ids = [extract_id(s) for s in args.ids]
    ids = list(dict.fromkeys(ids))
    if len(ids) > 20:
        common.die("Too many ids: max 20 per call")

    data = common.arxiv_get({"id_list": ",".join(ids), "max_results": len(ids)})
    papers, _ = common.parse_atom(data)
    by_id = {re.sub(r"v\d+$", "", p["id"]): p for p in papers}

    out = []
    for pid in ids:
        hf = None
        try:
            hf = common.norm_hf(common.hf_get(f"/api/papers/{pid}"))
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
        p = by_id.get(pid)
        if p is None and hf is None:
            common.warn(f"{pid}: not found on arXiv or HF")
            continue
        if p is not None:
            p["hf"] = hf
            out.append(p)
        else:
            out.append(hf)
        if hf is None:
            common.warn(f"{pid}: not indexed on Hugging Face, arXiv metadata only")

    if not args.full_abstract:
        out = common.truncate_abstracts(out)

    if args.format == "json":
        common.emit_json(out if len(out) != 1 else out[0])
    else:
        print(common.to_markdown(out))
        for p in out:
            hf = p.get("hf")
            if hf:
                print()
                print(f"HF extras for {p['id']}: upvotes={hf.get('upvotes')}, "
                      f"github={hf.get('github_repo')}, ai_keywords={hf.get('ai_keywords')}")


if __name__ == "__main__":
    main()
