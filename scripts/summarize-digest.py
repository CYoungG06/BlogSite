#!/usr/bin/env python3
"""Add AI-generated Chinese fields (titleZh / summaryZh) and interest scores
(score / reason / deepDive) to a daily papers digest, via the DeepSeek API
(OpenAI-compatible chat completions).

- Reads content/papers/<date>.json, fills missing fields, writes back atomically.
- Idempotent: papers that already have a score are never judged again
  (use --force to redo).
- 评分裁判依据兴趣画像(可持续维护):主栏目 scripts/interest-profile.md,
  具身栏目 scripts/interest-profile-embodied.md。主分类为 cs.RO 的论文直接按具身画像评分;
  其他论文先过一次便宜的主题分流(不开思考、批量),判为具身主题的转入具身栏目。
  分流不放进打分提示词:实测只要给打分输出多加一个字段,分数就整体下移约 0.2。
- arXiv 部分是「全量候选打分、按分入选」:当天全部候选都过裁判,
  首轮得分落在入选线附近(6–8)的再判一次取平均,压低裁判自身的波动;
  然后由 digest_select.py 选出正文(≥7 分,主栏目至多 50 篇、具身至多 10 篇)。
- HF 热门不做筛选:score ≤ 4 派生 relevant:false(展示层折叠)。deepDive 每日至多保留 10 个。
- Graceful: no API key or per-paper failures just leave fields absent; the site
  renders fine without them (falls back to English title + abstract).

Env:
  DEEPSEEK_API_KEY   required (auto-loaded from repo .env if present)
  DEEPSEEK_MODEL     default deepseek-flash
  DEEPSEEK_THINKING  default 1 (reasoning_effort=high + thinking enabled); 0 disables

Usage:
  python3 scripts/summarize-digest.py 2026-07-20
  python3 scripts/summarize-digest.py --date 2026-07-20 --workers 8
"""
import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import digest_select

API_URL = "https://api.deepseek.com/chat/completions"
TIMEOUT = 180
RETRIES = 2
DEEPDIVE_DAILY_CAP = 10  # 每日深度解读候选上限(按 score 取前 N)
RELEVANT_MIN_SCORE = 5  # score 低于此值判 relevant:false
# 首轮得分在这个区间的 arXiv 候选再判一次取平均。实测同一裁判重复运行时,
# 前 50 名只有约 44 篇重合;只对这一段(约四成候选)复判就能提到约 46 篇,
# 效果与全部判两次相同。
RESCORE_RANGE = (6, 8)

PROFILE_FILES = {
    "main": "interest-profile.md",
    digest_select.EMBODIED_TRACK: "interest-profile-embodied.md",
}


def load_interest_profile(track: str = "main") -> str:
    path = os.path.join(os.path.dirname(__file__), PROFILE_FILES[track])
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        warn(f"interest profile not found at {path}; scoring without it")
        return ""


SYSTEM_PROMPT = """你是技术论文速览编辑,读者是 ML/LLM 方向的研究者与工程师。
给定一篇论文的标题与摘要,输出一个 JSON 对象(不要输出其他内容):
{"titleZh": "...", "summaryZh": "...", "score": 0, "reason": "...", "deepDive": false}
要求:
- titleZh:标题的准确中文翻译,保留 Transformer、RL、RAG 等通用术语原文,书名号或引号视需要
- summaryZh:二到四句话的中文导读(总字数 120–250),依次说清「解决什么问题 + 方法要点(关键机制/组件)+ 关键结果(有数据带数据)+ 意义或适用场景」;直接陈述,不要"本文""作者提出"式套话开头,不要评价性形容词堆砌
- titleZh/summaryZh/reason 的中文标点一律用全角(,,。;等),术语与英文之间不留多余空格
- score:0–10 整数,论文与读者兴趣的相关程度,严格依据下面的兴趣画像与打分手则
- reason:一句中文(≤40 字)说明打分依据,如"GRPO 改进,直接命中后训练方向"
- deepDive:是否值得做深度解读,严格依据画像中的 deepDive 手则
- 只输出 JSON

# 兴趣画像

{profile}"""

USER_TEMPLATE = """标题:{title}
分类:{category}
备注:{comment}
摘要:{abstract}"""


