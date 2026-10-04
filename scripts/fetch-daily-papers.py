#!/usr/bin/env python3
"""Fetch one day's papers — Hugging Face Daily Papers + arXiv new submissions —
and write a JSON digest to content/papers/<date>.json for the site to render.

No Python dependencies. Uses curl as a fallback for arXiv HTTP 406 responses.
Designed for CI (GitHub Actions) but works locally too; HF falls back to
hf-mirror.com when huggingface.co is unreachable.

Usage:
  python3 scripts/fetch-daily-papers.py                      # yesterday (UTC)
  python3 scripts/fetch-daily-papers.py --date 2026-07-17    # specific day
"""
import argparse
import http.client
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date as date_type
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

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
ARXIV_PAGE_SIZE = 500
ARXIV_SCAN_LIMIT = 2000
_last_arxiv_request = 0.0

ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV_NS = "{http://arxiv.org/schemas/atom}"


class FetchError(RuntimeError):
    """A source could not be read; existing data must be retained."""


class ArxivPending(RuntimeError):
    """The requested submissions have not become available yet."""


def warn(msg: str) -> None:
    print(f"[daily-papers] {msg}", file=sys.stderr)


def fail(msg: str, code: int = 1) -> None:
    warn(f"Error: {msg}")
    sys.exit(code)


def pace_arxiv() -> None:
    global _last_arxiv_request
    wait = 3 - (time.monotonic() - _last_arxiv_request)
    if wait > 0:
        time.sleep(wait)
    _last_arxiv_request = time.monotonic()


def curl_get(url: str) -> bytes:
    """Some arXiv requests reject urllib with 406 but accept the curl client."""
    curl = shutil.which("curl")
    if not curl:
        raise FetchError("arXiv returned HTTP 406 and curl is not installed")
    pace_arxiv()
    try:
        result = subprocess.run(
            [curl, "--fail", "--silent", "--show-error", "--location",
             "--connect-timeout", "10", "--max-time", str(TIMEOUT), url],
            capture_output=True, timeout=TIMEOUT + 5,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise FetchError(f"arXiv curl request failed: {exc}") from exc
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise FetchError(f"arXiv curl request failed ({result.returncode}): {detail}")
    return result.stdout


def http_get(url: str) -> bytes:
    last_err = None
    retry_after = 0
    for attempt, sleep_s in enumerate([0] + RETRY_SLEEPS):
        if sleep_s or retry_after:
            time.sleep(max(sleep_s, retry_after))
        retry_after = 0
        pace_arxiv()
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code} {e.reason}"
            if e.code == 406:
                warn("arXiv rejected urllib with HTTP 406; trying curl")
                try:
                    return curl_get(url)
                except FetchError as exc:
                    last_err = str(exc)
                    warn(last_err)
                    continue
            if e.code in (429, 500, 502, 503, 504):
                if e.code == 429:
                    ra = e.headers.get("Retry-After") if e.headers else None
                    if ra and ra.isdigit():
                        retry_after = min(int(ra), 120)
                warn(f"{last_err}; retrying ({attempt + 1}/{len(RETRY_SLEEPS) + 1})")
                continue
            raise FetchError(f"{last_err} for {url}")
        except (urllib.error.URLError, TimeoutError, http.client.HTTPException) as e:
            last_err = str(e)
            warn(f"Request failed ({e}); retrying ({attempt + 1}/{len(RETRY_SLEEPS) + 1})")
    raise FetchError(f"All retries failed for {url}. Last error: {last_err}")


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
            except (urllib.error.URLError, TimeoutError, ValueError, http.client.HTTPException) as e:
                last_err = str(e)
                warn(f"HF {base} failed ({e}); round {round_i + 1}/3")
    raise FetchError(f"All HF endpoints failed after retries. Last error: {last_err}")


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
    if root.tag != f"{ATOM}feed":
        raise FetchError("arXiv returned a non-Atom response")
    papers = []
    for e in root.findall(f"{ATOM}entry"):
        raw_id = (e.findtext(f"{ATOM}id") or "").strip()
        if "/api/errors" in raw_id:
            raise FetchError(e.findtext(f"{ATOM}summary") or "arXiv API error")
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


