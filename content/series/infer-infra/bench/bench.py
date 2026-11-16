#!/usr/bin/env python3
"""推理 Infra 课程 · 第 9 课 · 压测脚本

对一个 OpenAI 兼容的服务端（vLLM / SGLang）做五类实验，输出 JSON：

  sweep    闭环并发扫描：固定并发数，测吞吐和延迟
  rate     开环到达率扫描：按泊松过程发请求，看排队和饱和
  prefill  prompt 长度扫描：测 TTFT 随 prompt 长度的变化，以及前缀缓存命中前后
  agent    回放一组 agent 会话：上下文逐步增长，中间有工具间隙
  merge    把上面的结果文件合并成一个 results.json

只依赖 aiohttp。用法见同目录 README.md。
"""
import argparse
import asyncio
import json
import os
import random
import statistics
import sys
import time

import aiohttp

WORDS = (
    "the of and to in is that for it as was with be by on not he this are or his from at "
    "which but have an had they you were their one all we can her has there been if more "
    "when will would who so no out up into than them time some could these two may then do "
    "first any my now such like our over man me even most made after also did many before "
    "must through back years where much your way well down should because each just those "
    "people how too little state good very make world still see own men work long here get "
    "both between life being under never day same another know while last might us great old "
    "year off come since against go came right used take three"
).split()


def pct(xs, p):
    if not xs:
        return None
    s = sorted(xs)
    k = min(len(s) - 1, max(0, int(round(p / 100 * (len(s) - 1)))))
    return s[k]


def tokens_in_window(r, w0, w1):
    """Output tokens of one request that were generated inside [w0, w1].

    Tokens are assumed evenly spaced between the first and the last one, so a
    request that straddles the window edge contributes its share rather than
    all or nothing. This keeps throughput honest when requests are long.
    """
    n = r["completion_tokens"]
    a, b = r.get("t_first"), r.get("t_last")
    if not r["ok"] or not n or a is None:
        return 0.0
    if b <= a:
        return float(n) if w0 <= a <= w1 else 0.0
    return n * max(0.0, min(b, w1) - max(a, w0)) / (b - a)


def summarize(recs, w0, w1, by="t_start"):
    """Throughput from tokens generated inside [w0, w1].

    Latency comes from requests that started (open loop) or ended (closed loop)
    inside the window. Open loop must use start time: counting only the requests
    that managed to finish would hide the ones stuck in the queue.
    """
    window_s = w1 - w0
    started = [r for r in recs if w0 <= r[by] <= w1]
    ok = [r for r in started if r["ok"]]
    tok = sum(tokens_in_window(r, w0, w1) for r in recs)
    done = [r for r in recs if r["ok"]]
    mean_out = statistics.fmean(r["completion_tokens"] for r in done) if done else 0
    out = {
        "requests": len(started),
        "errors": len(started) - len(ok),
        "out_tok_per_s": tok / window_s,
        "req_per_s": (tok / window_s / mean_out) if mean_out else 0.0,
    }
    for key in ("ttft", "tpot", "e2e"):
        vals = [r[key] * 1000 for r in ok if r.get(key) is not None]
        out[key + "_ms"] = {
            "p50": pct(vals, 50), "p95": pct(vals, 95), "p99": pct(vals, 99),
            "mean": statistics.fmean(vals) if vals else None,
        }
    return out


