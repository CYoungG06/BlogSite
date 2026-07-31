#!/usr/bin/env python3
"""生成论文解读(insights)文章的插图,输出到 public/images/insights/<paperId>/。

风格与 scripts/generate-opd-figures.py 一致:白底圆角卡片、zinc 灰阶、冷蓝 accent。
运行:.venv/bin/python scripts/generate-insights-figures.py
"""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyBboxPatch

CJK_CANDIDATES = ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"]
available = {f.name for f in font_manager.fontManager.ttflist}
CJK = next((f for f in CJK_CANDIDATES if f in available), None)
assert CJK, f"找不到中文字体:{sorted(available)[:20]}"
plt.rcParams.update({"font.family": [CJK, "DejaVu Sans"], "axes.unicode_minus": False})

INK = "#27272a"
MUTED = "#52525b"
FAINT = "#71717a"
ACCENT = "#2952e3"
ACCENT_TINT = "#eef2fd"
AMBER = "#b45309"
PANEL = "#fafafa"
BORDER = "#e4e4e7"

OUT = Path("public/images/insights")


def add_card(fig, pad=0.012, radius=0.025):
    fig.patch.set_alpha(0)
    card = FancyBboxPatch(
        (pad, pad), 1 - 2 * pad, 1 - 2 * pad,
        boxstyle=f"round,pad=0,rounding_size={radius}",
        transform=fig.transFigure, facecolor="white",
        edgecolor=BORDER, linewidth=1.2, zorder=-100,
    )
    fig.add_artist(card)


# ---------- Skill Self-Play(2607.22529)协同进化循环图 ----------

fig = plt.figure(figsize=(10.2, 7.0))
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, 100)
ax.set_ylim(0, 68)
ax.axis("off")
add_card(fig)


def box(cx, cy, w, h, title, lines, highlight=False, title_size=13):
    face = ACCENT_TINT if highlight else PANEL
    edge = ACCENT if highlight else BORDER
    lw = 1.8 if highlight else 1.2
    b = FancyBboxPatch((cx - w / 2, cy - h / 2), w, h,
                       boxstyle="round,pad=0,rounding_size=1.8",
                       facecolor=face, edgecolor=edge, linewidth=lw, zorder=2)
    ax.add_patch(b)
    tc = ACCENT if highlight else INK
    ax.text(cx, cy + h / 2 - 4.2, title, ha="center", va="center",
            fontsize=title_size, fontweight="bold", color=tc, zorder=3)
    for i, ln in enumerate(lines):
        ax.text(cx, cy + h / 2 - 9.2 - i * 4.6, ln, ha="center", va="center",
                fontsize=9, color=MUTED, zorder=3)


# 四个角色:上=技能库,右=Proposer,下=Solver,左=Skill Controller
box(50, 59, 40, 13, "技能库 S(t)", ["技能 = 路由元数据 + 规则 + 示例", "+ 可执行验证器 ν + 使用统计 σ"], highlight=True)
box(84, 34, 26, 20, "Proposer π_p", ["技能流:(x,c) ~ π(·|s)", "探索流:(x,c) ~ π(·|∅)", "GRPO 更新"])
box(50, 9, 40, 13, "Solver π_s(GRPO)", ["在 top-M 前沿课程 D 上训练", "奖励 = 环境验证 R_solve"])
box(16, 34, 26, 20, "Skill Controller π_c", ["精炼:修失败模式", "剪枝:退役过时技能", "归纳:探索流蒸馏新技能"])

# 循环箭头(顺时针)
def arrow(x1, y1, x2, y2, label, rad=-0.25, label_off=(0, 0), label_size=9.5, color=ACCENT):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="-|>", color=color, lw=2.0,
                                connectionstyle=f"arc3,rad={rad}",
                                shrinkA=2, shrinkB=2), zorder=4)
    lx, ly = (x1 + x2) / 2 + label_off[0], (y1 + y2) / 2 + label_off[1]
    ax.text(lx, ly, label, ha="center", va="center", fontsize=label_size,
            color=color, zorder=5,
            bbox=dict(boxstyle="round,pad=0.28", fc="white", ec="none", alpha=0.9))


arrow(66, 53, 76, 44.5, "动态采样技能 s ~ S(按 σ 权衡利用/探索)", label_off=(2, 2))
arrow(76, 24, 66, 15, "候选任务 (x, c):提示 + 机器可读验证契约", label_off=(4, -1.5))
ax.text(84, 22.5, "有效性门:schema ✓ 验证器 ν ✓ probe 多数一致 ✓", ha="center",
        fontsize=8.5, color=AMBER, zorder=5,
        bbox=dict(boxstyle="round,pad=0.28", fc="white", ec="none", alpha=0.9))
arrow(34, 15, 24, 24.5, "执行反馈:v_solve / 失败轨迹", label_off=(-4, -1))
arrow(24, 44, 34, 53, "S(t+1) = (S \\ 剪枝) ∪ 新归纳", label_off=(0, 2))

# 中心注释:前沿难度目标
ax.text(50, 36.5, "自博弈协同进化循环", ha="center", fontsize=12.5,
        fontweight="bold", color=INK)
ax.text(50, 31.5, "Proposer 奖励 = 中等难度分 1 − 2·|v_solve − 0.5|,乘有效性门",
        ha="center", fontsize=9.5, color=MUTED)
ax.text(50, 27.5, "(太难/太易的任务都不得分;无效任务直接零分)",
        ha="center", fontsize=9, color=FAINT)

d = OUT / "2607.22529"
d.mkdir(parents=True, exist_ok=True)
fig.savefig(d / "framework.png", dpi=220, transparent=True)
plt.close(fig)
print("已生成 insights/2607.22529/framework.png")