def fetch_arxiv(day: str, categories: list, limit: int, primary_cats: list,
                date_query: bool = False) -> list:
    if limit <= 0:
        return []
    cat_clause = " OR ".join(f"cat:{c}" for c in categories)
    sq = f"({cat_clause})" if len(categories) > 1 else cat_clause
    if date_query:
        stamp = day.replace("-", "")
        sq += f" AND submittedDate:[{stamp}0000 TO {stamp}2359]"
    allowed = set(primary_cats)

    # arXiv API 偶发返回 200 但空 feed(负载高或 CI 共享 IP 被限流时),
    # 空结果按退避重试;周末/节假日天然为空,重试一轮后接受
    is_weekday = datetime.strptime(day, "%Y-%m-%d").date().weekday() < 5
    empty_sleeps = [15, 45, 90] if is_weekday else [15]

    def query_page(start: int) -> list:
        params = urllib.parse.urlencode(
            {
                "search_query": sq,
                "start": start,
                "max_results": ARXIV_PAGE_SIZE,
                "sortBy": "submittedDate",
                "sortOrder": "descending",
            }
        )
        page = parse_atom(http_get(f"{ARXIV_API}?{params}"))
        if date_query and any(p["published"][:10] != day for p in page):
            raise FetchError(f"arXiv date query returned papers outside {day}")
        return page

    # 某些分页请求会返回 HTTP 406。收够所需论文或页内已经出现更早日期
    # 就停止,避免多余请求失败后丢弃已经拿到的目标日论文。
    matched = {}
    for start in range(0, ARXIV_SCAN_LIMIT, ARXIV_PAGE_SIZE):
        page = []
        for attempt, sleep_s in enumerate([0] + empty_sleeps):
            if sleep_s:
                time.sleep(sleep_s)
            page = query_page(start)
            if date_query and not page:
                if start == 0:
                    raise ArxivPending(f"arXiv has no indexed submissions for {day} yet")
                break
            if page or not is_weekday or attempt == len(empty_sleeps):
                break
            warn(f"arXiv returned empty feed for weekday {day}; retrying ({attempt + 1}/{len(empty_sleeps) + 1})")
        if not page:
            if date_query:
                break
            if is_weekday:
                # 工作日持续空 = 抖动或限流,大声失败(开 Issue)而不是静默写 0
                raise FetchError(f"arXiv feed stayed empty for weekday {day} after retries")
            raise ArxivPending(f"arXiv feed is not available for {day} yet")
        for p in page:
            if p["published"][:10] == day and p.get("primaryCategory") in allowed:
                matched[p["id"]] = p
        oldest = min(p["published"][:10] for p in page)
        newest = max(p["published"][:10] for p in page)
        if start == 0 and newest < day:
            raise ArxivPending(f"Latest indexed arXiv submission date is {newest}, before {day}")
        warn(f"arXiv page start={start}: {len(page)} papers, {oldest}..{newest}; {len(matched)} eligible for {day}")
        if len(matched) >= limit or oldest < day or len(page) < ARXIV_PAGE_SIZE:
            break
        if start + ARXIV_PAGE_SIZE < ARXIV_SCAN_LIMIT:
            time.sleep(3)  # 分页间隔,礼貌限速
    else:
        raise FetchError(f"arXiv scan limit ({ARXIV_SCAN_LIMIT}) reached before completing {day}; refusing to write an incomplete digest")

    # 按 v1 published 的 UTC 日期过滤;历史补抓使用日期查询并校验响应日期,
    # 避免旧日期超出最新 2000 篇窗口后被误写成零篇。
    # 分页间 feed 可能轻微位移导致跨页重复,按 id 去重保序
    # 主分类白名单:query 的 cat: 会命中 cross-list,这里把主类不在白名单的
    # (eess/物理/数学/q-bio/cs.CV 等)挡掉,减少垂直领域噪声
    return list(matched.values())[:limit]


