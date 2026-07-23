---
title: "SAO:单条 Rollout 的异步 Agentic RL 优化"
date: "2026-07-08"
description: "THUDM(GLM 团队)的异步 RL 训练框架 SAO:用单条 rollout 取代 GRPO 的组采样,配合双侧 token 级裁剪(DIS)、更快更稳的 value model 训练和跳过环境观测的 GAE,在 agentic 推理与编程任务上稳定训练上千步并超越 GRPO,已用于 GLM-5.2 的 agentic RL 管线。"
tags: ["RL", "Agent", "异步训练", "后训练"]
source:
  name: "arXiv"
  url: "https://arxiv.org/abs/2607.07508"
  author: "Zhenyu Hou, Yujiang Li, Jie Tang, Yuxiao Dong (THUDM)"
---

> **论文信息**:[Single-Rollout Asynchronous Optimization for Agentic Reinforcement Learning](https://arxiv.org/abs/2607.07508),Zhenyu Hou、Yujiang Li、Jie Tang、Yuxiao Dong(THUDM),2026-07-08。
>
> **一句话贡献**:把异步 RL 里的 GRPO 组采样换成「单条 rollout + 训得更好的 value model」,再配上把离策略 token 直接掩掉的激进修剪,让异步 agentic RL 第一次稳定跑到上千步。
>
> **为什么值得读**:agentic RL 的工程化是今年的主线之一,而「异步」是绕不开的坎——GRPO 的组采样天然和异步冲突(一组必须等最慢的那条)。这篇来自 GLM 团队的论文给出了一套完整且已被 GLM-5.2 生产验证的解法,每个设计都有消融背书,没有花架子。
>
> **适合谁**:做 RL 后训练、agent 训练基础设施的人;想理解「异步 RL 到底难在哪」的读者。

## 背景:异步 RL 的两个死结

LLM 的 RL 后训练,主流管线一直是**同步、批次交错**的:策略模型生成一批 rollout,等整批收齐了才开始优化。对 agentic/编程类负载,rollout 长度差异极大——短轨迹早完事,长轨迹拖尾,大半个 GPU 集群在等最慢的那条,利用率惨不忍睹。

**异步 RL** 的解法很直接:rollout 一边生成一边喂给训练,不等任何人。但它引入两个死结:

1. **更严重的离策略(off-policy)**:一条轨迹的生成过程中,rollout 引擎可能已经被更新了多次,行为分布和训练分布脱节,训练稳定性下降。以往的异步工作大多只优化吞吐,对稳定性和任务效果着墨很少。
2. **GRPO 的组采样天然不适配异步**:GRPO 对每个 prompt 采一组响应、用组内均值估计优势——整组必须等最慢的一条出来才能开训,异步的意义就没了。而且在真实在线 agentic 场景里,环境往往一个 prompt 只能给一条轨迹反馈,组采样在结构上就不成立。

> **译注**:昨天的速递里还有一篇《Staleness-Adaptive Trust Regions for async RL》,同样在处理异步导致的陈旧性问题——可见这是当下 agentic RL 最热的痛点。SAO 的思路最激进:干脆把组采样整个扔掉。

## SAO 的三件套

![图 2:SAO 的单条 rollout 设计总览。数字表示轨迹的生成顺序:SAO 中每条轨迹完成后立即可用于训练;GRPO 则必须等组内所有轨迹生成完毕。](/images/reading/single-rollout-async/x2.png)

### 其一:DIS——直接用 rollout 引擎的 log-prob 做双侧裁剪

异步场景里,「policy lag」(rollout 模型与训练模型之间的滞后)是核心难题。解耦 PPO 通常维护三个模型:当前策略 $\pi_{\theta}$、旧策略 $\pi_{\theta_{\text{old}}}$、rollout 策略 $\pi_{\text{rollout}}$,用 $\pi_{\theta}/\pi_{\theta_{\text{old}}}$ 修正陈旧离策略、用 $\pi_{\theta_{\text{old}}}/\pi_{\text{rollout}}$ 修正训练-推理失配。但在异步环境下,一条轨迹生成期间 rollout 引擎可能已更新多次,要精确追踪行为概率就得保存一长串历史检查点——工程上不可行。

SAO 的做法是**简化但激进**的双侧重要性采样:

- **直接拿 rollout 阶段的 log-prob 当行为分布**,比值 $r_{t}(\theta)=\frac{\pi_{\theta}}{\pi_{\text{rollout}}}$,扔掉本来就不准的 $\pi_{\theta_{\text{old}}}$——省掉一次完整的旧策略前向推理;
- **把信任域外的 token 整个掩掉**:标准 PPO 只在 $(A>0, r>1+\epsilon)$ 或 $(A<0, r<1-\epsilon)$ 时裁剪,SAO 则把 $[1-\epsilon_{\ell}, 1+\epsilon_{h}]$ 区间外的 token 从梯度计算中**完全剔除**,防止极端策略发散带来的不稳定:

$$f(x;\epsilon_{\ell},\epsilon_{h})=\begin{cases}x,&\text{if }1-\epsilon_{\ell}<x<1+\epsilon_{h}\\ 0,&\text{otherwise}\end{cases}$$

> **译注**:这与 IcePop 的思路相近,但更进一步——连 $\pi_{\theta_{\text{old}}}$ 都不要了。实验里 TIR 任务用 $\epsilon_{\text{low}}=0.3,\epsilon_{\text{high}}=5.0$,注意下限收得很紧(0.3)而上限放得很宽(5.0):对「概率下降过多」的 token 比对「概率暴涨」的更不信任。

### 其二:单条 rollout——前提是 value model 要够好

用单条 rollout 替代组采样(每 prompt 只采一条,生成完立刻开训),离策略自然减轻,但梯度估计的方差会像 REINFORCE 一样大——这就全靠 value model 撑着了。论文在 value model 上做了四个设计:

1. **价值更新快于策略(TTUR)**:策略每更新 1 次,value 网络更新 $K=2$ 次。论文发现单条 rollout 不稳的根源是策略与价值函数的相互依赖——$V_{\phi}$ 不准,$\hat{A}$ 就是噪声,噪声又毁掉策略。让 critic 先跟上,优势估计才可靠。
2. **冻结 attention 训 value**:预实验发现 value model 的梯度范数显著大于策略模型,且不稳定主要来自 Full Attention 层(MoE 层相对稳定)。于是 RL 期间冻结 $V_{\phi}$ 的 attention 参数、只优化 MoE 投影——预训练的 attention 权重已经足够「会看」,限制优化面反而正则化了 value model。
3. **跳过环境观测的 token 级 GAE**:agentic 轨迹是 $T=[a_0, o_0, a_1, o_1, \dots]$(动作与环境反馈交错)。标准 GAE 在 $a_{i,\text{end}} \to o_{i,\text{start}}$ 的边界上算 TD 差分,但模型根本不生成 $o_i$,让 value model 去估「外部环境状态」的价值只会引入噪声。SAO 把 Bellman 目标改成跨观测桥接:

$$\hat{A}(a_{i,N})=\delta+\gamma\lambda\hat{A}(a_{i+1,0}),\quad \delta=r_{t}+\gamma V(a_{i+1,0})-V(a_{i,N})$$

优势估计只依赖模型自己的输出,环境反馈的随机性被滤掉。消融也证明 token 级优于 step 级的价值粒度(AIME2025:89.8 vs 85.8/87.3)。
4. **扩大 value 预训练规模**:价值估计的「冷启动」是大瓶颈,显著加大 value 预训练语料后,单条 rollout 和 TTUR 从训练早期就能正常工作。

## 实验:全面压过 GRPO,而且稳得住

**设置**:数学推理由 Qwen3-30B-A3B-Thinking-2507 在 GPT-OSS-120B 产的 TIR(工具集成推理)数据上 SFT 3 轮后初始化;RL 用 batch 128、组大小 1、最大 128k token;编程 agent 直接用 Qwen3-30B-A3B-Thinking-2507,SWE-Bench 用 OpenHands 脚手架,最多 300 轮交互。对比组为 GRPO(clip-higher 版)和 GRPO+DIS。

**数学推理**(Pass@1，多次评估取均值):

| 模型 | AIME2025 | BeyondAIME | HMMT Nov 2025 | IMOAnswerBench |
|---|---|---|---|---|
| Claude-Sonnet-4.5 | 87.0 | 62.0 | 81.7 | 65.8 |
| GPT-5 High | 94.6 | 74.0 | 89.2 | 76.0 |
| GLM-4.7 | 95.7 | - | 93.5 | 82.0 |
| SFT 起点 | 80.4 | 53.3 | 75.2 | 53.3 |
| GRPO | 84.2 | 54.8 | 76.0 | 55.8 |
| GRPO + DIS | 93.5 | 70.8 | 84.0 | 70.0 |
| **SAO** | **97.3** | **74.8** | **88.3** | **74.0** |

30B 开源模型训到逼近 GPT-5 High 的水平。**SWE-Bench Verified**:23.0(基座)→ 27.0(GRPO+DIS)→ **29.8(SAO)**。

**稳定性是更大的看点**:原版 GRPO 在约 160 步左右性能崩塌(表中只记崩塌前的最终有效分),GRPO+DIS 能稳住,而 SAO 与 GRPO+DIS 在约 400 步后拉开差距并稳定训练上千步。

![图 1:SAO 在推理与编程基准上的表现。四个推理基准在「推理+Python 工具」设定下评估,基线为 Qwen3-30B-A3B SFT;SWE-Bench Verified 以 Qwen3-30B-A3B 为基线。SAO 在全部五个基准上同时超过基线与 GRPO。](/images/reading/single-rollout-async/x1.png)

![图 3:SAO 与 GRPO(w/ DIS)训练过程对比:SAO 在不同基准上几乎全程优于强化版 GRPO。](/images/reading/single-rollout-async/x3.png)

**消融**(AIME2025 / BeyondAIME):去掉更快价值更新 95.0 / 69.8，去掉冻结 attention 90.6 / 74.5，原版 VAPO 91.3 / 69.0 且同样快速崩塌,running-mean 基线 79.8 / 55.3——每个设计都有用,尤其一个训练良好的 value model 无可替代。

**训练动力学三图**也讲清了机理:更快价值更新带来更高的 Explained Variance(400 步后显著拉开);冻结 attention 让 critic 梯度范数更低更平滑;DIS 的 token 裁剪率在 VAPO 上接近零、无法挡住发散更新(90 步崩塌),SAO 则把离策略 token 有效关在门外。

## 在线学习模拟:单条 rollout 的杀手锏

真实在线环境里,一个 prompt 只返一条轨迹——GRPO 的组内相对奖励在结构上就不成立,而 SAO 靠 value critic 天然适配。论文设计了一个模拟在线写作任务:奖励标准随时间在「可爱 → 中二 → 古风」三种文体偏好间切换(GLM-4.7 当评委,$r=r_{\text{quality}}\times r_{\text{style}}$)。

![图 5a:在线训练过程中三种文体在留出测试集上的准确率变化。阴影区为奖励偏好切换点:SAO 在每次切换后迅速抑制旧主导风格、对齐到新偏好。](/images/reading/single-rollout-async/x9.png)

SAO 在每次奖励切换后快速完成策略转向;而 running-mean 基线因为历史滑动窗口的惯性,被上一个分布的奖励「拖后腿」,适应明显滞后,收敛水位也更低。这证明了状态依赖的 value baseline 在非平稳环境中的必要性。

## 结语评价

**亮点**:

- 问题切得准——「GRPO 组采样与异步不兼容」是行业真痛点,解法不是打补丁而是换框架;
- 三件套(DIS / 单 rollout+强 value / 跳观测 GAE)都有独立消融,工程上可拆解复用,已被 GLM-5.2(750B-A40B)的 agentic RL 管线采用;
- 在线学习实验打开了「真·在线 RL」的想象空间,这是组采样方法在原理上进不去的场景。

**局限与疑点**:

- 全部实验基于 Qwen3-30B-A3B 单一模型族,更大基座/其他架构上是否同样成立还待验证(虽然 GLM-5.2 的部署是个强信号);
- 单条 rollout 对 value model 的依赖是双刃剑——value 训不好的任务(奖励更稀疏、更主观的场景)这套方法可能会先被 critic 拖死;
- 相比组采样,单条 rollout 的样本效率在简单任务上是否吃亏,论文没有正面回答。

**相关阅读**:本站 [Raschka 的推理强度综述](/zh/distilled/controlling-reasoning-effort-in-llms/)里 Kimi 的 Toggle、DeepSeek V4 的分档训练,与本文的「异步+单条」是后训练效率大战的两条战线;速递区近期还有 staleness-adaptive trust regions 等同类工作可对照。

> 本文为论文精读,按原文结构讲解并附译注,公式与图表来自原文;原文见 [arXiv:2607.07508](https://arxiv.org/abs/2607.07508)。
