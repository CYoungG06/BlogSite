#!/usr/bin/env python3
"""Fetch one day's papers — Hugging Face Daily Papers + arXiv new submissions —
and write a JSON digest to content/papers/<date>.json for the site to render.

Stdlib only. Designed for CI (GitHub Actions) but works locally too; HF falls
back to hf-mirror.com when huggingface.co is unreachable.

Usage:
  python3 scripts/fetch-daily-papers.py                      # yesterday (UTC)
  python3 scripts/fetch-daily-papers.py --date 2026-07-17    # specific day
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date as date_type
from datetime import datetime, timedelta, timezone

ARXIV_API = os.environ.get("ARXIV_API", "https://export.arxiv.org/api/query")
_env_hf = os.environ.get("HF_BASE")
HF_BASES = (
    [u.strip().rstrip("/") for u in _env_hf.split(",") if u.strip()]
    if _env_hf
    else ["https://huggingface.co", "https://hf-mirror.com"]
)

USER_AGENT = "blogsite-daily-papers/0.1 (personal site digest)"
TIMEOUT = 20
RETRY_SLEEPS = [5, 15, 45]
ABSTRACT_LIMIT = None  # 不再截断:展示层有 line-clamp,完整摘要是 AI 导读的输入
AUTHORS_KEPT = 6

ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV_NS = "{http://arxiv.org/schemas/atom}"


def warn(msg: str) -> None:
    print(f"[daily-papers] {msg}", file=sys.stderr)


def fail(msg: str, code: int = 1) -> None:
    warn(f"Error: {msg}")
    sys.exit(code)


def http_get(url: str) -> bytes:
    last_err = None
    retry_after = 0
    for attempt, sleep_s in enumerate([0] + RETRY_SLEEPS):
        if sleep_s or retry_after:
            time.sleep(max(sleep_s, retry_after))
        retry_after = 0
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code} {e.reason}"
            if e.code in (429, 500, 502, 503, 504):
                if e.code == 429:
                    ra = e.headers.get("Retry-After") if e.headers else None
                    if ra and ra.isdigit():
                        retry_after = min(int(ra), 120)
                warn(f"{last_err}; retrying ({attempt + 1}/{len(RETRY_SLEEPS) + 1})")
                continue
            fail(f"{last_err} for {url}")
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = str(e)
            warn(f"Request failed ({e}); retrying ({attempt + 1}/{len(RETRY_SLEEPS) + 1})")
    fail(f"All retries failed for {url}. Last error: {last_err}")


def hf_get(path_query: str):
    """Try each HF base in order, with a few rounds of retry — local networks
    (especially ones needing the mirror) throw transient SSL/conn errors."""
    last_err = None
    for round_i, sleep_s in enumerate([0, 3, 8]):
        if sleep_s:
            time.sleep(sleep_s)
        for base in HF_BASES:
            req = urllib.request.Request(
                base + path_query, headers={"User-Agent": USER_AGENT}
            )
            try:
                with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                    if base != HF_BASES[0]:
                        warn(f"HF official endpoint unreachable, using mirror {base}")
                    return json.loads(resp.read().decode("utf-8"))
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                last_err = str(e)
                warn(f"HF {base} failed ({e}); round {round_i + 1}/3")
    fail(f"All HF endpoints failed after retries. Last error: {last_err}")


def truncate(text: str | None) -> str:
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    if ABSTRACT_LIMIT and len(text) > ABSTRACT_LIMIT:
        return text[:ABSTRACT_LIMIT].rstrip() + " …"
    return text


def author_slice(names: list) -> tuple:
    return names[:AUTHORS_KEPT], len(names)


def norm_hf(wrapper: dict) -> dict:
    p = wrapper.get("paper") if "paper" in wrapper else wrapper
    pid = p.get("id")
    names = [a.get("name") for a in p.get("authors", []) if a.get("name")]
    authors, total = author_slice(names)
    item = {
        "id": pid,
        "title": p.get("title") or "",
        "authors": authors,
        "authorsTotal": total,
        "abstract": truncate(p.get("summary")),
        "published": p.get("publishedAt") or "",
        "urls": {
            "abs": f"https://arxiv.org/abs/{pid}",
            "pdf": f"https://arxiv.org/pdf/{pid}",
        },
    }
    if p.get("upvotes") is not None:
        item["upvotes"] = p["upvotes"]
    if p.get("githubRepo"):
        item["githubRepo"] = p["githubRepo"]
    if p.get("githubStars") is not None:
        item["githubStars"] = p["githubStars"]
    if p.get("projectPage"):
        item["projectPage"] = p["projectPage"]
    if wrapper.get("numComments") is not None:
        item["numComments"] = wrapper["numComments"]
    return item


def fetch_hf(day: str, limit: int) -> list:
    q = urllib.parse.urlencode({"date": day, "limit": 100})
    items = [norm_hf(x) for x in hf_get(f"/api/daily_papers?{q}")]
    items.sort(key=lambda p: p.get("upvotes") or 0, reverse=True)
    return items[:limit]


def parse_atom(data: bytes) -> list:
    root = ET.fromstring(data)
    papers = []
    for e in root.findall(f"{ATOM}entry"):
        raw_id = (e.findtext(f"{ATOM}id") or "").strip()
        m = re.search(r"abs/([^/]+)$", raw_id)
        if not m:
            continue
        arxiv_id = re.sub(r"v\d+$", "", m.group(1))
        prim = e.find(f"{ARXIV_NS}primary_category")
        comment = (e.findtext(f"{ARXIV_NS}comment") or "").strip() or None
        names = [
            (a.findtext(f"{ATOM}name") or "").strip()
            for a in e.findall(f"{ATOM}author")
        ]
        authors, total = author_slice([n for n in names if n])
        item = {
            "id": arxiv_id,
            "title": re.sub(r"\s+", " ", e.findtext(f"{ATOM}title") or "").strip(),
            "authors": authors,
            "authorsTotal": total,
            "abstract": truncate(e.findtext(f"{ATOM}summary")),
            "published": (e.findtext(f"{ATOM}published") or "").strip(),
            "primaryCategory": prim.get("term") if prim is not None else None,
            "urls": {
                "abs": f"https://arxiv.org/abs/{arxiv_id}",
                "pdf": f"https://arxiv.org/pdf/{arxiv_id}",
            },
        }
        if comment:
            item["comment"] = comment
        papers.append(item)
    return papers


def fetch_arxiv(day: str, categories: list, limit: int, primary_cats: list) -> list:
    cat_clause = " OR ".join(f"cat:{c}" for c in categories)
    sq = f"({cat_clause})" if len(categories) > 1 else cat_clause
    params = urllib.parse.urlencode(
        {
            "search_query": sq,
            "start": 0,
            "max_results": 500,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
    )
    papers = parse_atom(http_get(f"{ARXIV_API}?{params}"))
    # 服务端 submittedDate 区间语法在当前后端不可靠,这里按 v1 published 的
    # UTC 日期做客户端过滤(详见仓库 references 记录,与本地 skill 一致)
    papers = [p for p in papers if p["published"][:10] == day]
    # 主分类白名单:query 的 cat: 会命中 cross-list,这里把主类不在白名单的
    # (eess/物理/数学/q-bio/cs.CV 等)挡掉,减少垂直领域噪声
    allowed = set(primary_cats)
    papers = [p for p in papers if p.get("primaryCategory") in allowed]
    return papers[:limit]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", help="content date, YYYY-MM-DD (default: yesterday UTC)")
    ap.add_argument("--categories", default="cs.CL,cs.LG,cs.AI")
    ap.add_argument(
        "--primary-cats",
        default="cs.CL,cs.LG,cs.AI,cs.MA,cs.IR,cs.SE",
        help="arXiv 主分类白名单(逗号分隔),主类不在其中的论文被过滤",
    )
    ap.add_argument("--hf-limit", type=int, default=30)
    ap.add_argument("--arxiv-limit", type=int, default=30)
    ap.add_argument("--output-dir", default="content/papers")
    args = ap.parse_args()

    if args.date:
        try:
            day = datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            fail(f'Invalid --date "{args.date}". Use YYYY-MM-DD.')
    else:
        day = datetime.now(timezone.utc).date() - timedelta(days=1)
    day_s = day.isoformat()
    categories = [c.strip() for c in args.categories.split(",") if c.strip()]
    primary_cats = [c.strip() for c in args.primary_cats.split(",") if c.strip()]

    hf = fetch_hf(day_s, args.hf_limit)
    warn(f"HF daily {day_s}: {len(hf)} papers")
    arxiv = fetch_arxiv(day_s, categories, args.arxiv_limit, primary_cats)
    warn(f"arXiv {day_s} ({','.join(categories)}): {len(arxiv)} papers before dedupe")

    hf_ids = {p["id"] for p in hf}
    arxiv = [p for p in arxiv if p["id"] not in hf_ids]
    warn(f"arXiv after dedupe against HF: {len(arxiv)}")

    # 周末/arXiv 入库延迟日天然为空:不落盘,归档里不留空日期;
    # 已有文件的日子即使重跑出空也保留原文件
    if not hf and not arxiv:
        warn(f"No papers for {day_s}; skipping write.")
        return

    digest = {
        "date": day_s,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "categories": categories,
        "hf": hf,
        "arxiv": arxiv,
    }
    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, f"{day_s}.json")
    tmp = out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(digest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, out)
    warn(f"Wrote {out} (hf={len(hf)}, arxiv={len(arxiv)})")


if __name__ == "__main__":
    main()