def recent_ids(output_dir: str, day: date_type, lookback: int = 3) -> set:
    """回看最近几天的速递文件,收集已展示过的论文 id,用于跨天去重。"""
    ids = set()
    for i in range(1, lookback + 1):
        path = os.path.join(
            output_dir, (day - timedelta(days=i)).isoformat() + ".json"
        )
        try:
            with open(path) as f:
                d = json.load(f)
            ids.update(p["id"] for p in d.get("hf", []) + d.get("arxiv", []))
        except (OSError, json.JSONDecodeError):
            continue
    return ids


def arxiv_not_before(day: date_type) -> datetime:
    """Earliest scheduled announcement for this UTC submission day, plus
    six hours for API indexing. Weekends and DST follow New York time.
    A later moderation/indexing delay still results in ArxivPending.
    """
    eastern = ZoneInfo("America/New_York")
    submitted = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc).astimezone(eastern)
    deadline = submitted.replace(hour=14, minute=0, second=0, microsecond=0)
    if submitted >= deadline:
        deadline += timedelta(days=1)
    while deadline.weekday() >= 5:
        deadline += timedelta(days=1)
    announcement = deadline.replace(hour=20)
    if deadline.weekday() == 4:
        announcement += timedelta(days=2)
    return announcement.astimezone(timezone.utc) + timedelta(hours=6)


