#!/usr/bin/env python3
"""Add AI-generated Chinese fields (titleZh / summaryZh) to a daily papers
digest, via the DeepSeek API (OpenAI-compatible chat completions).

- Reads content/papers/<date>.json, fills missing fields, writes back atomically.
- Idempotent: papers already having both fields are skipped (use --force to redo).
- Graceful: no API key or per-paper failures just leave fields absent; the site
  renders fine without them (falls back to English title + abstract).

Env:
  DEEPSEEK_API_KEY   required (auto-loaded from repo .env if present)
  DEEPSEEK_MODEL     default deepseek-v4-pro
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

API_URL = "https://api.deepseek.com/chat/completions"
TIMEOUT = 180
RETRIES = 2

SYSTEM_PROMPT = """你是技术论文速览编辑,读者是 ML/LLM 方向的研究者与工程师。
给定一篇论文的标题与摘要,输出一个 JSON 对象(不要输出其他内容):
{"titleZh": "...", "summaryZh": "...", "relevant": true/false}
要求:
- titleZh:标题的准确中文翻译,保留 Transformer、RL、RAG 等通用术语原文,书名号或引号视需要
- summaryZh:二到四句话的中文导读(总字数 120–250),依次说清「解决什么问题 + 方法要点(关键机制/组件)+ 关键结果(有数据带数据)+ 意义或适用场景」;直接陈述,不要“本文”“作者提出”式套话开头,不要评价性形容词堆砌
- relevant:判断论文是否属于读者关注范围。关注:大语言模型与后训练(RL/蒸馏/对齐/推理)、多模态大模型(MLLM/VLM)、Agent(RL/harness/工具调用/规划)、AI for Research、LLM 系统与高效训练推理、MoE、长上下文、代码模型
  不关注:音频/视频/图像生成与视觉生成统一建模、视觉重建(3D/NeRF/Gaussian Splatting)、扩散模型(包括扩散语言模型在内,一刀切)、偏物理/硬件/光子/量子、生物医药/医疗影像/蛋白质结构/生物信息学、与 LLM 无关的纯理论或经典数值/统计方法、面向经典控制/机器人的强化学习(非基础模型或 LLM agent 方向)、语音识别/口语评测/TTS 等语音应用、能源/交通/农业/气象/教育等垂直行业应用
  拿不准时判 true
- 只输出 JSON"""

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


def call_deepseek(key: str, paper: dict) -> dict | None:
    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-pro")
    thinking = os.environ.get("DEEPSEEK_THINKING", "1") != "0"
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
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
            result = {"titleZh": title_zh, "summaryZh": summary_zh}
            # 只在判为不相关时落字段(缺省视为相关,JSON 更瘦)
            if obj.get("relevant") is False:
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
        warn(f"Error: {path} not found. Run fetch-daily-papers.py first.")
        sys.exit(1)

    key = load_env_key()
    if not key:
        warn("DEEPSEEK_API_KEY not set; skipping AI summaries (site renders without them).")
        sys.exit(0)

    papers = digest.get("hf", []) + digest.get("arxiv", [])
    todo = [p for p in papers if args.force or not (p.get("titleZh") and p.get("summaryZh"))]
    if not todo:
        warn(f"{day}: all {len(papers)} papers already summarized.")
        return
    warn(f"{day}: summarizing {len(todo)}/{len(papers)} papers with {args.workers} workers...")

    lock = threading.Lock()
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(call_deepseek, key, p): p for p in todo}
        for fut in as_completed(futures):
            paper = futures[fut]
            result = fut.result()
            if result:
                # 清掉上一轮可能留下的 relevant:false,以本轮判定为准
                paper.pop("relevant", None)
                paper.update(result)
            with lock:
                done += 1
                if done % 10 == 0 or done == len(todo):
                    warn(f"  progress {done}/{len(todo)}")

    ok = sum(1 for p in papers if p.get("titleZh") and p.get("summaryZh"))
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(digest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    warn(f"{day}: {ok}/{len(papers)} papers have zh fields; wrote {path}")


if __name__ == "__main__":
    main()
