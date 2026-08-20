#!/usr/bin/env python3
"""生成 GCodey 介绍博文的架构插图，输出到 public/images/blog/gcodey/。

风格对齐站点:白底圆角卡片、zinc 灰阶文字、冷蓝 accent(#2952e3)。
运行:.venv/bin/python scripts/generate-gcodey-figures.py
"""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

CJK_CANDIDATES = ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"]
available = {f.name for f in font_manager.fontManager.ttflist}
CJK = next((f for f in CJK_CANDIDATES if f in available), None)
assert CJK, f"找不到中文字体:{sorted(available)[:20]}"

plt.rcParams.update({"font.family": [CJK, "DejaVu Sans"], "figure.dpi": 100})

INK = "#27272a"
MUTED = "#52525b"
ACCENT = "#2952e3"
ACCENT_TINT = "#eef2fd"
PANEL = "#fafafa"
BORDER = "#e4e4e7"

OUT = Path("public/images/blog/gcodey")
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


def box(ax, x, y, w, h, text, fc=PANEL, ec=BORDER, tc=INK, fs=10, lw=1.2, sub=None):
    b = FancyBboxPatch(
        (x, y), w, h, boxstyle="round,pad=0,rounding_size=0.035",
        facecolor=fc, edgecolor=ec, linewidth=lw, zorder=2,
    )
    ax.add_patch(b)
    if sub:
        ax.text(x + w / 2, y + h * 0.62, text, ha="center", va="center",
                fontsize=fs, color=tc, zorder=3)
        ax.text(x + w / 2, y + h * 0.30, sub, ha="center", va="center",
                fontsize=fs - 2.2, color=MUTED, zorder=3)
    else:
        ax.text(x + w / 2, y + h / 2, text, ha="center", va="center",
                fontsize=fs, color=tc, zorder=3)


def arrow(ax, x1, y1, x2, y2, color=MUTED, lw=1.4, style="-|>"):
    ax.add_patch(FancyArrowPatch(
        (x1, y1), (x2, y2), arrowstyle=style, mutation_scale=11,
        color=color, linewidth=lw, zorder=1,
    ))


fig, ax = plt.subplots(figsize=(7.6, 5.6))
add_card(fig)
ax.set_xlim(0, 1)
ax.set_ylim(0, 1)
ax.axis("off")

# 顶层:TUI / line mode
box(ax, 0.30, 0.885, 0.40, 0.085, "TUI / line mode", sub="持久事件的投影，不维护第二套会话事实")
# durable inbox
box(ax, 0.30, 0.755, 0.40, 0.085, "durable inbox", sub="消息先落盘，运行中排队，安全边界按 FIFO 进入上下文")
arrow(ax, 0.50, 0.885, 0.50, 0.845)

# Session Harness 大框
hb = FancyBboxPatch(
    (0.06, 0.265), 0.88, 0.44, boxstyle="round,pad=0,rounding_size=0.02",
    facecolor=ACCENT_TINT, edgecolor=ACCENT, linewidth=1.4, zorder=1, alpha=0.55,
)
ax.add_patch(hb)
ax.text(0.50, 0.668, "Session Harness", ha="center", fontsize=11.5,
        color=ACCENT, fontweight="bold", zorder=3)
arrow(ax, 0.50, 0.755, 0.50, 0.71)

# Harness 内部四个组件
box(ax, 0.115, 0.50, 0.37, 0.13, "pure reducer", sub="验证事件并计算下一状态")
box(ax, 0.515, 0.50, 0.37, 0.13, "events.jsonl(schema v7)", sub="唯一状态源:append + fsync 后才换内存")
box(ax, 0.115, 0.325, 0.37, 0.13, "context manager", sub="真实 usage 驱动整理，context epoch")
box(ax, 0.515, 0.325, 0.37, 0.13, "capability policy + 8 个意图工具", sub="模型不选 backend、不传 revision")

# 底部两种执行边界
box(ax, 0.115, 0.075, 0.37, 0.115, "direct + host(默认)", sub="编辑器语义原子写，宿主 shell")
box(ax, 0.515, 0.075, 0.37, 0.115, "--safe:copy + sandbox", sub="Seatbelt / bubblewrap，网络关闭", ec=ACCENT)
arrow(ax, 0.30, 0.325, 0.30, 0.195)
arrow(ax, 0.70, 0.325, 0.70, 0.195)

# workspace change 标注
ax.text(0.955, 0.132, "用户批准后\nworkspace change\n写回源工作区", ha="left", va="center",
        fontsize=8.2, color=MUTED)
arrow(ax, 0.885, 0.132, 0.945, 0.132, color=BORDER)

fig.savefig(OUT / "harness-kernel.svg", bbox_inches="tight", pad_inches=0.12, transparent=True)
plt.close(fig)
print(f"wrote {OUT / 'harness-kernel.svg'}")
