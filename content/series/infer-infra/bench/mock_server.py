#!/usr/bin/env python3
"""一个假的 OpenAI 兼容服务端，用来在没有 GPU 的机器上测通 bench.py。

它不跑模型，只按课程里的成本模型模拟一个带 continuous batching 和前缀缓存的引擎：
每轮迭代耗时 = 20 ms + 每个 decode 序列 0.4 ms + 每个 prefill token 0.1 ms，
每轮最多处理 8192 个 prefill token。一个词算一个 token。

    python mock_server.py --port 8000 [--speed 1] [--cache-tokens 600000]

--speed 大于 1 时模拟的时间按比例加快，方便快速自测。
它产生的数字只说明脚本和页面能正常工作，不代表任何真实硬件。
"""
import argparse
import asyncio
import json
import time

from aiohttp import web

BASE_MS, PER_SEQ_MS, PER_PREFILL_MS, BUDGET, BLOCK, TEMPLATE = 20.0, 0.4, 0.1, 8192, 16, 12


class Engine:
    def __init__(self, speed, cache_tokens, max_seqs):
        self.speed = speed
        self.cache_cap = cache_tokens
        self.max_seqs = max_seqs
        self.waiting = []
        self.running = []
        self.cache = []          # list of (token tuple, last_used), LRU by last_used
        self.cache_used = 0
        self.wake = asyncio.Event()

    def lookup(self, toks):
        best = 0
        hit = None
        for i, (c, _) in enumerate(self.cache):
            n = 0
            m = min(len(c), len(toks) - 1)
            while n < m and c[n] == toks[n]:
                n += 1
            if n > best:
                best, hit = n, i
        if hit is not None:
            self.cache[hit] = (self.cache[hit][0], time.monotonic())
        return best // BLOCK * BLOCK

    def store(self, toks):
        self.cache.append((toks, time.monotonic()))
        self.cache_used += len(toks)
        while self.cache_used > self.cache_cap and len(self.cache) > 1:
            j = min(range(len(self.cache)), key=lambda k: self.cache[k][1])
            self.cache_used -= len(self.cache[j][0])
            self.cache.pop(j)

    def submit(self, toks, max_tokens):
        req = {"toks": toks, "left": None, "out": max_tokens, "done": 0, "q": asyncio.Queue(), "cached": 0,
               "alive": True}
        self.waiting.append(req)
        self.wake.set()
        return req

    async def loop(self):
        while True:
            if not self.waiting and not self.running:
                self.wake.clear()
                await self.wake.wait()
            while self.waiting and len(self.running) < self.max_seqs:
                r = self.waiting.pop(0)
                r["cached"] = self.lookup(r["toks"])
                r["left"] = len(r["toks"]) - r["cached"]
                self.running.append(r)
            budget = BUDGET
            prefilled = 0
            decoding = []
            for r in self.running:
                if r["left"] > 0:
                    take = min(r["left"], budget)
                    r["left"] -= take
                    budget -= take
                    prefilled += take
                    if r["left"] == 0 and take > 0:
                        decoding.append(r)      # last prefill chunk also yields the first token
                else:
                    decoding.append(r)
            ms = BASE_MS + PER_SEQ_MS * len(decoding) + PER_PREFILL_MS * prefilled
            await asyncio.sleep(ms / 1000 / self.speed)
            keep = []
            for r in self.running:
                if not r["alive"]:
                    continue
                if r in decoding:
                    r["done"] += 1
                    r["q"].put_nowait("tok ")
                    if r["done"] >= r["out"]:
                        r["q"].put_nowait(None)
                        self.store(r["toks"] + ("tok",) * r["done"])
                        continue
                keep.append(r)
            self.running = keep


def tokenize(messages):
    toks = ["<t>"] * TEMPLATE
    for m in messages:
        toks.append("<" + m.get("role", "user") + ">")
        toks.extend(str(m.get("content", "")).split())
    return tuple(toks)


async def models(request):
    return web.json_response({"object": "list", "data": [{"id": "mock-model", "object": "model", "owned_by": "mock"}]})


async def metrics(request):
    return web.Response(text="# mock\n")


async def chat(request):
    eng = request.app["engine"]
    body = await request.json()
    toks = tokenize(body.get("messages", []))
    req = eng.submit(toks, int(body.get("max_tokens", 16)))
    usage = lambda: {"prompt_tokens": len(toks), "completion_tokens": req["done"],  # noqa: E731
                     "total_tokens": len(toks) + req["done"], "prompt_tokens_details": {"cached_tokens": req["cached"]}}
    if not body.get("stream"):
        parts = []
        while True:
            t = await req["q"].get()
            if t is None:
                break
            parts.append(t)
        return web.json_response({"id": "mock", "object": "chat.completion", "model": "mock-model", "usage": usage(),
                                  "choices": [{"index": 0, "finish_reason": "length",
                                               "message": {"role": "assistant", "content": "".join(parts)}}]})
    resp = web.StreamResponse(headers={"Content-Type": "text/event-stream"})
    await resp.prepare(request)
    try:
        while True:
            t = await req["q"].get()
            if t is None:
                break
            chunk = {"id": "mock", "object": "chat.completion.chunk", "model": "mock-model",
                     "choices": [{"index": 0, "delta": {"content": t}}]}
            await resp.write(b"data: " + json.dumps(chunk).encode() + b"\n\n")
        final = {"id": "mock", "object": "chat.completion.chunk", "model": "mock-model", "choices": [], "usage": usage()}
        await resp.write(b"data: " + json.dumps(final).encode() + b"\n\ndata: [DONE]\n\n")
    except (ConnectionResetError, asyncio.CancelledError):
        req["alive"] = False
        raise
    return resp


async def start_engine(app):
    app["task"] = asyncio.ensure_future(app["engine"].loop())


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--cache-tokens", type=int, default=600000)
    p.add_argument("--max-seqs", type=int, default=256)
    a = p.parse_args()
    app = web.Application(client_max_size=64 * 1024 * 1024)
    app["engine"] = Engine(a.speed, a.cache_tokens, a.max_seqs)
    app.on_startup.append(start_engine)
    app.add_routes([web.get("/v1/models", models), web.get("/metrics", metrics), web.post("/v1/chat/completions", chat)])
    web.run_app(app, port=a.port, print=None)


if __name__ == "__main__":
    main()