class Client:
    def __init__(self, urls, model, read_timeout):
        self.urls = [u.rstrip("/") for u in urls]
        self.model = model
        self.read_timeout = read_timeout
        self.session = None
        self.tpw = 1.0        # tokens per word, calibrated
        self.overhead = 0     # chat template overhead in tokens
        self.engine = None
        self.inflight = 0
        self.max_inflight = 0

    async def open(self):
        self.session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(limit=0),
            timeout=aiohttp.ClientTimeout(total=None, sock_read=self.read_timeout),
        )
        async with self.session.get(self.urls[0] + "/v1/models") as r:
            data = (await r.json())["data"][0]
        self.engine = data.get("owned_by")
        if not self.model:
            self.model = data["id"]

    async def close(self):
        await self.session.close()

    def text(self, tokens, rng):
        n = max(1, round(tokens / self.tpw))
        return " ".join(rng.choice(WORDS) for _ in range(n))

    async def calibrate(self):
        rng = random.Random(1)
        a = await self.chat([{"role": "user", "content": "hello"}], 1)
        b = await self.chat([{"role": "user", "content": " ".join(rng.choice(WORDS) for _ in range(800))}], 1)
        if not (a["ok"] and b["ok"] and b["prompt_tokens"] > a["prompt_tokens"]):
            raise SystemExit("校准失败：%s / %s" % (a.get("error"), b.get("error")))
        self.tpw = (b["prompt_tokens"] - a["prompt_tokens"]) / 799
        self.overhead = a["prompt_tokens"] - 1
        print("校准：每个词 %.3f token，模板开销 %d token，服务端 %s，模型 %s"
              % (self.tpw, self.overhead, self.engine, self.model), file=sys.stderr)

    async def chat(self, messages, max_tokens, url_idx=0, extra=None):
        body = {
            "model": self.model, "messages": messages, "max_tokens": max_tokens,
            "stream": True, "stream_options": {"include_usage": True},
            "temperature": 0, "ignore_eos": True,
        }
        if extra:
            body.update(extra)
        rec = {"ok": False, "ttft": None, "tpot": None, "e2e": None, "prompt_tokens": 0,
               "completion_tokens": 0, "cached_tokens": None, "endpoint": url_idx, "text": ""}
        self.inflight += 1
        self.max_inflight = max(self.max_inflight, self.inflight)
        start = time.perf_counter()
        rec["t_start"] = start
        try:
            async with self.session.post(self.urls[url_idx] + "/v1/chat/completions", json=body) as resp:
                if resp.status != 200:
                    rec["error"] = "HTTP %d: %s" % (resp.status, (await resp.text())[:200])
                    return rec
                first = last = None
                chunks = 0
                parts = []
                usage = None
                async for raw in resp.content:
                    line = raw.strip()
                    if not line.startswith(b"data:"):
                        continue
                    data = line[5:].strip()
                    if data == b"[DONE]":
                        break
                    obj = json.loads(data)
                    if obj.get("usage"):
                        usage = obj["usage"]
                    for ch in obj.get("choices") or []:
                        d = ch.get("delta") or {}
                        piece = d.get("content") or d.get("reasoning_content") or d.get("reasoning") or ""
                        if piece:
                            now = time.perf_counter()
                            first = first or now
                            last = now
                            chunks += 1
                            if d.get("content"):
                                parts.append(d["content"])
                end = time.perf_counter()
                rec["text"] = "".join(parts)
                if usage:
                    rec["prompt_tokens"] = usage.get("prompt_tokens") or 0
                    rec["completion_tokens"] = usage.get("completion_tokens") or chunks
                    det = usage.get("prompt_tokens_details") or {}
                    if det.get("cached_tokens") is not None:
                        rec["cached_tokens"] = det["cached_tokens"]
                else:
                    rec["completion_tokens"] = chunks
                if first is None:
                    rec["error"] = "没有收到任何输出"
                    return rec
                rec["ttft"] = first - start
                rec["t_first"], rec["t_last"] = first, last
                rec["e2e"] = end - start
                n = rec["completion_tokens"]
                if n > 1:
                    rec["tpot"] = (last - first) / (n - 1)
                rec["ok"] = True
        except Exception as e:  # noqa: BLE001 - report any transport error as a failed request
            rec["error"] = "%s: %s" % (type(e).__name__, e)
        finally:
            self.inflight -= 1
            rec["t_end"] = time.perf_counter()
        return rec

    async def metrics(self):
        """Sum a few cache-related Prometheus counters, if the server exposes them."""
        out = {}
        for u in self.urls:
            try:
                async with self.session.get(u + "/metrics") as r:
                    body = await r.text()
            except Exception:  # noqa: BLE001
                continue
            for line in body.splitlines():
                if line.startswith("#") or " " not in line:
                    continue
                name = line.split("{")[0].split(" ")[0]
                if any(k in name for k in ("prefix_cache", "cache_hit", "cached_token", "preempt")):
                    try:
                        out[name] = out.get(name, 0.0) + float(line.rsplit(" ", 1)[1])
                    except ValueError:
                        pass
        return out