def warn(msg: str) -> None:
    print(f"[summarize] {msg}", file=sys.stderr)


def normalize_zh_punct(s: str) -> str:
    """中文语境的半角逗号统一为全角:逗号任一侧是 CJK 字符时替换(数字千分位不动)。"""
    out = list(s)
    for i, ch in enumerate(out):
        if ch != "\u002c":
            continue
        prev = s[i - 1] if i > 0 else ""
        nxt = s[i + 1] if i + 1 < len(s) else ""
        if prev.isdigit() and nxt.isdigit():
            continue
        if ("一" <= prev <= "鿿") or ("一" <= nxt <= "鿿"):
            out[i] = "\uff0c"
    return "".join(out)


def load_env_key() -> str | None:
    key = os.environ.get("DEEPSEEK_API_KEY")
    if key:
        return key
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    try:
        with open(env_path) as f:
            for line in f:
                m = re.match(r"\s*DEEPSEEK_API_KEY\s*=\s*(\S+)", line)
                if m:
                    return m.group(1).strip().strip('"').strip("'")
    except OSError:
        pass
    return None


def call_deepseek(key: str, paper: dict, profile: str) -> dict | None:
    """One judge call. Returns the parsed fields or None after retries."""
    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-flash")
    thinking = os.environ.get("DEEPSEEK_THINKING", "1") != "0"
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT.replace("{profile}", profile)},
            {
                "role": "user",
                "content": USER_TEMPLATE.format(
                    title=paper.get("title", ""),
                    category=paper.get("primaryCategory") or "n/a",
                    comment=paper.get("comment") or "n/a",
                    abstract=paper.get("abstract", ""),
                ),
            },
        ],
        "stream": False,
        "response_format": {"type": "json_object"},
    }
    if thinking:
        body["reasoning_effort"] = "high"
        body["thinking"] = {"type": "enabled"}

    payload = json.dumps(body).encode("utf-8")
    last_err = None
    for attempt in range(1, RETRIES + 2):
        req = urllib.request.Request(
            API_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            obj = json.loads(re.sub(r"^```(json)?|```$", "", content.strip(), flags=re.M))
            title_zh = normalize_zh_punct(str(obj.get("titleZh", "")).strip())
            summary_zh = normalize_zh_punct(str(obj.get("summaryZh", "")).strip())
            if not title_zh or not summary_zh:
                raise ValueError(f"empty fields in response: {content[:120]}")
            try:
                score = max(0, min(10, int(obj.get("score"))))
            except (TypeError, ValueError):
                raise ValueError(f"bad score in response: {content[:120]}")
            result = {
                "titleZh": title_zh,
                "summaryZh": summary_zh,
                "score": score,
                "reason": normalize_zh_punct(str(obj.get("reason", "")).strip()),
                "deepDive": bool(obj.get("deepDive")) and score >= 8,
            }
            return result
        except Exception as e:  # HTTP/JSON/timeout: retry, then give up on this paper
            last_err = e
            if attempt <= RETRIES:
                time.sleep(3 * attempt)
    warn(f"  failed: {paper.get('id')} ({last_err})")
    return None


ROUTE_BATCH = 25
ROUTE_PROMPT = """你是论文主题分类员。判断每篇论文的研究对象是否属于「具身智能 / 机器人」:
机器人策略与控制、Vision-Language-Action(VLA)模型、世界-动作模型(World Action Model, WAM)与面向机器人的世界模型、
在物理世界或其仿真中行动的具身智能体、机器人数据与评测、自动驾驶。只看主题,不看质量;
纯软件智能体(GUI / 网页 / 代码 / 游戏)与一般的视频 / 3D 生成不算。
用户会给出多篇带编号的论文。只输出 JSON:{"embodied": [编号, ...]},一篇都没有就输出空数组。"""


def route_embodied(key: str, papers: list) -> None:
    """Tag papers whose topic is embodied AI so they are judged with that
    profile. One cheap non-thinking call per ROUTE_BATCH papers; on any failure
    the batch simply stays on the main track."""
    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-flash")

    def classify(chunk: list) -> None:
        listing = "\n\n".join(
            f"[{i}]\n标题:{p.get('title', '')}\n摘要:{(p.get('abstract') or '')[:600]}"
            for i, p in enumerate(chunk, 1)
        )
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": ROUTE_PROMPT},
                {"role": "user", "content": listing},
            ],
            "stream": False,
            "response_format": {"type": "json_object"},
            "thinking": {"type": "disabled"},
        }
        for attempt in range(1, RETRIES + 2):
            req = urllib.request.Request(
                API_URL,
                data=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
            )
            try:
                with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                flagged = json.loads(data["choices"][0]["message"]["content"]).get("embodied", [])
                for index in flagged:
                    if isinstance(index, int) and 1 <= index <= len(chunk):
                        chunk[index - 1]["track"] = digest_select.EMBODIED_TRACK
                return
            except Exception as e:  # 分流失败不阻塞:留在主栏目
                if attempt > RETRIES:
                    warn(f"  topic routing failed for {len(chunk)} papers ({e}); keeping them on the main track")
                else:
                    time.sleep(3 * attempt)

    chunks = [papers[i:i + ROUTE_BATCH] for i in range(0, len(papers), ROUTE_BATCH)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(classify, chunks))


