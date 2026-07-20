#!/usr/bin/env python3
"""Shared helpers for the paper-discovery skill scripts. Stdlib only, no deps."""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ARXIV_API = os.environ.get(
    "PAPER_DISCOVERY_ARXIV_API", "https://export.arxiv.org/api/query"
)

_env_hf = os.environ.get("PAPER_DISCOVERY_HF_BASE")
HF_BASES = (
    [u.strip().rstrip("/") for u in _env_hf.split(",") if u.strip()]
    if _env_hf
    else ["https://huggingface.co", "https://hf-mirror.com"]
)

USER_AGENT = "paper-discovery-skill/0.1 (personal research assistant)"
TIMEOUT = 20
RETRY_SLEEPS = [5, 15, 45]

ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV_NS = "{http://arxiv.org/schemas/atom}"
OPENSEARCH = "{http://a9.com/-/spec/opensearch/1.1/}"

# arXiv asks for >=3s between API calls; enforce it in-process.
ARXIV_MIN_GAP = 3.0
_last_arxiv_call = 0.0


def warn(msg: str) -> None:
    print(f"[paper-discovery] {msg}", file=sys.stderr)


def die(msg: str, code: int = 2) -> "NoReturn":
    warn(f"Error: {msg}")
    sys.exit(code)


_NO_PROXY_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _urlopen(req: urllib.request.Request, timeout: int):
    """urlopen that bypasses env/system proxies for localhost targets.

    On macOS, urllib picks up System Preferences proxies (e.g. a local
    Clash/VPN on 127.0.0.1:7892); routing a localhost request through that
    proxy returns 502, so loopback hosts go direct."""
    host = urllib.parse.urlparse(req.full_url).hostname or ""
    if host in _NO_PROXY_HOSTS:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        return opener.open(req, timeout=timeout)
    return urllib.request.urlopen(req, timeout=timeout)