def unique_prompt(client, tokens, rng):
    """A prompt that shares no prefix with any other: starts with a random nonce."""
    nonce = "%016x" % rng.getrandbits(64)
    return [{"role": "user", "content": "id " + nonce + " " + client.text(tokens, rng)}]


# ───────────────────────── sweep ─────────────────────────
async def closed_level(client, conc, duration, warmup, P, O, seed, max_factor=4):
    """Hold `conc` requests in flight. The level runs for at least `duration` seconds after
    warmup and is extended (up to max_factor x) until enough requests have finished inside
    the window, so that long requests at high concurrency still give latency samples."""
    t0 = time.perf_counter()
    w0 = t0 + warmup
    need = max(20, conc)
    recs = []
    state = {"stop": False}

    def finished_in_window():
        return sum(1 for r in recs if r["ok"] and r["t_end"] >= w0)

    async def worker(i):
        rng = random.Random(seed * 100003 + i)
        await asyncio.sleep(rng.random() * warmup * 0.8)   # stagger: avoid everyone prefilling in lockstep
        while not state["stop"]:
            recs.append(await client.chat(unique_prompt(client, P, rng), O))

    async def controller():
        while True:
            await asyncio.sleep(0.25)
            el = time.perf_counter() - w0
            if el >= duration and (finished_in_window() >= need or el >= duration * max_factor):
                state["stop"] = True
                return time.perf_counter()

    ctl = asyncio.ensure_future(controller())
    await asyncio.gather(*[worker(i) for i in range(conc)])
    w1 = await ctl
    s = summarize(recs, w0, w1, by="t_end")
    s["concurrency"] = conc
    s["window_s"] = w1 - w0
    return s


async def cmd_sweep(client, a):
    levels = []
    for c in a.concurrency:
        s = await closed_level(client, c, a.duration, a.warmup, a.prompt_tokens, a.max_tokens, c)
        levels.append(s)
        print("并发 %4d  %7.1f tok/s  %6.2f req/s  TTFT p50 %7.1f ms  TPOT p50 %6.2f ms  错误 %d" % (
            c, s["out_tok_per_s"], s["req_per_s"], s["ttft_ms"]["p50"] or -1, s["tpot_ms"]["p50"] or -1, s["errors"]),
            file=sys.stderr)
    return {"kind": "sweep", "config": {"prompt_tokens": a.prompt_tokens, "max_tokens": a.max_tokens,
                                        "duration": a.duration, "warmup": a.warmup}, "levels": levels}


# ───────────────────────── rate ─────────────────────────
async def open_level(client, rate, duration, warmup, P, O, seed, grace):
    rng = random.Random(seed)
    t0 = time.perf_counter()
    end_send = t0 + warmup + duration
    tasks = []
    client.max_inflight = client.inflight
    samples = []

    async def sampler():
        while True:
            await asyncio.sleep(0.5)
            samples.append((time.perf_counter(), client.inflight))

    smp = asyncio.ensure_future(sampler())
    while True:
        now = time.perf_counter()
        if now >= end_send:
            break
        tasks.append(asyncio.ensure_future(client.chat(unique_prompt(client, P, rng), O)))
        await asyncio.sleep(rng.expovariate(rate))
    smp.cancel()
    backlog = client.inflight
    mid = t0 + warmup + duration / 2
    h1 = [n for t, n in samples if t0 + warmup <= t < mid]
    h2 = [n for t, n in samples if t >= mid]
    done, pending = await asyncio.wait(tasks, timeout=grace) if tasks else (set(), set())
    for t in pending:
        t.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
    recs = [t.result() for t in done]
    s = summarize(recs, t0 + warmup, end_send)
    s.update({"offered_req_per_s": rate, "backlog_at_end": backlog, "max_inflight": client.max_inflight,
              "unfinished": len(pending),
              # in a stable system the number in flight levels off; if the second half of the
              # window holds clearly more than the first, requests are piling up
              "inflight_first_half": statistics.fmean(h1) if h1 else None,
              "inflight_second_half": statistics.fmean(h2) if h2 else None})
    return s


