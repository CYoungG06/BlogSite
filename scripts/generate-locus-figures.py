#!/usr/bin/env python3
"""生成蒸馏文《规模化自动后训练》(Intology/Locus)的插图,
输出到 public/images/distilled/locus-post-training/。

原文图表是 React 组件而非静态图片,这里按原文给出的数据点用 matplotlib
重绘;曲线类图为示意图(端点/平台期与文中一致),MDX 图注里已标明。
风格对齐站点:白底圆角卡片、zinc 灰阶、冷蓝 accent(#2952e3)。
运行:.venv/bin/python scripts/generate-locus-figures.py
"""

from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyBboxPatch

# ---------- 字体与全局风格 ----------

CJK_CANDIDATES = ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"]
available = {f.name for f in font_manager.fontManager.ttflist}
CJK = next((f for f in CJK_CANDIDATES if f in available), None)
assert CJK, f"找不到中文字体:{sorted(available)[:20]}"

plt.rcParams.update({
    "font.family": [CJK, "DejaVu Sans"],
    "axes.unicode_minus": False,
    "figure.dpi": 100,
})

INK = "#27272a"
MUTED = "#52525b"
FAINT = "#71717a"
ACCENT = "#2952e3"
ACCENT_TINT = "#eef2fd"
GRAY = "#a1a1aa"
BORDER = "#e4e4e7"

OUT = Path("public/images/distilled/locus-post-training")
OUT.mkdir(parents=True, exist_ok=True)


def add_card(fig, pad=0.012, radius=0.025):
    fig.patch.set_alpha(0)
    card = FancyBboxPatch(
        (pad, pad), 1 - 2 * pad, 1 - 2 * pad,
        boxstyle=f"round,pad=0,rounding_size={radius}",
        transform=fig.transFigure, facecolor="white",
        edgecolor=BORDER, linewidth=1.2, zorder=-100,
    )
    fig.add_artist(card)


def style_ax(ax):
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(BORDER)
    ax.tick_params(colors=MUTED, labelsize=10)
    ax.yaxis.label.set_color(MUTED)
    ax.xaxis.label.set_color(MUTED)


def save(fig, name):
    fig.savefig(OUT / name, bbox_inches="tight", pad_inches=0.12, transparent=True)
    plt.close(fig)
    print(f"wrote {OUT / name}")


# ---------- 图 1:PostTrainBench(Tier 1)综合分 ----------

def fig_tier1():
    rows = [
        ("Locus (Opus 5)", 44.7, True),
        ("Claude Code (Fable 5)", 41.8, False),
        ("Codex (GPT-5.6 Sol)", 36.2, False),
        ("Claude Code (Opus 5)", 34.1, False),
        ("Autoresearch (Opus 4.8)", 33.1, False),
        ("Claude Code (Opus 4.8)", 32.9, False),
        ("Claude Code (GLM 5.2)", 31.7, False),
        ("AlphaEvolve", 19.2, False),
    ]
    fig, ax = plt.subplots(figsize=(7.2, 4.2))
    add_card(fig)
    names = [r[0] for r in rows][::-1]
    vals = [r[1] for r in rows][::-1]
    colors = [ACCENT if r[2] else GRAY for r in rows][::-1]
    bars = ax.barh(names, vals, color=colors, height=0.62, zorder=3)
    for b, v in zip(bars, vals):
        ax.text(v + 0.5, b.get_y() + b.get_height() / 2, f"{v:.1f}",
                va="center", fontsize=10, color=INK, zorder=3)
    ax.set_xlim(0, 52)
    ax.set_xlabel("PostTrainBench 综合分(Tier 1 官方设定)")
    style_ax(ax)
    ax.grid(axis="x", color=BORDER, linewidth=0.7, zorder=0)
    save(fig, "tier1-composite.svg")


# ---------- 图 2:算力—性能曲线(示意) ----------