def judge_paper(key: str, paper: dict, profiles: dict, stabilize: bool) -> dict | None:
    """Judge one paper with its track's profile; returns the fields to merge
    into it, or None. With `stabilize`, a first score inside RESCORE_RANGE gets
    a second, independent judgement and the two scores are averaged.
    """
    track = digest_select.track_of(paper)
    first = call_deepseek(key, paper, profiles[track])
    if not first:
        return None

    score = first["score"]
    if stabilize and RESCORE_RANGE[0] <= score <= RESCORE_RANGE[1]:
        second = call_deepseek(key, paper, profiles[track])
        if second:
            mean = (score + second["score"]) / 2
            score = int(mean) if mean == int(mean) else mean

    result = {
        "titleZh": first["titleZh"],
        "summaryZh": first["summaryZh"],
        "score": score,
        "reason": first["reason"],
        "deepDive": first["deepDive"] and score >= 8,
    }
    # 只在判为不相关时落字段(缺省视为相关,JSON 更瘦)
    if score < RELEVANT_MIN_SCORE:
        result["relevant"] = False
    return result


def merge_judgement(paper: dict, result: dict, keep_score: bool) -> None:
    """Write a judgement into a paper record. With `keep_score` only the text
    fields are taken (the paper already has a final score from an earlier run)."""
    if keep_score:
        for k in ("titleZh", "summaryZh"):
            paper[k] = result[k]
        paper.setdefault("reason", result["reason"])
        return
    # 清掉上一轮可能留下的旧判定字段,以本轮为准
    for k in ("relevant", "score", "reason", "deepDive"):
        paper.pop(k, None)
    paper.update(result)
    if not result["deepDive"]:
        paper.pop("deepDive", None)


def run_judge(key: str, jobs: list, profiles: dict, workers: int) -> None:
    """jobs: (paper, stabilize, keep_score) tuples, judged in parallel."""
    if not jobs:
        return
    lock = threading.Lock()
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(judge_paper, key, paper, profiles, stabilize): (paper, keep_score)
            for paper, stabilize, keep_score in jobs
        }
        for fut in as_completed(futures):
            paper, keep_score = futures[fut]
            result = fut.result()
            if result:
                merge_judgement(paper, result, keep_score)
            with lock:
                done += 1
                if done % 25 == 0 or done == len(jobs):
                    warn(f"  progress {done}/{len(jobs)}")