async def cmd_rate(client, a):
    rates = a.rates
    if not rates:
        with open(a.from_sweep) as f:
            sw = json.load(f)
        peak = max(l["req_per_s"] for l in sw["levels"])
        rates = [round(peak * x, 3) for x in a.fractions]
        print("闭环扫描测到的最高吞吐是 %.2f req/s，按它的 %s 倍发" % (peak, a.fractions), file=sys.stderr)
    levels = []
    for r in rates:
        s = await open_level(client, r, a.duration, a.warmup, a.prompt_tokens, a.max_tokens, int(r * 1000), a.grace)
        levels.append(s)
        print("到达率 %6.2f req/s  完成 %6.2f req/s  TTFT p50 %8.1f  p99 %8.1f ms  在途 前半 %.0f 后半 %.0f  未完成 %d" % (
            r, s["req_per_s"], s["ttft_ms"]["p50"] or -1, s["ttft_ms"]["p99"] or -1,
            s["inflight_first_half"] or 0, s["inflight_second_half"] or 0, s["unfinished"]), file=sys.stderr)
    return {"kind": "rate", "config": {"prompt_tokens": a.prompt_tokens, "max_tokens": a.max_tokens,
                                       "duration": a.duration, "warmup": a.warmup}, "levels": levels}


# ───────────────────────── prefill ─────────────────────────
async def cmd_prefill(client, a):
    rows = []
    rng = random.Random(7)
    for L in a.lengths:
        cold = []
        for _ in range(a.repeats):
            r = await client.chat(unique_prompt(client, L, rng), 2)
            if r["ok"]:
                cold.append(r)
        msgs = unique_prompt(client, L, rng)
        first = await client.chat(msgs, 2)
        warm = await client.chat(msgs, 2)
        if not cold or not warm["ok"]:
            print("长度 %d 失败：%s" % (L, (warm.get("error") or first.get("error"))), file=sys.stderr)
            continue
        row = {"target_tokens": L,
               "prompt_tokens": round(statistics.fmean(r["prompt_tokens"] for r in cold)),
               "ttft_cold_ms": statistics.median(r["ttft"] for r in cold) * 1000,
               "ttft_warm_ms": warm["ttft"] * 1000,
               "cached_tokens": warm["cached_tokens"]}
        rows.append(row)
        print("prompt %6d token  冷 %8.1f ms  热 %7.1f ms  命中 %s" % (
            row["prompt_tokens"], row["ttft_cold_ms"], row["ttft_warm_ms"], row["cached_tokens"]), file=sys.stderr)
    return {"kind": "prefill", "config": {"repeats": a.repeats}, "rows": rows}