def emit_json(obj) -> None:
    json.dump(obj, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


def http_get(url: str) -> bytes:
    """GET url with retry/backoff on transient failures. Returns body bytes.

    On HTTP 429, honors the Retry-After header when present; otherwise backs
    off with RETRY_SLEEPS (arXiv 429 cooldowns can last tens of seconds)."""
    last_err = None
    retry_after = 0
    for attempt, sleep_s in enumerate([0] + RETRY_SLEEPS):
        if sleep_s or retry_after:
            time.sleep(max(sleep_s, retry_after))
        retry_after = 0
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with _urlopen(req, timeout=TIMEOUT) as resp:
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
            die(f"{last_err} for {url}")
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = str(e)
            warn(f"Request failed ({e}); retrying ({attempt + 1}/{len(RETRY_SLEEPS) + 1})")
    die(
        f"All retries failed for {url}. Last error: {last_err}. "
        "See references/apis.md for endpoint overrides."
    )


# ---------------- Hugging Face ----------------

_hf_working_base = None


def hf_get(path_query: str):
    """GET a HF API path, trying each known base until one works. Returns parsed JSON.

    Raises urllib.error.HTTPError with code 404 when the resource does not exist
    (caller decides whether that is fatal)."""
    global _hf_working_base
    bases = list(HF_BASES)
    if _hf_working_base in bases:
        bases.remove(_hf_working_base)
        bases.insert(0, _hf_working_base)
    last_err = None
    for base in bases:
        url = base + path_query
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with _urlopen(req, timeout=TIMEOUT) as resp:
                _hf_working_base = base
                if base != HF_BASES[0]:
                    warn(f"HF official endpoint unreachable, using mirror {base}")
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            last_err = f"HTTP {e.code} {e.reason}"
            warn(f"HF endpoint {base} failed ({last_err}); trying next")
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            last_err = str(e)
            warn(f"HF endpoint {base} failed ({e}); trying next")
    die(
        f"All HF endpoints failed. Last error: {last_err}. "
        "Override with PAPER_DISCOVERY_HF_BASE; see references/apis.md."
    )


def norm_hf(wrapper: dict) -> dict:
    """Normalize a HF daily_papers / papers-search item (or raw paper object)."""
    p = wrapper.get("paper") if "paper" in wrapper else wrapper
    pid = p.get("id")
    return {
        "id": pid,
        "title": p.get("title"),
        "authors": [a.get("name") for a in p.get("authors", []) if a.get("name")],
        "abstract": p.get("summary"),
        "ai_summary": p.get("ai_summary"),
        "ai_keywords": p.get("ai_keywords"),
        "published": p.get("publishedAt"),
        "upvotes": p.get("upvotes"),
        "github_repo": p.get("githubRepo"),
        "github_stars": p.get("githubStars"),
        "project_page": p.get("projectPage"),
        "num_comments": wrapper.get("numComments"),
        "source": "hf",
        "urls": {
            "abs": f"https://arxiv.org/abs/{pid}",
            "pdf": f"https://arxiv.org/pdf/{pid}",
            "hf": f"https://huggingface.co/papers/{pid}",
        },
    }


# ---------------- arXiv ----------------


def arxiv_get(params: dict) -> bytes:
    global _last_arxiv_call
    gap = time.time() - _last_arxiv_call
    if gap < ARXIV_MIN_GAP:
        time.sleep(ARXIV_MIN_GAP - gap)
    url = ARXIV_API + "?" + urllib.parse.urlencode(params)
    data = http_get(url)
    _last_arxiv_call = time.time()
    return data


def parse_date_bound(d: str, end: bool) -> datetime:
    """Parse YYYY-MM-DD / YYYYMMDD (optionally with HHMM) into an aware UTC
    datetime bound (start or end of day)."""
    raw = d
    d = d.replace("-", "").replace("/", "")
    ok = d.isdigit() and len(d) in (8, 12)
    if ok:
        try:
            datetime.strptime(d[:8], "%Y%m%d")
            if len(d) == 12 and not (int(d[8:10]) < 24 and int(d[10:12]) < 60):
                ok = False
        except ValueError:
            ok = False
    if not ok:
        die(f'Invalid date "{raw}". Use YYYY-MM-DD or YYYYMMDD (optionally with HHMM).')
    if len(d) == 8:
        d += "2359" if end else "0000"
    return datetime.strptime(d, "%Y%m%d%H%M").replace(tzinfo=timezone.utc)


def published_dt(paper: dict) -> datetime | None:
    """Parse a normalized paper's published timestamp (ISO, arXiv uses Z)."""
    raw = paper.get("published") or ""
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def in_date_range(paper: dict, since: datetime | None, until: datetime | None) -> bool:
    """Client-side date filter on the v1 published date. The arXiv API's
    submittedDate range syntax is unreliable in the current backend (observed
    2026-07: ranges get rewritten to phrase queries and return 0 results),
    so date filtering happens here after fetching."""
    if since is None and until is None:
        return True
    p = published_dt(paper)
    if p is None:
        return False
    if since is not None and p < since:
        return False
    if until is not None and p > until:
        return False
    return True


# arXiv matches stopword terms against nothing, so `all:x AND all:of AND all:y`
# returns 0 results. Strip them from free-text queries before ANDing.
STOPWORDS = {
    "a", "an", "the", "of", "and", "or", "for", "in", "on", "at", "to", "with",
    "by", "is", "are", "was", "were", "be", "been", "from", "as", "it", "its",
    "this", "that", "these", "those", "we", "our", "you", "your", "via",
}


def build_search_query(
    query: str | None = None,
    categories: str | None = None,
    author: str | None = None,
) -> str:
    """Build an arXiv search_query string. A free-text query becomes an AND of
    all: terms (stopwords stripped); if it already contains a field prefix (':')
    it is passed through verbatim."""
    parts = []
    if query:
        if ":" in query:
            parts.append(f"({query})")
        else:
            terms = [t for t in query.split() if t.lower() not in STOPWORDS]
            if not terms:
                # query was all stopwords; fall back to a phrase match
                parts.append(f'all:"{query}"')
            else:
                parts.append("(" + " AND ".join(f"all:{t}" for t in terms) + ")")
    if author:
        parts.append(f'au:"{author}"')
    if categories:
        cats = [c.strip() for c in categories.split(",") if c.strip()]
        if len(cats) == 1:
            parts.append(f"cat:{cats[0]}")
        elif cats:
            parts.append("(" + " OR ".join(f"cat:{c}" for c in cats) + ")")
    if not parts:
        die("Nothing to search: provide a query, --category, or --author.")
    return " AND ".join(parts)


def parse_atom(data: bytes):
    """Parse arXiv Atom XML. Returns (papers, total_results_or_None)."""
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        die(f"Failed to parse arXiv response as Atom XML: {e}")
    total = None
    t = root.find(f"{OPENSEARCH}totalResults")
    if t is not None and t.text and t.text.isdigit():
        total = int(t.text)
    papers = []
    for e in root.findall(f"{ATOM}entry"):
        raw_id = (e.findtext(f"{ATOM}id") or "").strip()
        m = re.search(r"abs/([^/]+)$", raw_id)
        if not m:
            continue  # error entries carry no abs id
        arxiv_id = m.group(1)
        title = re.sub(r"\s+", " ", e.findtext(f"{ATOM}title") or "").strip()
        abstract = re.sub(r"\s+", " ", e.findtext(f"{ATOM}summary") or "").strip()
        authors = [
            (a.findtext(f"{ATOM}name") or "").strip()
            for a in e.findall(f"{ATOM}author")
        ]
        cats = [c.get("term") for c in e.findall(f"{ATOM}category") if c.get("term")]
        prim = e.find(f"{ARXIV_NS}primary_category")
        primary = prim.get("term") if prim is not None else (cats[0] if cats else None)
        pdf = None
        abs_url = f"https://arxiv.org/abs/{arxiv_id}"
        for link in e.findall(f"{ATOM}link"):
            if link.get("title") == "pdf":
                pdf = (link.get("href") or "").replace("http://", "https://")
            elif link.get("rel") == "alternate":
                abs_url = (link.get("href") or abs_url).replace("http://", "https://")

        def _opt(tag):
            v = (e.findtext(f"{ARXIV_NS}{tag}") or "").strip()
            return v or None

        papers.append(
            {
                "id": arxiv_id,
                "title": title,
                "authors": authors,
                "abstract": abstract,
                "categories": cats,
                "primary_category": primary,
                "published": (e.findtext(f"{ATOM}published") or "").strip(),
                "updated": (e.findtext(f"{ATOM}updated") or "").strip(),
                "doi": _opt("doi"),
                "journal_ref": _opt("journal_ref"),
                "comment": _opt("comment"),
                "source": "arxiv",
                "urls": {"abs": abs_url, "pdf": pdf},
            }
        )
    return papers, total


# ---------------- output helpers ----------------


def truncate_abstracts(papers: list, limit: int = 600) -> list:
    for p in papers:
        a = p.get("abstract")
        if a and len(a) > limit:
            p["abstract"] = a[:limit].rstrip() + " …[truncated]"
            p["abstract_truncated"] = True
    return papers


def to_markdown(papers: list) -> str:
    lines = []
    for i, p in enumerate(papers, 1):
        title = p.get("title") or "(untitled)"
        url = (p.get("urls") or {}).get("abs") or ""
        meta = [p.get("id") or "?", (p.get("published") or "")[:10]]
        if p.get("primary_category"):
            meta.append(p["primary_category"])
        elif p.get("categories"):
            meta.append(",".join(p["categories"][:3]))
        if p.get("upvotes") is not None:
            meta.append(f"▲ {p['upvotes']}")
        if p.get("github_stars") is not None:
            meta.append(f"★ {p['github_stars']} stars")
        lines.append(f"{i}. **[{title}]({url})**")
        lines.append(f"   - {' · '.join(m for m in meta if m)}")
        authors = p.get("authors") or []
        if authors:
            auth = ", ".join(authors[:3]) + (" et al." if len(authors) > 3 else "")
            lines.append(f"   - {auth}")
        if p.get("abstract"):
            lines.append(f"   - {p['abstract']}")
        extra = []
        if p.get("github_repo"):
            extra.append(f"code: {p['github_repo']}")
        if p.get("project_page"):
            extra.append(f"project: {p['project_page']}")
        if extra:
            lines.append(f"   - {' | '.join(extra)}")
    return "\n".join(lines)


# ---------------- seen-file (incremental digest) ----------------


def seen_path() -> str:
    return os.environ.get(
        "PAPER_DISCOVERY_SEEN",
        os.path.expanduser("~/.cache/paper-discovery/seen.json"),
    )


def load_seen() -> set:
    try:
        with open(seen_path()) as f:
            return set(json.load(f).get("ids", []))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return set()


def save_seen(ids: set) -> None:
    path = seen_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"ids": list(ids)[-5000:]}, f)
    os.replace(tmp, path)
