"""Selection rules for the daily digest's arXiv part (stdlib only).

Every eligible arXiv submission of the day is a *candidate*. The judge
(summarize-digest.py) scores all of them; this module then decides what the
digest keeps. Shared by fetch-daily-papers.py and summarize-digest.py so a
re-run that restores known scores reproduces the same digest byte for byte.

Digest fields owned by this module:
  arxiv       main-track picks, full records (score >= MIN_SCORE, at most MAIN_LIMIT)
  embodied    embodied-track picks, full records (same floor, at most EMBODIED_LIMIT)
  overflow    compact records of papers that cleared the floor but not the cap
  scores      {"main": {id: score}, "embodied": {id: score}} for every judged
              candidate that was not picked, so re-runs do not judge it again
  candidates  full records still waiting for the judge (transient; absent from a
              finished digest)
  pool        {"main": n, "embodied": n} candidate counts the picks were chosen from
"""

MAIN_LIMIT = 50
EMBODIED_LIMIT = 10
MIN_SCORE = 7  # 入选线:低于此分不进正文
EMBODIED_TRACK = "embodied"
EMBODIED_PRIMARY = {"cs.RO"}  # 这些主分类的论文直接进具身栏目评分

OWNED_KEYS = ("arxiv", "embodied", "overflow", "scores", "candidates", "pool")
OVERFLOW_FIELDS = ("id", "title", "titleZh", "score", "primaryCategory", "track", "urls")


def track_of(paper: dict) -> str:
    return EMBODIED_TRACK if paper.get("track") == EMBODIED_TRACK else "main"


def assign_track(paper: dict) -> None:
    """Initial routing by primary category; the judge may re-route later."""
    if paper.get("primaryCategory") in EMBODIED_PRIMARY:
        paper["track"] = EMBODIED_TRACK


def pool_of(digest: dict) -> list:
    """Full records currently held by a digest, in a stable order."""
    return digest.get("arxiv", []) + digest.get("embodied", []) + digest.get("candidates", [])


def restore_scores(papers: list, old: dict) -> None:
    """Give re-fetched candidates the scores a previous run stored compactly."""
    stored = old.get("scores") or {}
    # overflow 里的译名也带回来,否则重跑后同一条 overflow 记录会少一个字段
    titles = {p["id"]: p["titleZh"] for p in old.get("overflow") or [] if p.get("titleZh")}
    for paper in papers:
        if paper.get("score") is not None:
            continue
        if paper["id"] in titles:
            paper["titleZh"] = titles[paper["id"]]
        for track in ("main", EMBODIED_TRACK):
            score = (stored.get(track) or {}).get(paper["id"])
            if score is not None:
                paper["score"] = score
                if track == EMBODIED_TRACK:
                    paper["track"] = EMBODIED_TRACK
                else:
                    paper.pop("track", None)
                break


def _ranked(papers: list) -> list:
    # 同分时按 id 倒序(更晚提交的在前),保证结果确定
    return sorted(papers, key=lambda p: (-p["score"], _id_key(p["id"])))


def _id_key(pid: str):
    return tuple(-int(part) if part.isdigit() else 0 for part in pid.replace("v", ".").split("."))


def select(pool: list) -> dict:
    """Split a candidate pool into the digest fields listed in the module docstring.

    Papers without a score are never ranked against scored ones: they stay in
    `candidates` for the judge. Only when *nothing* has been judged (no API key,
    or the judge has not run yet) the newest main-track submissions are shown
    provisionally so the page is never empty.
    """
    seen, unique = set(), []
    for paper in pool:
        if paper["id"] not in seen:
            seen.add(paper["id"])
            unique.append(paper)

    scored = [p for p in unique if p.get("score") is not None]
    pending = [p for p in unique if p.get("score") is None]
    counts = {"main": 0, EMBODIED_TRACK: 0}
    for paper in unique:
        counts[track_of(paper)] += 1

    if not scored:
        newest_main = [p for p in pending if track_of(p) == "main"][:MAIN_LIMIT]
        shown = {p["id"] for p in newest_main}
        result = {"arxiv": newest_main, "candidates": [p for p in pending if p["id"] not in shown]}
    else:
        picks = {}
        for track, limit in (("main", MAIN_LIMIT), (EMBODIED_TRACK, EMBODIED_LIMIT)):
            eligible = [p for p in scored if track_of(p) == track and p["score"] >= MIN_SCORE]
            picks[track] = _ranked(eligible)[:limit]
        picked = {p["id"] for group in picks.values() for p in group}
        rest = [p for p in scored if p["id"] not in picked]
        result = {
            "arxiv": picks["main"],
            "embodied": picks[EMBODIED_TRACK],
            "overflow": [
                {k: p[k] for k in OVERFLOW_FIELDS if p.get(k) is not None}
                for p in _ranked([p for p in rest if p["score"] >= MIN_SCORE])
            ],
            "scores": {
                track: ids
                for track in ("main", EMBODIED_TRACK)
                if (ids := {p["id"]: p["score"] for p in sorted(rest, key=lambda p: p["id"]) if track_of(p) == track})
            },
            "candidates": pending,
        }
    result["pool"] = counts
    return result


def apply(digest: dict, pool: list) -> dict:
    """Return a copy of `digest` with the owned fields replaced by select(pool)."""
    out = {k: v for k, v in digest.items() if k not in OWNED_KEYS}
    for key, value in select(pool).items():
        # 空字段不落盘:旧数据与没有具身论文的日子保持原来的形状
        if value or key == "arxiv":
            out[key] = value
    return out