def read_digest(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def restore_annotations(papers: list, old: dict) -> None:
    previous = {p["id"]: p for p in old.get("hf", []) + old.get("arxiv", [])}
    for paper in papers:
        saved = previous.get(paper["id"], {})
        for key in ("titleZh", "summaryZh", "score", "reason", "deepDive", "relevant"):
            if key in saved:
                paper[key] = saved[key]


def refresh_digest(day: date_type, categories: list, primary_cats: list,
                   hf_limit: int, arxiv_limit: int, output_dir: str,
                   skip_arxiv: bool = False, reuse_hf: bool = False,
                   now: datetime | None = None) -> tuple[bool, list]:
    now = now or datetime.now(timezone.utc)
    day_s = day.isoformat()
    path = os.path.join(output_dir, day_s + ".json")
    old = read_digest(path)
    hf = old.get("hf", [])
    arxiv = old.get("arxiv", [])
    status = old.get("arxivStatus", "complete" if arxiv else "pending")
    errors = []

    def record_error(source: str, error: Exception) -> None:
        message = f"{day_s} {source}: {error}"
        errors.append(message)
        warn(message)
        if os.environ.get("GITHUB_ACTIONS") == "true":
            escaped = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            print(f"::error title=Daily papers {day_s}::{escaped}", file=sys.stderr)

    if not reuse_hf:
        try:
            fresh_hf = fetch_hf(day_s, hf_limit)
            if fresh_hf or not hf:
                hf = fresh_hf
            else:
                warn(f"HF {day_s} returned empty; keeping existing papers")
        except (FetchError, ValueError, TypeError, OSError, http.client.HTTPException) as exc:
            record_error("HF", exc)

    if skip_arxiv:
        warn(f"{day_s}: HF-only update; keeping the existing arXiv section")
    elif now < arxiv_not_before(day):
        status = "pending"
        warn(f"{day_s}: arXiv announcement/indexing pending until at least {arxiv_not_before(day).isoformat()}")
    else:
        try:
            fresh_arxiv = fetch_arxiv(
                day_s, categories, arxiv_limit, primary_cats,
                date_query=day < now.date() - timedelta(days=1),
            )
            excluded = {p["id"] for p in hf} | recent_ids(output_dir, day)
            fresh_arxiv = [p for p in fresh_arxiv if p["id"] not in excluded]
            if fresh_arxiv or not arxiv:
                arxiv = fresh_arxiv
            else:
                warn(f"arXiv {day_s} returned empty; keeping existing papers")
            status = "complete"
        except ArxivPending as exc:
            status = "pending"
            warn(f"{day_s}: {exc}; will retry on a later run")
        except (FetchError, ValueError, OSError, ET.ParseError, http.client.HTTPException) as exc:
            status = "error"
            record_error("arXiv", exc)

    restore_annotations(hf + arxiv, old)
    if not hf and not arxiv:
        warn(f"No available papers for {day_s}; skipping empty digest")
        return False, errors

    digest = {
        **old,
        "date": day_s,
        "categories": categories,
        "hf": hf,
        "arxiv": arxiv,
        "arxivStatus": status,
    }
    content = lambda d: {k: v for k, v in d.items() if k != "generatedAt"}
    if content(digest) == content(old):
        return False, errors
    digest["generatedAt"] = now.isoformat()
    os.makedirs(output_dir, exist_ok=True)
    with open(path + ".tmp", "w") as f:
        json.dump(digest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(path + ".tmp", path)
    warn(f"Wrote {path} (hf={len(hf)}, arxiv={len(arxiv)}, arxivStatus={status})")
    return True, errors


def catchup_dates(day: date_type, output_dir: str, lookback: int) -> list:
    """Retry existing incomplete digests; do not create empty weekend archives."""
    dates = [day]
    for offset in range(1, lookback + 1):
        earlier = day - timedelta(days=offset)
        old = read_digest(os.path.join(output_dir, earlier.isoformat() + ".json"))
        if old and (not old.get("arxiv") or old.get("arxivStatus") in ("pending", "error")):
            dates.append(earlier)
    return sorted(dates)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", help="content date, YYYY-MM-DD (default: yesterday UTC)")
    ap.add_argument("--categories", default="cs.CL,cs.LG,cs.AI")
    ap.add_argument("--primary-cats", default="cs.CL,cs.LG,cs.AI,cs.MA,cs.IR,cs.SE")
    ap.add_argument("--hf-limit", type=int, default=30)
    ap.add_argument("--arxiv-limit", type=int, default=50)
    ap.add_argument("--skip-arxiv", action="store_true", help="HF-only update; preserve existing arXiv papers")
    ap.add_argument("--arxiv-only", action="store_true", help="reuse existing HF papers when repairing a digest")
    ap.add_argument("--lookback-days", type=int, default=0, help="also retry incomplete existing digests from this many previous days")
    ap.add_argument("--changed-dates-file", help="write changed dates, one per line, for the summary step")
    ap.add_argument("--output-dir", default="content/papers")
    args = ap.parse_args()
    if min(args.hf_limit, args.arxiv_limit, args.lookback_days) < 0:
        ap.error("limits and lookback must be non-negative")

    now = datetime.now(timezone.utc)
    try:
        day = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else now.date() - timedelta(days=1)
    except ValueError:
        ap.error('Invalid --date. Use YYYY-MM-DD.')
    if day > now.date():
        ap.error("--date cannot be in the future")
    categories = [c.strip() for c in args.categories.split(",") if c.strip()]
    primary_cats = [c.strip() for c in args.primary_cats.split(",") if c.strip()]
    if not categories or not primary_cats:
        ap.error("categories and primary-cats must not be empty")

    changed, errors = [], []
    if args.changed_dates_file:
        with open(args.changed_dates_file, "w"):
            pass
    targets = catchup_dates(day, args.output_dir, 0 if args.skip_arxiv else args.lookback_days)
    for target in targets:
        updated, failures = refresh_digest(
            target, categories, primary_cats, args.hf_limit, args.arxiv_limit,
            args.output_dir, skip_arxiv=args.skip_arxiv,
            reuse_hf=args.arxiv_only or target != day, now=now,
        )
        errors.extend(failures)
        if updated:
            changed.append(target.isoformat())
            if args.changed_dates_file:
                with open(args.changed_dates_file, "a") as f:
                    f.write(target.isoformat() + "\n")
    warn(f"Updated {len(changed)} digest(s); {len(errors)} source error(s)")
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