# ───────────────────────── agent ─────────────────────────
async def cmd_agent(client, a):
    sys_text = client.text(a.system_tokens, random.Random(12345 + a.seed))
    n_ep = len(client.urls)
    rr = [0]
    steps = []
    task_times = []
    before = await client.metrics()
    t_run = time.perf_counter()
    stop_bg = asyncio.Event()

    async def session(i):
        rng = random.Random(a.seed * 1000003 + 900000 + i)
        await asyncio.sleep(rng.random() * a.stagger)
        t0 = time.perf_counter()
        hist = [{"role": "system", "content": sys_text}]
        extra = {"session_id": "bench-%d-%d" % (a.seed, i)} if a.send_session_id else None
        for j in range(a.steps):
            hist.append({"role": "user", "content": "[step %d result] %s" % (j + 1, client.text(a.step_tokens, rng))})
            msgs = hist
            if a.mode == "timestamp":
                msgs = [{"role": "system", "content": "now=%d %s" % (time.time_ns(), sys_text)}] + hist[1:]
            if a.route == "session":
                ep = i % n_ep
            else:
                ep = rr[0] % n_ep
                rr[0] += 1
            r = await client.chat(msgs, a.max_tokens, ep, extra)
            steps.append({"session": i, "step": j + 1, "ok": r["ok"], "ttft_ms": (r["ttft"] or 0) * 1000,
                          "e2e_ms": (r["e2e"] or 0) * 1000, "prompt_tokens": r["prompt_tokens"],
                          "cached_tokens": r["cached_tokens"], "completion_tokens": r["completion_tokens"],
                          "endpoint": ep, "error": r.get("error")})
            hist.append({"role": "assistant", "content": r["text"] or "ok"})
            if j < a.steps - 1 and a.gap > 0:
                await asyncio.sleep(rng.expovariate(1 / a.gap) if a.gap_dist == "exp" else a.gap)
        task_times.append(time.perf_counter() - t0)

    async def background():
        rng = random.Random(4242 + a.seed)
        pend = set()
        while not stop_bg.is_set():
            t = asyncio.ensure_future(client.chat(unique_prompt(client, a.bg_tokens, rng), 50, rng.randrange(n_ep)))
            pend.add(t)
            t.add_done_callback(pend.discard)
            await asyncio.sleep(rng.expovariate(a.bg_rate))
        if pend:
            await asyncio.wait(pend, timeout=60)

    bg = asyncio.ensure_future(background()) if a.bg_rate > 0 else None
    await asyncio.gather(*[session(i) for i in range(a.sessions)])
    stop_bg.set()
    if bg:
        await bg
    wall = time.perf_counter() - t_run
    after = await client.metrics()

    ok = [s for s in steps if s["ok"]]
    later = [s for s in ok if s["step"] > 1]
    have_cached = bool(ok) and all(s["cached_tokens"] is not None for s in ok)
    p_tot = sum(s["prompt_tokens"] for s in ok)
    c_tot = sum(s["cached_tokens"] or 0 for s in ok)
    by_step = []
    for j in range(1, a.steps + 1):
        ss = [s for s in ok if s["step"] == j]
        if ss:
            by_step.append({"step": j, "ttft_ms": statistics.fmean(s["ttft_ms"] for s in ss),
                            "prompt_tokens": statistics.fmean(s["prompt_tokens"] for s in ss),
                            "cached_tokens": statistics.fmean(s["cached_tokens"] or 0 for s in ss) if have_cached else None})
    tt = [s["ttft_ms"] for s in later]
    summary = {
        "sessions": a.sessions, "steps": len(steps), "errors": len(steps) - len(ok), "wall_s": wall,
        "task_time_s": {"mean": statistics.fmean(task_times), "p50": pct(task_times, 50), "p95": pct(task_times, 95)},
        "ttft_ms": {"mean": statistics.fmean(tt) if tt else None, "p50": pct(tt, 50), "p95": pct(tt, 95), "p99": pct(tt, 99)},
        "prompt_tokens": p_tot, "cached_tokens": c_tot if have_cached else None,
        "cached_ratio": (c_tot / p_tot) if have_cached and p_tot else None,
        "computed_tokens": (p_tot - c_tot) if have_cached else None,
        "per_endpoint": [sum(1 for s in steps if s["endpoint"] == e) for e in range(n_ep)],
        "server_metrics_delta": {k: after[k] - before.get(k, 0) for k in after},
    }
    print("[%s] %d 个会话 %d 步  任务耗时 均值 %.1f s  TTFT 均值 %.0f ms p95 %.0f ms  命中率 %s  错误 %d" % (
        a.label, a.sessions, len(steps), summary["task_time_s"]["mean"], summary["ttft_ms"]["mean"] or -1,
        summary["ttft_ms"]["p95"] or -1,
        ("%.1f%%" % (summary["cached_ratio"] * 100)) if summary["cached_ratio"] is not None else "服务端未返回 cached_tokens",
        summary["errors"]), file=sys.stderr)
    cfg = {k: getattr(a, k) for k in ("sessions", "steps", "system_tokens", "step_tokens", "max_tokens", "gap",
                                       "gap_dist", "mode", "route", "bg_rate", "bg_tokens", "send_session_id", "seed")}
    cfg["endpoints"] = n_ep
    return {"kind": "agent", "label": a.label, "config": cfg, "summary": summary, "by_step": by_step, "steps": steps}


# ───────────────────────── merge ─────────────────────────
def cmd_merge(a):
    runs = []
    meta = {}
    for path in a.files:
        with open(path) as f:
            d = json.load(f)
        meta = meta or d.get("meta", {})
        d.pop("meta", None)
        if not a.keep_steps:
            d.pop("steps", None)   # per-request records stay in the individual files
        d["file"] = os.path.basename(path)
        runs.append(d)
    json.dump({"format": "infer-infra-bench-v1", "meta": meta, "runs": runs}, sys.stdout, ensure_ascii=False)
    print(file=sys.stdout)


