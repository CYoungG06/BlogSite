#!/usr/bin/env python3
"""生成论文解读(insights)文章的插图，输出到 public/images/insights/<paperId>/。

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


# 四个角色:上=技能库，右=Proposer，下=Solver，左=Skill Controller
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
ax.text(50, 31.5, "Proposer 奖励 = 中等难度分 1 − 2·|v_solve − 0.5|，乘有效性门",
        ha="center", fontsize=9.5, color=MUTED)
ax.text(50, 27.5, "(太难/太易的任务都不得分;无效任务直接零分)",
        ha="center", fontsize=9, color=FAINT)

d = OUT / "2607.22529"
d.mkdir(parents=True, exist_ok=True)
fig.savefig(d / "framework.png", dpi=220, transparent=True)
plt.close(fig)
print("已生成 insights/2607.22529/framework.png")


# ---------- Kimi K3(2607.24653)架构三轴图 ----------

fig = plt.figure(figsize=(10.2, 7.0))
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, 100)
ax.set_ylim(0, 68)
ax.axis("off")
add_card(fig)

ax.text(50, 64.5, "Kimi K3:沿三个维度扩展信息通路", ha="center",
        fontsize=14, fontweight="bold", color=INK)
ax.text(50, 60.8, "2.8T MoE · 每 token 激活 104B · 原生视觉 · 1M token 上下文",
        ha="center", fontsize=9.5, color=MUTED)


def col_card(cx, w, y0, y1):
    b = FancyBboxPatch((cx - w / 2, y0), w, y1 - y0,
                       boxstyle="round,pad=0,rounding_size=1.8",
                       facecolor=PANEL, edgecolor=BORDER, linewidth=1.2, zorder=1)
    ax.add_patch(b)


def tile(cx, cy, w, h, text, highlight=False, fs=9):
    face = ACCENT_TINT if highlight else "white"
    edge = ACCENT if highlight else BORDER
    b = FancyBboxPatch((cx - w / 2, cy - h / 2), w, h,
                       boxstyle="round,pad=0,rounding_size=0.9",
                       facecolor=face, edgecolor=edge, linewidth=1.4 if highlight else 1.1, zorder=2)
    ax.add_patch(b)
    ax.text(cx, cy, text, ha="center", va="center", fontsize=fs,
            fontweight="bold" if highlight else "normal",
            color=ACCENT if highlight else INK, zorder=3)


def bullet(cx, w, y, text, fs=8.5, color=MUTED):
    ax.text(cx - w / 2 + 1.2, y, text, ha="left", va="center",
            fontsize=fs, color=color, zorder=3)


CARD_Y0, CARD_Y1 = 7.5, 56

# —— 列一:序列轴 Hybrid Attention ——
col_card(18, 29, CARD_Y0, CARD_Y1)
ax.text(18, 52.8, "序列轴:Hybrid Attention", ha="center", fontsize=11.5,
        fontweight="bold", color=INK)
for i in range(3):
    tile(18, 47 - i * 5, 16, 4.2, "KDA", fs=9.5)
tile(18, 32, 16, 4.2, "Gated MLA", highlight=True, fs=9.5)
ax.text(18, 27.6, "每个 block:KDA ×3 + Gated MLA ×1", ha="center", fontsize=8.5, color=FAINT)
ax.text(18, 24.6, "backbone 末尾再 +1 层 Gated MLA", ha="center", fontsize=8.5, color=FAINT)
bullet(18, 29, 20.2, "KDA:delta 规则递归 + 通道级遗忘门")
bullet(18, 29, 16.9, "log 衰减下界 sigmoid(≥ −5),")
bullet(18, 29, 13.9, "对角块也能跑满 Tensor Core")
bullet(18, 29, 10.9, "MLA 全部 NoPE → 位置感交给 KDA", color=ACCENT)

# —— 列二:深度轴 Attention Residuals ——
col_card(50, 29, CARD_Y0, CARD_Y1)
ax.text(50, 52.8, "深度轴:Attention Residuals", ha="center", fontsize=11.5,
        fontweight="bold", color=INK)
tile(50, 45.5, 15, 4.2, "Layer i+2", fs=9)
tile(50, 37.5, 15, 4.2, "Layer i+1", fs=9)
tile(50, 29.5, 15, 4.2, "Layer i", fs=9)
tile(50, 21.5, 15, 4.2, "Embedding", fs=9)


def arow(x1, y1, x2, y2, rad=0.0, color=ACCENT, lw=1.8, zorder=4):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="-|>", color=color, lw=lw,
                                connectionstyle=f"arc3,rad={rad}",
                                shrinkA=2, shrinkB=2), zorder=zorder)


# 普通残差:顺序相邻(灰、细)
arow(53.5, 23.8, 53.5, 27.2, color=FAINT, lw=1.2)
arow(53.5, 31.8, 53.5, 35.2, color=FAINT, lw=1.2)
arow(53.5, 39.8, 53.5, 43.2, color=FAINT, lw=1.2)
# AttnRes:跨层回溯(蓝、弯)
arow(46.5, 23.8, 46.5, 35.0, rad=0.45)
arow(46.5, 31.8, 46.5, 43.0, rad=0.45)
arow(46.5, 23.8, 46.5, 43.2, rad=0.62)
ax.text(38.6, 33.5, "每层可回溯读取\nembedding 与全部前层表示", ha="center",
        fontsize=8, color=ACCENT, zorder=5,
        bbox=dict(boxstyle="round,pad=0.3", fc="white", ec="none", alpha=0.92))
bullet(50, 29, 15.2, "替代顺序残差累加:表示不再逐层稀释")
bullet(50, 29, 12.2, "Block AttnRes:8 层一 Block 压成单表示，")
bullet(50, 29, 9.4, "内存/通信开销 O(Ld) → O(Nd)")

# —— 列三:宽度轴 Stable LatentMoE ——
col_card(82, 29, CARD_Y0, CARD_Y1)
ax.text(82, 52.8, "宽度轴:Stable LatentMoE", ha="center", fontsize=11.5,
        fontweight="bold", color=INK)
tile(82, 47.5, 17, 4.2, "Router(QB 均衡)", fs=9)
active = {2, 5, 6, 11, 13}
for r in range(2):
    for c in range(8):
        idx = r * 8 + c
        x = 82 - 10.5 + c * 3
        y = 41.5 - r * 3.4
        face = ACCENT if idx in active else "white"
        b = FancyBboxPatch((x - 1.25, y - 1.25), 2.5, 2.5,
                           boxstyle="round,pad=0,rounding_size=0.5",
                           facecolor=face, edgecolor=ACCENT if idx in active else BORDER,
                           linewidth=1.0, zorder=2)
        ax.add_patch(b)
ax.text(82, 34.6, "896 routed experts · 每 token 激活 16(sparsity 56)",
        ha="center", fontsize=8.5, color=FAINT)
bullet(82, 29, 29.6, "Normalized:RMSNorm 插在上投影前，")
bullet(82, 29, 26.6, "稳住专家内部激活尺度")
bullet(82, 29, 22.4, "SiTU-GLU:β·tanh(x/β) 软帽(β=4/25),")
bullet(82, 29, 19.4, "替代 SwiGLU，输出有界 ≤ 100")
bullet(82, 29, 15.2, "Quantile Balancing:按 router 分数分位数")
bullet(82, 29, 12.2, "设专家偏置，无辅助 loss 做负载均衡")

ax.text(50, 3.2, "原生视觉:MoonViT-V2(0.4B，从 0 起用 next-token 预测训练)· 优化器:Per-Head Muon · 整体 scaling 效率 ≈ 2.5× K2",
        ha="center", fontsize=8.5, color=FAINT)

d = OUT / "2607.24653"
d.mkdir(parents=True, exist_ok=True)
fig.savefig(d / "architecture.png", dpi=220, transparent=True)
plt.close(fig)
print("已生成 insights/2607.24653/architecture.png")


# ---------- Kimi K3(2607.24653)后训练管线图 ----------

fig = plt.figure(figsize=(10.2, 5.2))
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, 100)
ax.set_ylim(0, 50)
ax.axis("off")
add_card(fig)

ax.text(50, 46.5, "后训练管线:九个专家，一个模型", ha="center",
        fontsize=13.5, fontweight="bold", color=INK)
ax.text(50, 43.2, "SFT → 分域 × 分档 RL → 多教师 On-Policy 蒸馏(MOPD)→ 部署友好",
        ha="center", fontsize=9.5, color=MUTED)


def stage(cx, w, y0, y1, title, lines, highlight=False, title_size=11.5):
    face = ACCENT_TINT if highlight else PANEL
    edge = ACCENT if highlight else BORDER
    b = FancyBboxPatch((cx - w / 2, y0), w, y1 - y0,
                       boxstyle="round,pad=0,rounding_size=1.6",
                       facecolor=face, edgecolor=edge, linewidth=1.8 if highlight else 1.2, zorder=1)
    ax.add_patch(b)
    ax.text(cx, y1 - 3.4, title, ha="center", va="center", fontsize=title_size,
            fontweight="bold", color=ACCENT if highlight else INK, zorder=3)
    for i, ln in enumerate(lines):
        ax.text(cx, y1 - 8.2 - i * 3.9, ln, ha="center", va="center",
                fontsize=8.2, color=MUTED, zorder=3)


SY0, SY1 = 13, 39

stage(11, 18, SY0, SY1, "SFT", [
    "建立基础策略",
    "agentic 轨迹数据，",
    "XTML 聊天模板",
    "QAT 自此全程贯穿",
    "(W: MXFP4 / A: MXFP8)",
])

# RL stage:带 3×3 专家网格的大框
b = FancyBboxPatch((25, SY0), 30, SY1 - SY0,
                   boxstyle="round,pad=0,rounding_size=1.6",
                   facecolor=PANEL, edgecolor=BORDER, linewidth=1.2, zorder=1)
ax.add_patch(b)
ax.text(40, SY1 - 3.4, "RL:3 域 × 3 档推理强度", ha="center", va="center",
        fontsize=11.5, fontweight="bold", color=INK, zorder=3)
cols = ["低", "高", "max"]
rows = ["通用", "Agent", "编程"]
for ci, cl in enumerate(cols):
    ax.text(33.5 + ci * 6.5, 32.2, cl, ha="center", fontsize=8, color=FAINT, zorder=3)
for ri, rl in enumerate(rows):
    ax.text(28.2, 29.2 - ri * 3.6, rl, ha="center", va="center", fontsize=8,
            color=FAINT, zorder=3)
    for ci in range(3):
        tile(33.5 + ci * 6.5, 29.2 - ri * 3.6, 5.2, 2.7, "", highlight=(ri == 1 and ci == 2))
ax.text(40, 17.6, "9 个领域 × 强度专家模型", ha="center", fontsize=8.2, color=MUTED, zorder=3)
ax.text(40, 14.6, "partial rollout 抗长尾 · 逐题 token 预算控力", ha="center",
        fontsize=8.2, color=MUTED, zorder=3)

stage(66, 19, SY0, SY1, "MOPD", [
    "多教师 On-Policy 蒸馏",
    "9 个专家 → 1 个统一模型",
    "per-token OPD reward",
    "(教师 vs 学生策略)",
], highlight=True)

stage(89.5, 17, SY0, SY1, "部署友好", [
    "MXFP4 QAT",
    "贯穿 SFT / RL",
    "MTP 层 → EAGLE-3",
    "draft model",
    "LK loss 提接受率",
])

for x1, x2 in [(20.5, 24.5), (55.5, 56.5), (76, 80.5)]:
    ax.annotate("", xy=(x2, 26), xytext=(x1, 26),
                arrowprops=dict(arrowstyle="-|>", color=ACCENT, lw=2.0), zorder=4)

ax.text(50, 8.6, "RL 任务从哪来:白盒组合式环境 + 知识图谱引导的自进化任务合成 + 真实场景沙盒",
        ha="center", fontsize=8.8, color=FAINT)
ax.text(50, 5.2, "个人助理类任务:模拟 Gmail / Notion / Slack，上千次工具调用、百万 token 级上下文",
        ha="center", fontsize=8.8, color=FAINT)

fig.savefig(d / "posttraining.png", dpi=220, transparent=True)
plt.close(fig)
print("已生成 insights/2607.24653/posttraining.png")