def write_digest(path: str, digest: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(digest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("date", nargs="?", help="digest date YYYY-MM-DD")
    ap.add_argument("--date", dest="date_opt")
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--output-dir", default="content/papers")
    args = ap.parse_args()

    day = args.date or args.date_opt
    if not day or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        ap.error("provide a date like 2026-07-20")

    path = os.path.join(args.output_dir, f"{day}.json")
    try:
        with open(path) as f:
            digest = json.load(f)
    except OSError:
        # 周末/节假日两源天然无收录,fetch 不落盘,属正常情况,安静跳过;
        # 工作日文件缺失则视为异常(源站故障/双空),exit 1 让 workflow
        # 开 Issue 报警——保证平日漏抓一定有人知道。fetch 硬失败本身
        # 也会以非零退出码先一步报警
        is_weekday = datetime.strptime(day, "%Y-%m-%d").weekday() < 5
        if is_weekday:
            warn(f"Error: {path} not found on a weekday; treating as fetch failure.")
            sys.exit(1)
        warn(f"{path} not found (weekend/holiday empty day); nothing to summarize.")
        sys.exit(0)

    # 旧版速递(没有 pool 字段)的 arXiv 部分是当时定稿的 50 篇,不按新规则重新筛选
    selects = "pool" in digest or "candidates" in digest

    key = load_env_key()
    if not key:
        # 没有裁判:fetch 已经把最新的论文临时放进正文,其余候选不必进仓库
        if digest.pop("candidates", None):
            write_digest(path, digest)
        warn("DEEPSEEK_API_KEY not set; skipping AI summaries (site renders without them).")
        sys.exit(0)

    profiles = {track: load_interest_profile(track) for track in PROFILE_FILES}
    hf = digest.get("hf", [])
    pool = digest_select.pool_of(digest)
    unsummarized = lambda p: not (p.get("titleZh") and p.get("summaryZh"))

    # 第一步:所有还没有分数的论文过裁判(HF 不复判;arXiv 候选在入选线附近的复判)
    jobs = [(p, False, False) for p in hf if args.force or p.get("score") is None or unsummarized(p)]
    jobs += [(p, selects, False) for p in pool if args.force or p.get("score") is None]
    if not selects:
        jobs += [(p, False, False) for p in pool if p.get("score") is not None and unsummarized(p) and not args.force]
    total = len(hf) + len(pool)
    if jobs:
        # 先分流再打分:还没定栏目的论文(HF 与主分类候选)看主题是否属于具身
        unrouted = [p for p, _, _ in jobs if digest_select.track_of(p) == "main"]
        route_embodied(key, unrouted)
        moved = sum(digest_select.track_of(p) != "main" for p in unrouted)
        warn(f"{day}: routed {moved}/{len(unrouted)} papers to the embodied track by topic")
        warn(f"{day}: judging {len(jobs)}/{total} papers with {args.workers} workers...")
        run_judge(key, jobs, profiles, args.workers)

    # 第二步:按分入选;入选但只有分数没有导读的(上一轮未入选、这一轮递补)补一次导读
    if selects:
        digest = digest_select.apply(digest, pool)
        fill = [(p, False, True) for p in digest["arxiv"] + digest.get("embodied", []) if unsummarized(p)]
        if fill:
            warn(f"{day}: writing summaries for {len(fill)} promoted papers...")
            run_judge(key, fill, profiles, args.workers)
    elif not jobs:
        warn(f"{day}: all {total} papers already summarized.")
        return

    # deepDive 每日上限:候选超过时按 score 取前 N,其余降级为普通高分
    papers = hf + digest.get("arxiv", []) + digest.get("embodied", [])
    picks = sorted(
        (p for p in papers if p.get("deepDive")),
        key=lambda p: p.get("score") or 0,
        reverse=True,
    )
    if len(picks) > DEEPDIVE_DAILY_CAP:
        for p in picks[DEEPDIVE_DAILY_CAP:]:
            p.pop("deepDive", None)
        warn(f"deepDive candidates {len(picks)} -> {DEEPDIVE_DAILY_CAP} (capped by score)")

    ok = sum(1 for p in papers if p.get("titleZh") and p.get("summaryZh"))
    flagged = sum(1 for p in papers if p.get("deepDive"))
    write_digest(path, digest)
    counts = digest.get("pool") or {}
    warn(
        f"{day}: hf={len(hf)} arxiv={len(digest.get('arxiv', []))}/{counts.get('main', '-')} "
        f"embodied={len(digest.get('embodied', []))}/{counts.get(digest_select.EMBODIED_TRACK, '-')} "
        f"overflow={len(digest.get('overflow', []))} unjudged={len(digest.get('candidates', []))}; "
        f"{ok}/{len(papers)} shown papers have zh fields, {flagged} deepDive picks; wrote {path}"
    )


if __name__ == "__main__":
    main()