def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp, P=512, O=128):
        sp.add_argument("--base-url", default="http://localhost:8000", help="服务端地址，多个用逗号分隔")
        sp.add_argument("--model", default=None, help="不填则用 /v1/models 返回的第一个")
        sp.add_argument("--out", required=True, help="结果 JSON 路径")
        sp.add_argument("--prompt-tokens", type=int, default=P)
        sp.add_argument("--max-tokens", type=int, default=O)
        sp.add_argument("--read-timeout", type=float, default=600)
        sp.add_argument("--note", default="", help="写进结果里的备注，比如启动参数")

    s = sub.add_parser("sweep", help="闭环并发扫描")
    common(s)
    s.add_argument("--concurrency", type=int, nargs="+", default=[1, 2, 4, 8, 16, 32, 64, 128, 256])
    s.add_argument("--duration", type=float, default=20)
    s.add_argument("--warmup", type=float, default=5)

    s = sub.add_parser("rate", help="开环到达率扫描")
    common(s)
    s.add_argument("--rates", type=float, nargs="*", default=[], help="每秒请求数；不填则按 --from-sweep 推算")
    s.add_argument("--from-sweep", default=None, help="sweep 的结果文件")
    s.add_argument("--fractions", type=float, nargs="+", default=[0.2, 0.4, 0.6, 0.8, 0.9, 1.0, 1.1])
    s.add_argument("--duration", type=float, default=30)
    s.add_argument("--warmup", type=float, default=5)
    s.add_argument("--grace", type=float, default=60, help="停止发送后最多再等多少秒")

    s = sub.add_parser("prefill", help="prompt 长度扫描")
    common(s)
    s.add_argument("--lengths", type=int, nargs="+", default=[1000, 2000, 4000, 8000, 16000, 24000])
    s.add_argument("--repeats", type=int, default=3)

    s = sub.add_parser("agent", help="回放 agent 会话")
    common(s, O=150)
    s.add_argument("--label", default="append")
    s.add_argument("--sessions", type=int, default=16)
    s.add_argument("--steps", type=int, default=12)
    s.add_argument("--system-tokens", type=int, default=4000)
    s.add_argument("--step-tokens", type=int, default=1500)
    s.add_argument("--gap", type=float, default=2.0, help="两步之间的工具耗时（秒）")
    s.add_argument("--gap-dist", choices=["fixed", "exp"], default="exp")
    s.add_argument("--stagger", type=float, default=5.0, help="会话在这段时间内陆续开始")
    s.add_argument("--mode", choices=["append", "timestamp"], default="append",
                   help="append：历史原样重发；timestamp：每步在最开头放一个变化的时间戳")
    s.add_argument("--route", choices=["rr", "session"], default="rr", help="多个服务端时：轮询，或按会话固定")
    s.add_argument("--bg-rate", type=float, default=0, help="背景一次性请求，每秒几个")
    s.add_argument("--bg-tokens", type=int, default=6000)
    s.add_argument("--send-session-id", action="store_true", help="在请求里带 session_id（SGLang 会话感知缓存用）")
    s.add_argument("--seed", type=int, default=0, help="换一个值就换一套文本，避免和上一次运行留下的缓存撞上")

    s = sub.add_parser("merge", help="合并结果文件，输出到标准输出")
    s.add_argument("files", nargs="+")
    s.add_argument("--keep-steps", action="store_true", help="保留 agent 实验里每个请求的明细（文件会大很多）")
    return p


async def amain(a):
    client = Client(a.base_url.split(","), a.model, a.read_timeout)
    await client.open()
    try:
        await client.calibrate()
        fn = {"sweep": cmd_sweep, "rate": cmd_rate, "prefill": cmd_prefill, "agent": cmd_agent}[a.cmd]
        res = await fn(client, a)
    finally:
        await client.close()
    res["meta"] = {"created": time.strftime("%Y-%m-%d %H:%M:%S"), "model": client.model, "engine": client.engine,
                   "base_urls": client.urls, "tokens_per_word": client.tpw, "note": a.note}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(res, f, ensure_ascii=False)
    print("已写入 " + a.out, file=sys.stderr)


def main():
    a = build_parser().parse_args()
    if a.cmd == "merge":
        cmd_merge(a)
    else:
        asyncio.run(amain(a))


if __name__ == "__main__":
    main()
