#!/usr/bin/env python3
"""生成 OPD 深度解析文章的两张插图,输出到 public/images/blog/on-policy-distillation/。

风格对齐站点:白底圆角卡片、zinc 灰阶文字、克制的冷蓝 accent(#2952e3)。
运行:.venv/bin/python scripts/generate-opd-figures.py
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
assert CJK, f"找不到中文字体,字体列表:{sorted(available)[:20]}"
print(f"使用中文字体:{CJK}")

plt.rcParams.update({"font.family": [CJK, "DejaVu Sans"], "axes.unicode_minus": False})

INK = "#27272a"        # zinc-800 主文字
MUTED = "#52525b"      # zinc-600 次要文字
FAINT = "#71717a"      # zinc-500 注释
ACCENT = "#2952e3"     # 站点 accent
ACCENT_TINT = "#eef2fd"
PANEL = "#fafafa"      # 面板底
BORDER = "#e4e4e7"     # zinc-200

OUT = Path("public/images/blog/on-policy-distillation")
OUT.mkdir(parents=True, exist_ok=True)


def add_card(fig, pad=0.012, radius=0.025):
    """给整张图垫一张白底圆角卡片(图外区域透明,适配深浅主题)。"""
    fig.patch.set_alpha(0)
    card = FancyBboxPatch(
        (pad, pad), 1 - 2 * pad, 1 - 2 * pad,
        boxstyle=f"round,pad=0,rounding_size={radius}",
        transform=fig.transFigure, facecolor="white",
        edgecolor=BORDER, linewidth=1.2, zorder=-100,
    )
    fig.add_artist(card)


# ---------- 图 1:后训练方法坐标系 ----------

fig = plt.figure(figsize=(9.8, 6.0))
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, 100)
ax.set_ylim(0, 62)
ax.axis("off")
add_card(fig)

# 坐标轴(十字,两端带箭头)
ax.annotate("", xy=(94, 31), xytext=(6, 31),
            arrowprops=dict(arrowstyle="<->", color=FAINT, lw=1.2))
ax.annotate("", xy=(50, 60), xytext=(50, 3),
            arrowprops=dict(arrowstyle="<->", color=FAINT, lw=1.2))

# 轴标签
ax.text(92.5, 32.8, "on-policy:轨迹来自学生自己", ha="right", va="bottom", fontsize=10, color=MUTED)
ax.text(7.5, 32.8, "off-policy:轨迹来自教师/数据", ha="left", va="bottom", fontsize=10, color=MUTED)
ax.text(51.8, 58.5, "稠密监督:逐 token 分布", ha="left", va="top", fontsize=10, color=MUTED)
ax.text(51.8, 4.5, "稀疏奖励:序列级标量", ha="left", va="bottom", fontsize=10, color=MUTED)


def panel(x0, y0, w, h, title, sub, note, highlight=False, badge=None):
    face = ACCENT_TINT if highlight else PANEL
    edge = ACCENT if highlight else BORDER
    lw = 2.0 if highlight else 1.2
    box = FancyBboxPatch((x0, y0), w, h,
                         boxstyle="round,pad=0,rounding_size=1.6",
                         facecolor=face, edgecolor=edge, linewidth=lw, zorder=2)
    ax.add_patch(box)
    cx = x0 + w / 2
    title_color = ACCENT if highlight else INK
    ax.text(cx, y0 + h - 5.2, title, ha="center", va="center",
            fontsize=16, fontweight="bold", color=title_color, zorder=3)
    ax.text(cx, y0 + h - 11.0, sub, ha="center", va="center", fontsize=10.5, color=MUTED, zorder=3)
    ax.text(cx, y0 + 5.0, note, ha="center", va="center", fontsize=9.5, color=FAINT, zorder=3)
    if badge:
        bx, by = x0 + w - 8.2, y0 + h - 3.4
        chip = FancyBboxPatch((bx - 2.9, by - 1.55), 5.8, 3.1,
                              boxstyle="round,pad=0,rounding_size=1.5",
                              facecolor=ACCENT, edgecolor="none", zorder=4)
        ax.add_patch(chip)
        ax.text(bx, by, badge, ha="center", va="center", fontsize=8.5,
                color="white", fontweight="bold", zorder=5)


W, H = 34, 21
panel(12, 36, W, H, "SFT / 离线蒸馏", "教师轨迹 × 逐 token 信号",
      "痛点:状态是别人的(exposure bias)")
panel(54, 36, W, H, "OPD", "学生轨迹 × 教师逐 token 分布",
      "既要又要:真实状态 + 稠密信号", highlight=True, badge="本文主角")
panel(12, 6, W, H, "拒绝采样 / STaR", "旧策略数据 × 结果过滤",
      "序列级二值,答错的样本零信号")
panel(54, 6, W, H, "RL / RLVR", "学生轨迹 × 末端 0/1 奖励",
      "痛点:信用分配难(GRPO 优势消失)")

fig.savefig(OUT / "quadrant.png", dpi=220, transparent=True)
plt.close(fig)
print("已生成 quadrant.png")


# ---------- 图 2:Forward KL(mass-covering)vs Reverse KL(mode-seeking)----------


def gauss(x, mu, sd):
    return np.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * np.sqrt(2 * np.pi))


x = np.linspace(-5.2, 5.6, 1200)
# 教师:不等权重的双峰混合
w1, m1, s1 = 0.35, -2.0, 0.55
w2, m2, s2 = 0.65, 1.8, 0.75
teacher = w1 * gauss(x, m1, s1) + w2 * gauss(x, m2, s2)

# forward KL 最优单高斯 = 矩匹配(均值/方差与混合分布一致)
mu_f = w1 * m1 + w2 * m2
var_f = w1 * (s1**2 + m1**2) + w2 * (s2**2 + m2**2) - mu_f**2
fwd = gauss(x, mu_f, np.sqrt(var_f))
# reverse KL 最优单高斯 = 收缩到主众数
rev = gauss(x, m2, s2)

fig, axes = plt.subplots(1, 2, figsize=(10.6, 4.3), sharey=True)
fig.subplots_adjust(left=0.035, right=0.975, top=0.80, bottom=0.10, wspace=0.10)
add_card(fig, pad=0.008, radius=0.03)

titles = [
    "Forward KL:mass-covering(覆盖)",
    "Reverse KL:mode-seeking(收缩)",
]
subs = [
    "zero-avoiding:教师有质量处,学生不敢为零",
    "zero-forcing:教师零概率处,学生必须为零",
]

for i, (axi, student) in enumerate(zip(axes, [fwd, rev])):
    axi.set_facecolor("none")
    axi.fill_between(x, teacher, color=FAINT, alpha=0.18, zorder=1)
    axi.plot(x, teacher, color=MUTED, lw=1.6, label="教师 $p$(双峰混合)", zorder=2)
    axi.fill_between(x, student, color=ACCENT, alpha=0.10, zorder=3)
    axi.plot(x, student, color=ACCENT, lw=2.4, label="学生 $q$(单高斯)", zorder=4)
    axi.set_title(titles[i], fontsize=13.5, fontweight="bold", color=INK, pad=26)
    axi.text(0.5, 1.045, subs[i], transform=axi.transAxes,
             ha="center", va="bottom", fontsize=9.5, color=MUTED)
    for spine in ["top", "right", "left"]:
        axi.spines[spine].set_visible(False)
    axi.spines["bottom"].set_color(BORDER)
    axi.set_yticks([])
    axi.set_xticks([m1, m2])
    axi.set_xticklabels(["次要众数", "主众数"], fontsize=9, color=FAINT)
    axi.tick_params(length=0)
    axi.set_xlim(x.min(), x.max())
    axi.set_ylim(0, None)

# 左图:标注中间低概率区被摊薄
gap_mask = (x > -0.7) & (x < 1.0)
axes[0].fill_between(x[gap_mask], fwd[gap_mask], color="#d97706", alpha=0.13, zorder=2)
axes[0].annotate("概率摊薄到教师的低概率区\n→ 采出「教师没想过」的样本",
                 xy=(0.15, gauss(0.15, mu_f, np.sqrt(var_f)) * 0.92),
                 xytext=(0.06, 0.90), textcoords=("data", "axes fraction"),
                 fontsize=9.5, color="#b45309", ha="left", va="top",
                 arrowprops=dict(arrowstyle="->", color="#b45309", lw=1.2,
                                 connectionstyle="arc3,rad=-0.2"))

# 右图:标注被放弃的次要众数
axes[1].annotate("次要众数被放弃",
                 xy=(m1, w1 * gauss(m1, m1, s1) * 0.55),
                 xytext=(-3.35, 0.62), textcoords=("data", "axes fraction"),
                 fontsize=9.5, color=FAINT, ha="center", va="center",
                 arrowprops=dict(arrowstyle="->", color=FAINT, lw=1.2))

handles, labels = axes[0].get_legend_handles_labels()
fig.legend(handles, labels, loc="upper center", ncol=2, frameon=False,
           fontsize=10, bbox_to_anchor=(0.5, 1.005))

fig.savefig(OUT / "kl-gmm.png", dpi=220, transparent=True)
plt.close(fig)
print("已生成 kl-gmm.png")