def fig_scaling():
    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    add_card(fig)
    x = np.linspace(0, 4000, 400)

    def plateau(x, start, mid, end, k1=900, k2=2600):
        """平滑两段:先升到 mid,再缓升到 end。"""
        y = start + (mid - start) * (1 - np.exp(-x / k1))
        y += (end - mid) * (1 / (1 + np.exp(-(x - k2) / 700)))
        return y

    ax.plot(x, plateau(x, 38, 45, 51.6, k2=2800), color=ACCENT, lw=2.2, zorder=4,
            label="Locus (Opus 4.8) — 51.6")
    ax.axhline(49.4, color=INK, lw=1.4, ls="--", zorder=3,
               label="Qwen3-1.7B-Instruct(人工调优)— 49.4")
    ax.plot(x, plateau(x, 34, 43.2, 44.3), color=GRAY, lw=1.6, zorder=2,
            label="Claude Code (Opus 4.8) — 44.3")
    ax.plot(x, plateau(x, 33, 41.5, 42.7), color=GRAY, lw=1.6, ls="-.", zorder=2,
            label="Claude Code (GLM 5.2) — 42.7")
    ax.plot(x, plateau(x, 28, 34.2, 34.6), color=GRAY, lw=1.6, ls=":", zorder=2,
            label="Codex (GPT-5.5) — 34.6")
    ax.axvspan(0, 1000, color=ACCENT_TINT, alpha=0.5, zorder=0)
    ax.text(480, 20.5, "排名在此区间\n极不稳定", ha="center", fontsize=9, color=FAINT)
    ax.set_xlim(0, 4100)
    ax.set_ylim(18, 56)
    ax.set_xlabel("可用 AI R&D 算力(H100 GPU 小时)")
    ax.set_ylabel("PostTrainBench+ 综合分")
    style_ax(ax)
    ax.legend(loc="lower right", fontsize=9, frameon=False)
    save(fig, "performance-vs-compute.svg")


# ---------- 图 3:AIME 训练规模轨迹(示意,log x) ----------

def fig_aime_tokens():
    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    add_card(fig)
    # Locus:持续扩大到 ~3.6B tokens,AIME 20%
    lx = [1e6, 1e7, 1e8, 5e8, 1.4e9, 3.2e9, 3.64e9]
    ly = [0, 1, 3, 7, 12, 16.5, 20.0]
    ax.plot(lx, ly, "-o", color=ACCENT, lw=2.2, ms=4, zorder=4,
            label="Locus (Opus 4.8) — 最终 20%")
    # GLM 5.2:~85M tokens,10%
    ax.plot([1e6, 1e7, 8.5e7], [0, 4, 10.0], "-s", color=GRAY, lw=1.6, ms=4,
            zorder=3, label="Claude Code (GLM 5.2) — 10%")
    # Opus 4.8:上过 B 级但不稳(0~3.3%)
    ax.plot([1e6, 1e8, 2.95e8, 1.42e9], [0, 1, 3.3, 0.0], "-^", color=GRAY,
            lw=1.6, ms=4, ls="--", zorder=3, label="Claude Code (Opus 4.8) — 大规模尝试失败")
    # Codex:从没超过 1.53M tokens
    ax.plot([2e4, 2e5, 1.53e6], [0, 0.5, 0.0], "-d", color=GRAY, lw=1.6, ms=4,
            ls=":", zorder=3, label="Codex (GPT-5.5) — 仅小步 LoRA")
    ax.set_xscale("log")
    ax.set_xlim(1e4, 8e9)
    ax.set_ylim(-1, 22)
    ax.set_xlabel("单方案训练 token 数(log 刻度)")
    ax.set_ylabel("AIME 2025 准确率(%)")
    style_ax(ax)
    ax.legend(loc="upper left", fontsize=9, frameon=False)
    save(fig, "aime-training-scale.svg")


# ---------- 图 4:探索多样性 vs 性能(示意散点) ----------

