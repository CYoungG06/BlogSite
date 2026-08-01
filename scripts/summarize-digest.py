#!/usr/bin/env python3
"""Add AI-generated Chinese fields (titleZh / summaryZh) and interest scores
(score / reason / deepDive) to a daily papers digest, via the DeepSeek API
(OpenAI-compatible chat completions).

- Reads content/papers/<date>.json, fills missing fields, writes back atomically.
- Idempotent: papers already having titleZh+summaryZh+score are skipped
  (use --force to redo).
- 评分裁判依据 scripts/interest-profile.md(兴趣画像,可持续维护);
  score ≤ 4 派生 relevant:false(展示层过滤),deepDive 每日至多保留 10 个。
- Graceful: no API key or per-paper failures just leave fields absent; the site
  renders fine without them (falls back to English title + abstract).

Env:
  DEEPSEEK_API_KEY   required (auto-loaded from repo .env if present)
  DEEPSEEK_MODEL     default deepseek-v4-flash
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

API_URL = "https://api.deepseek.com/chat/completions"
TIMEOUT = 180
RETRIES = 2
DEEPDIVE_DAILY_CAP = 10  # 每日深度解读候选上限(按 score 取前 N)
RELEVANT_MIN_SCORE = 5  # score 低于此值判 relevant:false

PROFILE_PATH = os.path.join(os.path.dirname(__file__), "interest-profile.md")


def load_interest_profile() -> str:
    try:
        with open(PROFILE_PATH, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        warn(f"interest profile not found at {PROFILE_PATH}; scoring without it")
        return ""


SYSTEM_PROMPT = """你是技术论文速览编辑,读者是 ML/LLM 方向的研究者与工程师。
给定一篇论文的标题与摘要,输出一个 JSON 对象(不要输出其他内容):
{"titleZh": "...", "summaryZh": "...", "score": 0, "reason": "...", "deepDive": false}
要求:
- titleZh:标题的准确中文翻译,保留 Transformer、RL、RAG 等通用术语原文,书名号或引号视需要
- summaryZh:二到四句话的中文导读(总字数 120–250),依次说清「解决什么问题 + 方法要点(关键机制/组件)+ 关键结果(有数据带数据)+ 意义或适用场景」;直接陈述,不要"本文""作者提出"式套话开头,不要评价性形容词堆砌
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
    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")
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
            title_zh = str(obj.get("titleZh", "")).strip()
            summary_zh = str(obj.get("summaryZh", "")).strip()
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
                "reason": str(obj.get("reason", "")).strip(),
                "deepDive": bool(obj.get("deepDive")) and score >= 8,
            }
            # 只在判为不相关时落字段(缺省视为相关,JSON 更瘦)
            if score < RELEVANT_MIN_SCORE:
                result["relevant"] = False
            return result
        except Exception as e:  # HTTP/JSON/timeout: retry, then give up on this paper
            last_err = e
            if attempt <= RETRIES:
                time.sleep(3 * attempt)
    warn(f"  failed: {paper.get('id')} ({last_err})")
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("date", nargs="?", help="digest date YYYY-MM-DD")
    ap.add_argument("--date", dest="date_opt")
    ap.add_argument("--workers", type=int, default=6)
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

    key = load_env_key()
    if not key:
        warn("DEEPSEEK_API_KEY not set; skipping AI summaries (site renders without them).")
        sys.exit(0)

    papers = digest.get("hf", []) + digest.get("arxiv", [])
    todo = [
        p
        for p in papers
        if args.force
        or not (p.get("titleZh") and p.get("summaryZh") and p.get("score") is not None)
    ]
    if not todo:
        warn(f"{day}: all {len(papers)} papers already summarized.")
        return
    warn(f"{day}: summarizing {len(todo)}/{len(papers)} papers with {args.workers} workers...")

    profile = load_interest_profile()
    lock = threading.Lock()
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(call_deepseek, key, p, profile): p for p in todo}
        for fut in as_completed(futures):
            paper = futures[fut]
            result = fut.result()
            if result:
                # 清掉上一轮可能留下的旧判定字段,以本轮为准
                for k in ("relevant", "score", "reason", "deepDive"):
                    paper.pop(k, None)
                paper.update(result)
            with lock:
                done += 1
                if done % 10 == 0 or done == len(todo):
                    warn(f"  progress {done}/{len(todo)}")

    # deepDive 每日上限:候选超过时按 score 取前 N,其余降级为普通高分
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
    scored = sum(1 for p in papers if p.get("score") is not None)
    flagged = sum(1 for p in papers if p.get("deepDive"))
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(digest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    warn(
        f"{day}: {ok}/{len(papers)} papers have zh fields, {scored} scored, "
        f"{flagged} deepDive picks; wrote {path}"
    )


if __name__ == "__main__":
    main()