def fig_diversity():
    fig, ax = plt.subplots(figsize=(7.2, 4.2))
    add_card(fig)
    pts = [
        ("Codex (GPT-5.5)", 2.6, 33.2, False),
        ("Claude Code (GLM 5.2)", 4.0, 41.4, False),
        ("Claude Code (Opus 4.8)", 4.8, 44.1, False),
        ("Locus (Opus 4.8)", 9.0, 51.2, True),
    ]
    for name, x, y, hot in pts:
        ax.scatter(x, y, s=90 if hot else 60, color=ACCENT if hot else GRAY,
                   zorder=3)
        dy = 1.1 if name != "Claude Code (GLM 5.2)" else -2.1
        ax.annotate(f"{name}\n{x:.0f} 种 · {y:.1f}%", (x, y),
                    xytext=(x - 0.4, y + dy), fontsize=9,
                    color=INK if hot else MUTED)
    ax.set_xlim(1, 11)
    ax.set_ylim(29, 56)
    ax.set_xlabel("每个 benchmark 尝试的独立方法数(均值)")
    ax.set_ylabel("PostTrainBench+ 综合分")
    style_ax(ax)
    ax.grid(color=BORDER, linewidth=0.6, zorder=0)
    save(fig, "approach-diversity.svg")


# ---------- 图 5:Kaggle 竞赛百分位 ----------

def fig_kaggle():
    rows = [
        ("ROGII(5,625 队 · $50k)", 99.2),
        ("Biohub(1,599 队 · $60k)", 99.0),
        ("ARC-AGI-3(1,895 队 · $850k)", 93.8),
        ("NeuroGolf(2,963 队 · $50k)", 92.4),
        ("AI Agent Security(2,318 队 · $50k)", 88.5),
        ("ARC-AGI-2(1,245 队 · $700k)", 64.5),
    ]
    fig, ax = plt.subplots(figsize=(7.2, 4.0))
    add_card(fig)
    names = [r[0] for r in rows][::-1]
    vals = [r[1] for r in rows][::-1]
    colors = [ACCENT if v >= 90 else "#5b76ea" for v in vals]
    bars = ax.barh(names, vals, color=colors, height=0.6, zorder=3)
    for b, v in zip(bars, vals):
        ax.text(v + 1, b.get_y() + b.get_height() / 2, f"{v:.1f}%",
                va="center", fontsize=10, color=INK)
    ax.set_xlim(0, 108)
    ax.set_xlabel("击败的人类队伍比例(排行榜百分位)")
    style_ax(ax)
    ax.grid(axis="x", color=BORDER, linewidth=0.7, zorder=0)
    save(fig, "kaggle-standings.svg")


# ---------- 图 6:Bubble 生产指标对比 ----------

def fig_bubble():
    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    add_card(fig)
    rows = [
        ("错误率", 100 / 2.8, "2.8× 更低"),
        ("延迟", 100 / 5.4, "5.4× 更低"),
        ("单次查询成本", 100 / 105, "105× 更低"),
    ]
    y = np.arange(len(rows))[::-1]
    ax.barh(y + 0.19, [100, 100, 100], height=0.34, color=BORDER, zorder=2,
            label="原系统(基线 = 100)")
    ax.barh(y - 0.19, [r[1] for r in rows], height=0.34, color=ACCENT, zorder=3,
            label="Locus 训练的模型")
    for yi, (name, v, tag) in zip(y, rows):
        ax.text(max(v, 3) + 2, yi - 0.19, tag, va="center", fontsize=10,
                color=ACCENT, fontweight="bold")
        ax.text(0, yi + 0.42, name, va="center", fontsize=10.5, color=INK)
    ax.set_yticks([])
    ax.set_xlim(0, 118)
    ax.set_xlabel("相对值(原系统 = 100,越低越好)")
    style_ax(ax)
    ax.legend(loc="lower right", fontsize=9, frameon=False)
    save(fig, "bubble-production.svg")


fig_tier1()
fig_scaling()
fig_aime_tokens()
fig_diversity()
fig_kaggle()
fig_bubble()
print("done")
