---
title: "SAO:单条 Rollout 的异步 Agentic RL 优化(全文精读)"
date: "2026-07-08"
description: "THUDM(GLM 团队)的异步 RL 训练框架 SAO 全文精读:用单条 rollout 取代 GRPO 组采样,配合双侧 token 级裁剪(DIS)、更快更稳的 value model 训练和跳过环境观测的 GAE,稳定训练上千步并超越 GRPO,已用于 GLM-5.2 的 agentic RL 管线。"
tags: ["RL", "Agent", "异步训练", "后训练"]
source:
  name: "arXiv"
  url: "https://arxiv.org/abs/2607.07508"
  author: "Zhenyu Hou, Yujiang Li, Jie Tang, Yuxiao Dong (THUDM)"
---

> **论文信息**:[Single-Rollout Asynchronous Optimization for Agentic Reinforcement Learning](https://arxiv.org/abs/2607.07508),Zhenyu Hou、Yujiang Li、Jie Tang、Yuxiao Dong(THUDM),2026-07-08。
>
> **一句话贡献**:把异步 RL 里 GRPO 的组采样换成「单条 rollout + 训得更好的 value model」,再配上把离策略 token 直接掩掉的激进修剪,让异步 agentic RL 第一次稳定跑到上千步。
>
> **为什么值得读**:「异步」是 agentic RL 工程化绕不开的坎——GRPO 的组采样天然和异步冲突(一组必须等最慢的那条)。这篇 GLM 团队的论文给出了一套被 GLM-5.2 生产验证的完整解法,每个设计都有消融背书。
>
> **阅读说明**:本文按原文章节结构完整译出,「译注」块为编者所加,与正文译文区分。

## 摘要

强化学习(RL)在 LLM 后训练中正变得越来越重要。以往的 LLM RL 管线多为同步、批次交错的模式,对长时程 agentic 任务效率低下。近来,异步 RL 通过「rollout 到达即更新」成为更高效的选择。然而,现有异步 RL 系统往往强调吞吐,而训练稳定性与任务有效性仍 largely 未被充分探索——例如,广泛使用的 GRPO 框架中的组采样,与异步 agentic 训练天然不兼容。本文提出**单条 rollout 异步优化(Single-rollout Asynchronous Optimization,SAO)**,以应对异步 RL 的稳定性与离策略挑战。为降低离策略影响并改善泛化,我们用单条 rollout 采样(每 prompt 一条轨迹)替代组采样,并以多项实用的 value model 训练设计强化这一策略;为提升优化稳定性,我们引入严格的双侧 token 级裁剪。SAO 能够稳定训练一千步,并在 SWE-Bench Verified、BeyondAIME、IMOAnswerBench 等 agentic 编程与推理基准上持续超越 GRPO 及其变体。我们还证明,单条 rollout RL 在模拟在线学习(模型必须适应持续变化的环境)中尤其有效。SAO 已成功部署到开源 GLM-5.2 模型(750B-A40B)的 agentic RL 训练管线中。

![图 1:SAO 在推理与编程基准上的表现。四个推理基准在「推理+Python 工具」设定下评估,基线为 Qwen3-30B-A3B SFT;SWE-Bench Verified 以 Qwen3-30B-A3B 为基线。SAO 在全部五个基准上同时超过基线与 GRPO。](/images/reading/single-rollout-async/x1.png)

## 1 引言

LLM 的发展重心正从监督预训练转向后训练强化学习。近期工作表明,把 RL 算力与测试时算力一起扩展,是提升模型智能的高效途径(DeepSeek-AI, 2024a; OpenAI, 2024; Cobbe et al., 2021; Lightman et al., 2023)。然而,大多数 LLM RL 管线仍是同步且交错的:策略生成一批 rollout,等整批收齐后才开始优化(Ouyang and others, 2022; Rafailov et al., 2024)。

对于 agentic 与编程类负载,rollout 长度差异极大:短轨迹很快完成,长轨迹成为拖尾;于是大量 GPU 集群资源在等最慢 rollout 的过程中空转(DeepSeek-AI, 2024b; Kwon et al., 2023; Yu et al., 2022)。异步 RL 通过「rollout 到达即消费」缓解了这种不均衡的生成开销,提升利用率与时钟效率(Mnih et al., 2016; Liang et al., 2018; Hoffman and others, 2020)。

但异步引入了两大挑战。**第一**,每条轨迹可能由多个版本的旧 rollout 模型分段生成,导致更难预测、更严重的离策略,损害训练稳定性。此前的工作(Fu et al., 2025; Noukhovitch et al., 2024)对异步 RL 有所尝试,但主要聚焦效率优化而非效果。**第二**,GRPO(Shao and others, 2024; Wang and others, 2022)这类组采样方法与异步训练不匹配:GRPO 对每个 prompt 采一组响应、用组均值估计优势,组采样引入了由延迟驱动的离策略行为——整组必须等最慢的一条完成才能开训。此外,组采样与在线或复杂 agentic 场景也不兼容:这些场景中,环境往往每个 prompt 只提供一条轨迹反馈(Sutton and Barto, 2018; Schulman et al., 2017; Yao and others, 2022; Nakano and others, 2021)。

本文提出面向 agentic RL 的单条 rollout 异步优化(SAO):在保留异步效率的同时,让存在策略滞后的异步 RL 训练保持稳定有效。SAO 用单条 rollout 更新替代 GRPO 式的组采样,并引入有效的 value model 训练策略使其可行。我们的贡献如下:

- **在多变的策略滞后期下稳定训练**:采用 token 级重要性采样,直接使用 rollout 引擎产出的 log-probabilities,并施加更严格的双侧 token 级裁剪与掩码。
- **降低离策略影响**:用每 prompt 单条 rollout 采样替代 GRPO 流行的组采样;并通过改进 value model 过程使其在 agentic RL 中实用——具体地,让 critic 的更新频率高于 actor,并以冻结 attention 的方式微调 value model。
- **处理多轮 agent 轨迹**:针对交错着环境反馈的轨迹,我们推导了跳过观测的 token 级 GAE 估计器,在动作到动作的边界上计算优势,避免噪声经由非模型生成的观测 token 传播。

我们在 agentic 编程与数学推理基准上评估了 SAO,包括 SWE-Bench Verified(Jimenez et al., 2023)、AIME2025(Balunović et al., 2025)、BeyondAIME(ByteDanceSeed, 2025)、HMMT(Balunović et al., 2025)和 IMOAnswerBench(Luong et al., 2025)。结果表明,我们的异步 RL 设计能稳定训练约一千步,并持续优于强化版 GRPO。此外我们还展示了:SAO 的单条 rollout 策略在模拟在线学习中独具优势,能够适应动态的环境变化。

## 2 预备知识

在语言模型的强化学习中,模型以 $\theta$ 参数化为随机策略 $\pi_{\theta}(y|q)$:给定来自数据集 $\mathcal{D}$ 的查询 $q$,生成响应序列 $y=[y_{1},\dots,y_{|y|}]$。RL 通过最大化一个裁剪过的替代目标来优化 $\pi_{\theta}$,以鼓励稳定的策略更新。形式上,对给定的一批数据,统一的优化目标定义为:

$$ \mathbb{E}\left[\frac{1}{|y|}\sum_{t=1}^{|y|}\min\left(r_{t}(\theta)\hat{A}_{t},\text{clip}(r_{t}(\theta),1-\epsilon,1+\epsilon)\hat{A}_{t}\right)\right] $$

其中 $r_{t}(\theta)=\frac{\pi_{\theta}(y_{t}\mid q,y_{<t})}{\pi_{\theta_{\text{old}}}(y_{t}\mid q,y_{<t})}$ 是当前策略与旧策略的概率比,$\epsilon$ 为裁剪超参数。PPO(Schulman et al., 2017)与 GRPO(DeepSeek-AI, 2024b)的根本区别在于:如何估计优势函数 $\hat{A}_{t}$,以及是否需要辅助价值网络。

**近端策略优化(PPO)**。标准 PPO 通常采用 Actor-Critic 架构,需要训练一个独立的价值函数(Critic)$V_{\phi}$(以 $\phi$ 参数化)来估计当前状态的期望回报。Critic 与策略同步优化,最小化价值误差 $\mathcal{L}_{\phi}^{\text{VF}}=\mathbb{E}[(V_{\phi}(q,y_{<t})-R)^{2}]$,其中 $R$ 为累计奖励。为平衡偏差与方差,PPO 采用广义优势估计(GAE):优势 $\hat{A}_{t}^{\text{GAE}}$ 为时序差分误差的指数加权和,

$$ \hat{A}_{t}^{\text{GAE}}=\sum_{l=0}^{|y|-t-1}(\gamma\lambda)^{l}\delta_{t+l} $$

其中 $\delta_{t}=r_{t}+\gamma V_{\phi}(s_{t+1})-V_{\phi}(s_{t})$。该方法虽然有效,但需要为价值函数额外维护一份模型参数,训练内存占用基本翻倍,计算开销也随之增加。

## 3 基于单条 Rollout 的异步强化学习

![图 2:SAO 的单条 rollout 设计总览。数字表示轨迹的生成顺序:SAO 中每条轨迹完成后立即可用于训练;GRPO 则必须等组内所有轨迹生成完毕。](/images/reading/single-rollout-async/x2.png)

本节介绍 SAO 如何应对异步 RL 训练中的训练不稳定与离策略漂移。通过简洁的 token 级裁剪策略,以及用单条 rollout 替代组采样,我们展示了异步 RL 可以稳定扩展到数千步训练,并取得显著的性能提升。图 2 为 SAO 的总体设计。

### 3.1 通过直接双侧重要性采样(DIS)稳定异步 RL

异步 RL 的首要挑战,是 rollout 模型与训练模型之间产生的「策略滞后」(policy lag)。在 LLM 的解耦 PPO 中,通常用重要性采样缓解离策略偏差:维护当前策略 $\pi_{\theta}$、旧策略 $\pi_{\theta_{\text{old}}}$ 与 rollout 策略 $\pi_{\text{rollout}}$ 三个模型,用 $\frac{\pi_{\theta}}{\pi_{\theta_{\text{old}}}}$ 修正陈旧离策略,用 $\frac{\pi_{\theta_{\text{old}}}}{\pi_{\text{rollout}}}$ 修正训练-推理失配。然而,在异步 RL 中,rollout 引擎可能在单条轨迹的生成过程中就经历多次更新,此时要精确追踪行为概率 $\pi_{\theta_{\text{old}}}$ 在计算上不可行——否则就得维护一长串历史检查点 $\{\pi_{\theta_{\text{old}}^{(1)}},\dots,\pi_{\theta_{\text{old}}^{(N)}}\}$,这在实际实现中不可行。

为此,我们提出一种简化但激进的 token 级重要性采样来裁掉离策略 token。**首先**,直接用 $\pi_{\text{rollout}}$ 作为行为代理、用 $\pi_{\theta}$ 做重要性采样,即 $r_{t}(\theta)=\frac{\pi_{\theta}}{\pi_{\text{rollout}}}$,同时丢弃不准确的 $\pi_{\theta_{\text{old}}}$。这利用 rollout 阶段生成的 log-probabilities,省掉了单独的旧策略推理开销。

**其次**,我们采用双侧校准的 token 级掩码策略。标准 PPO 的裁剪只处理被选中的离策略 token——$(A>0, r_{t}(\theta)>1+\epsilon_{h})$ 或 $(A<0, r_{t}(\theta)<1-\epsilon_{l})$;而我们把信任域限制在区间 $[1-\epsilon_{\ell}, 1+\epsilon_{h}]$,**落在区间外的 token 被完全从梯度计算中掩除**,以防止极端策略发散带来的不稳定。这与 IcePop 机制(Team et al., 2025)有相似之处,但我们的策略更简单——进一步去掉了 $\pi_{\theta_{\text{old}}}$,同时仍能保持稳定训练。

形式上,带 token 级裁剪的优化目标为:

$$ L(\theta)=\hat{\mathbb{E}}_{t}\left[f(r_{t}(\theta),\epsilon_{l},\epsilon_{h})\hat{A}_{t}\log\pi_{\theta}(a_{t}|s_{t})\right] \tag{1}$$

其中概率比直接由 rollout 日志计算,绕开历史策略追踪:

$$ r_{t}(\theta)=\exp\left(\log\pi_{\theta}(a_{t}|s_{t})-\log\pi_{\text{rollout}}(a_{t}|s_{t})\right) \tag{2}$$

稳定性进一步由校准函数 $f(x;\epsilon_{\ell},\epsilon_{h})$ 保证:

$$ f(x;\epsilon_{\ell},\epsilon_{h})=\begin{cases}x,&\text{if }1-\epsilon_{\ell}<x<1+\epsilon_{h}\\ 0,&\text{otherwise}\end{cases} \tag{3}$$

> **译注**:这个设计的本质是用「可控的离策略偏差」换「计算复杂度的大幅下降」。注意实验中的取值:TIR 任务 $\epsilon_{\text{low}}=0.3,\epsilon_{\text{high}}=5.0$——下限收得紧(概率下降超 30% 就掩掉),上限放得宽(概率涨 5 倍才掩),对「快速消亡」的 token 远比「野蛮生长」的更不信任。

这一设计绕开了维护历史模型集的高昂成本:直接使用 rollout 的 log-probabilities,我们接受一个受控程度的离策略偏差,换来计算复杂度的大幅降低,也消除了使用单一、可能陈旧的「最新」旧策略模型所带来的误差。实验表明,这种简化机制支持更激进的裁剪,能有效约束更新步长,在异步场景下带来更优的训练稳定性。

### 3.2 用单条 Rollout 降低离策略

在异步 RL 中,离策略不可避免,而目前流行的组采样 RL 算法(如 GRPO)会引入更严重的离策略:组采样带来「不均衡生成」偏差,且整组数据必须等「最慢」样本生成完才能开训。一个有前景的解法,是用单条 rollout 替代组采样——样本生成完立刻开训。

然而,单条 rollout 优化天然存在梯度估计方差大的问题,与 REINFORCE 类似(Zhang et al., 2021)。降方差需要一个足够好的 value model。本节聚焦用简单策略优化价值建模,最终提升策略性能。

**价值更新快于策略(Faster Value Update)。** 我们发现,单条 rollout RL 不稳定的主要来源是策略与价值函数之间的相互依赖:value model $V_{\phi}$ 不准,优势估计 $\hat{A}_{t}$ 就是噪声,进而造成破坏性的策略更新。为此,我们实现了适配 LLM 的「更快价值更新」:解耦策略与价值模型的优化频率——策略 $\pi_{\theta}$ 每做一次梯度更新,价值网络 $V_{\phi}$ 强制更新 $K$ 次($K>1$,实验取 $K=2$)。这让价值估计在被用于优势计算之前,先更快适应当前策略,从而降低方差。

**通过参数冻结稳定 value model 训练。** 预实验中我们发现 value model 训练不稳定:其梯度范数显著大于策略模型。进一步分解显示,不稳定主要来自 Full Attention 层,而 Mixture-of-Experts(MoE)层相对稳定。基于此,我们对 value model 采用「冻结注意力」策略:RL 训练期间冻结 $V_{\phi}$ 的 attention 模块参数,只优化 MoE 投影。我们的假设是:预训练的 attention 权重已具备足够的语义能力去关注相关 token;把优化限制在 MoE 层,能有效正则化 value model。

**面向 agentic 任务的跳过观测 token 级 GAE。** agentic 任务对 token 级价值估计提出了独特挑战,源于其轨迹结构:$T=[a_{0},o_{0},a_{1},o_{1},\dots]$,其中 $a_{i}$ 为模型动作,$o_{i}$ 为环境反馈。标准 GAE 试图计算相邻 token 之间的价值差;但从模型视角看,动作结束 $a_{i,\text{end}}$ 到观测开始 $o_{i,\text{start}}$ 的过渡是不连续的——模型并不生成 $o_{i}$。在这个边界上计算优势会引入噪声,因为 value model $V(o_{i,\text{start}})$ 要去预测一个外部环境状态的价值。

为此,我们推导了「跳过观测」GAE:显式修改 Bellman 目标,绕过环境反馈 token,把当前动作的价值直接链接到下一个动作的价值。形式上,记 $a_{i,N}$ 为动作 $i$ 的最后一个 token,$a_{i+1,0}$ 为下一个动作的第一个 token,定义优势为:

$$ \hat{A}(a_{i,N})=\delta+\gamma\lambda\hat{A}(a_{i+1,0}) \tag{4}$$

其中时序差分残差 $\delta$ 跨越观测间隙计算:

$$ \delta=r_{t}+\gamma V(a_{i+1,0})-V(a_{i,N}) \tag{5}$$

这一形式让优势估计只依赖模型自身的输出,滤掉环境反馈的随机性。作为对比,一些工作可能考虑使用 step 级价值函数与 GAE 替代 token 级价值,但实验表明 step 级价值会导致次优表现。我们还测试了其他面向 agentic 轨迹的优势设计,结果见附录。

> **译注**:这一节是全文工程含量最高的部分。四个设计互为因果:单条 rollout 方差大 → 需要好 critic;critic 跟不上策略 → 让它更新更快(K=2);critic 自己训不稳 → 冻结 attention;轨迹里有环境 token → 优势估计跳过它们。读的时候可以把它们当成四张独立的「卡片」,按需取用到自己的管线里。

**扩大价值预训练规模(Scaling Value Pretraining)。** 最后,为支撑上述机制,我们发现必须扩大 value model 预训练的数据规模。实验表明,价值估计的「冷启动」问题是一个主要瓶颈;通过显著扩大价值预训练语料的规模,我们为单条 rollout 与 TTUR 机制从训练早期就发挥作用提供了稳健的初始化。

## 4 实验

![图 3:SAO 与 GRPO(w/ DIS)在训练过程中的表现对比。可以看到,SAO 在不同基准上几乎全程优于强化版 GRPO。](/images/reading/single-rollout-async/x3.png)

### 4.1 实验设置

**训练细节。** 数学推理(Python 工具)任务上,我们用 GPT-OSS-120B(OpenAI, 2025)产出的工具集成推理(TIR)数据,对 Qwen3-30B-A3B-Thinking-2507(Yang et al., 2025a)微调 3 个 epoch,并用该微调模型初始化策略与 value model。TIR 要求模型在自然语言数学推理中交错调用 Python 工具。

agentic 推理的 RL 采用:batch size 128、组大小 1、最大长度 128k token。策略学习率 $1\times 10^{-6}$,token 裁剪 $\epsilon_{\text{low}}=0.3$、$\epsilon_{\text{high}}=5.0$。采用长度自适应 GAE(Yue et al., 2025),$\lambda_{\text{policy}}=1-\frac{1}{\alpha l}$、$\alpha=1.5$。value model 学习率 $5\times 10^{-6}$、$\lambda_{\text{critic}}=1$,预热 10 步。更快价值更新取 $K=2$,即每批做两次 value model 更新。GRPO 变体的每批含 16 个 prompt、每 prompt 8 条 rollout,同样构成 batch size 128。编程 agent 的 RL 直接使用 Qwen3-30B-A3B-Thinking-2507,超参与 TIR 基本一致,仅 $\epsilon_{\text{low}}=0.8$、$\epsilon_{\text{high}}=3.0$ 不同。SWE-Bench Verified 使用 OpenHands 脚手架,最多 300 轮交互、128k token 上下文预算。

**评估。** 在四个数学推理基准上评估:AIME2025、BeyondAIME(ByteDanceSeed, 2025)、HMMT Nov 2025(Balunović et al., 2025)、IMOAnswerBench(Luong et al., 2025),报告 Pass@1 准确率。评估统一 top-$p=1.0$、temperature 1.0、最大生成长度 128k token。数学推理评估最多 50 轮以支持长推理与工具调用;SWE-Bench Verified 最多 300 轮 OpenHands 交互。为降低方差,AIME2025 / HMMT / IMOAnswerBench 报告 16 次评估的均值,BeyondAIME 为 4 次。

### 4.2 主要结果

表 1 与表 2 汇总了基线与不同训练策略的表现。GRPO 指带 clip-higher 实现的标准 GRPO(Yue et al., 2025),它保留最新旧策略做重要性采样;GRPO(w/ DIS)指在 GRPO 上使用本文提出的 DIS 策略。

**表 1:数学推理基准实验结果(Pass@1)**

| 模型 | AIME2025 | BeyondAIME | HMMT Nov 2025 | IMOAnswerBench |
|---|---|---|---|---|
| Claude-Sonnet-4.5 | 87.0 | 62.0 | 81.7 | 65.8 |
| GPT-5 High | 94.6 | 74.0 | 89.2 | 76.0 |
| GLM-4.7 | 95.7 | - | 93.5 | 82.0 |
| Qwen3-30B-A3B w/ python | 14.6 | 10.5 | 17.3 | 7.8 |
| Qwen3-30B-A3B w/o python | 85.0 | 63.0 | 76.7 | 55.3 |
| SFT (w/ python) | 80.4 | 53.3 | 75.2 | 53.3 |
| SFT (w/o python) | 14.6 | 46.8 | 17.3 | 42.0 |
| GRPO (w/ python) | 84.2 | 54.8 | 76.0 | 55.8 |
| **SAO(本文)** | **97.3** | **74.8** | **88.3** | **74.0** |
| SAO(仅 DIS) | 94.2 | 71.5 | 86.7 | 71.3 |
| GRPO(+ DIS) | 93.5 | 70.8 | 84.0 | 70.0 |

**表 2:SWE-Bench Verified 实验结果(准确率 %)**

| 模型 | 准确率 |
|---|---|
| Qwen3-30B-A3B | 23.0 |
| + GRPO(w/ DIS) | 27.0 |
| + SAO(本文) | **29.8** |

如表 1、表 2 所示,SAO 在 agentic 推理与编程基准上持续优于所有基线。标准 GRPO 在约 160 步左右出现性能崩塌(表中分数为崩塌前的最终有效分)。图 3 展示了 SAO 与原版 GRPO、GRPO(w/ DIS)在各训练步上的评估表现:原版 GRPO 很快崩塌;GRPO 加 DIS 后能稳定训练,证明了 DIS 的有效性;SAO 与 GRPO(w/ DIS)在初期表现相当,约 400 步后出现明显分化,证明了 SAO 的有效性与稳定性。

### 4.3 消融研究

我们对 SAO 的各项训练配置做了详尽的消融(表 4):

- **更快价值更新的作用**:对照组每批只更新一次 value model(critic-train-epoch=1),而 SAO 为两次。
- **全参 vs 冻结 attention 的 value model**:该变体对 value model 做全参数更新。
- **原版 VAPO 与 running-mean 单条 rollout 基线**:标准 VAPO(Yue et al., 2025)配长度自适应 GAE;以及一个单条 rollout 基线——为每个 prompt 维护最近 8 个奖励的滑动窗口,以其均值作为优势估计的 baseline,作为参数化 value model 的简单替代。

**表 3:主要 value model 消融的训练策略与更新设置**

|  | 价值训练策略 | Critic 更新频率 | AIME2025 | BeyondAIME |
|---|---|---|---|---|
| SAO | 冻结 Attention | 2 | 97.3 | 74.8 |
| 单步更新 | 冻结 Attention | 1 | 95.00 | 69.75 |
| 全参价值训练 | 全参数 | 2 | 90.62 | 74.50 |

**表 4:value model 训练策略消融**

|  | AIME2025 | BeyondAIME |
|---|---|---|
| SAO | **97.3** | **74.8** |
| SAO 去掉更快价值更新 | 95.0 | 69.8 |
| SAO 去掉冻结 attention | 90.6 | 74.5 |
| 原版 VAPO(无 DIS) | 91.3 | 69.0 |
| Running mean 基线 | 79.8 | 55.3 |

如表 4 所示,所有变体相对 SAO 都有性能下降,验证了每个设计选择的必要性。表 3 进一步汇总了主要 value model 消融背后的训练策略与更新设置。就更新频率而言,单次更新不足以让 critic 准确跟踪快速变化的策略,导致 baseline 估计不可靠;全参价值训练变体则表明,冻结 attention 更新有助于在复杂推理任务中正则化 critic 优化。此外,running-mean 奖励的 RL 表现尚可,但仍远落后于 SAO,证明了训练良好的 value model 的优势与必要性。至于原版 VAPO,与原版 GRPO 类似,训练很快崩塌。

### 4.4 训练动力学

我们分析了 SAO 的训练动力学,以理解它如何促进训练稳定。

**更快价值更新的作用。** 图 4(a)对比了 SAO 与单次 critic 更新基线在训练中的 Explained Variance(解释方差)。该指标衡量预测价值 $V(s)$ 与真实回报 $R$ 的对齐程度,定义为 $EV=1-\frac{\text{Var}(R-V(s))}{\text{Var}(R)}$。SAO 在约 400 步后展现出显著更高的解释方差,表明价值收敛更快、与策略分布对齐更好。

**Critic 模型的梯度。** 我们考察了冻结 attention 参数对价值训练的影响。如图 4(b)所示,全参价值训练的 critic 梯度范数显著更大,意味着优化动态不稳定;冻结 attention 策略则保持更低、更平滑的梯度范数,数值稳定性更好。

**被裁 token。** 图 4(c)监测了应用 DIS 的 SAO 与不带 DIS 的标准 VAPO 基线的 token 级裁剪率。VAPO 的裁剪率接近零,无法有效挡住发散的离策略更新,在约 90 步时训练迅速崩塌。

![图 4(a):SAO 与单次 critic 更新基线的解释方差对比。](/images/reading/single-rollout-async/x6.png)

### 4.5 在线学习模拟

**任务设计。** 在真实在线学习环境中,反馈通常被限制为每 prompt 一条轨迹。这一约束与 GRPO 这类依赖组内相对奖励估计优势的成组优化天然不兼容;而 SAO 使用基于价值的 critic 提供优势估计,可以从单条轨迹进行有效的策略更新。

为此,我们设计了一个模拟在线写作任务,评估 SAO 在非平稳环境中的适应性:反馈信号设定为用户偏好的语言风格,奖励标准依次切换为三种文体原型——可爱(cute)、中二(chuunibyou)、古风(classical)。

**动态奖励分配。** 我们用 GLM-4.7(GLM et al., 2025)作为 LLM 评委,评估两个主要维度:回答质量与风格贴合度。最终奖励 $r\in\{0,1\}$ 计算为 $r=r_{\text{quality}}\times r_{\text{style}}$,其中两项均为二元奖励。

训练全程,系统提示词要求模型从候选池中选择一种文体原型:前两个阶段候选为 Academic、Cute、Chuunibyou,最后一个阶段为 Classical、Cute、Chuunibyou。

**结果。** 如图 5a 所示,我们在留出测试集上评估各阶段三种候选风格的表现:SAO 在每次奖励偏好切换后都能迅速完成策略转向——在文体原型之间切换,以保持与环境反馈的对齐。

![图 5a:在线训练过程中三种写作风格(cute、chuunibyou、classical)在留出测试集上的准确率变化。阴影区表示奖励偏好切换到另一文体原型的阶段边界:SAO 迅速抑制此前的主导风格,并根据环境反馈将策略对齐到新目标。](/images/reading/single-rollout-async/x9.png)

**与 Running-Mean 基线的对比。** 为进一步理解 value model 在在线环境中的作用,我们采用 Running Mean 优势估计作为基线:跟踪最近 128 个奖励的滑动窗口来近似 baseline $b$,优势计算为 $\hat{A}=r-\mathbb{E}[r_{window}]$。这种设计将优势估计与 prompt 内的样本组解耦,使在线、单条 rollout 场景下的策略优化成为可能。图 5b 展示了在线学习过程中 SAO 与 Running Mean 基线的训练奖励变化,风格切换后奖励恢复的速度与幅度是算法适应性的关键指标:Running Mean 基线由于历史窗口的惯性,仍被上一分布的奖励暂时带偏,适应明显滞后;而 SAO 的 value critic 能动态跟踪奖励变化,快速恢复并达到更高的收敛水平。这证实了 SAO 的状态依赖 baseline 在非平稳环境中实现有效对齐所需的精确性。

## 5 相关工作

### 5.1 语言模型的强化学习

标准 RLHF 管线从偏好数据训练奖励模型,并用 PPO 优化策略(Ouyang and others, 2022; Schulman et al., 2017)。为降低价值函数学习的开销与不稳定,GRPO(Group Relative Policy Optimization)(Shao and others, 2024; DeepSeek-AI, 2024a)与 REINFORCE 风格的 baseline(如 RLOO)(Ahmadian and others, 2024)等无 critic 目标日渐流行。GRPO 通过在 prompt 级组内归一化奖励来形成优势,在同步训练中提升了稳定性,但也引入了隐式的同步屏障:更新必须等全组成员生成完毕,在异步环境下加剧了陈旧性与离策略漂移。

近期工作进一步改进 GRPO/PPO 式目标,以提升稳定性与降方差,包括序列级重要性加权(Zheng et al., 2025)、自适应裁剪策略(Yang et al., 2025b)、以及硬裁剪的平滑替代(Yue et al., 2025)。但这些工作主要聚焦同步 RL——在那里精确的重要性采样比率更容易获得;面向异步 RL 的重要性采样与裁剪策略仍少有人探索。

### 5.2 LLM 的同步与异步 RL

大多数大规模 LLM RL 实现仍是同步交错的:用固定的策略快照收集整批 rollout,然后在该批次上运行优化 epoch(Ouyang and others, 2022)。推理与工具使用的输出长度呈长尾分布,同步屏障造成拖尾与大量空转,于是有了 rollout 生成与学习并行的异步 actor-learner 设计(Mnih et al., 2016; Sutton and Barto, 2018)。然而,异步引入策略滞后与离策略漂移,往往需要陈旧感知的训练或离策略修正(Espeholt and others, 2018)。

近期有若干系统专门针对 LLM 的异步 RL。Noukhovitch et al.(2024)把异步 RLHF 作为「在线但离策略」的学习来研究,刻画了鲁棒性权衡。系统侧,AReaL(Fu et al., 2025)完全解耦 rollout 与训练,为推理任务引入陈旧感知的 PPO 式更新;ROLL Flash 为 RLVR 与 agentic 训练提供细粒度并行和 rollout-train 解耦(Lu et al., 2025)。与异步系统互补,MobileRL 研究了移动 GUI agent 的在线 agentic RL,引入难度自适应的 GRPO 变体以提升多轮 GUI 环境中的稳定性与样本效率(Xu et al., 2025)。我们的工作与这些系统互补:聚焦组采样 baseline(如 GRPO)在结构上不匹配的单条 rollout 场景,并从算法设计上稳定异步学习。

## 6 结论

本文从训练效果与稳定性两方面探索了异步 RL 的优化,提出了 SAO——一种应对离策略与不稳定的单条 rollout 异步 RL 策略。SAO 通过 token 级重要性采样与双侧裁剪/掩码稳定训练,并用「更强的 value model 训练支撑的单条 rollout」替代组采样以改善泛化。在 agentic 推理与编程任务上,SAO 持续优于 GRPO 基线,并在模拟在线学习中展现出有效的适应能力。

## 附录要点

**附录 A(额外实验结果)**:价值与优势的动作粒度消融显示,token 级显著优于 step 级(AIME2025:token 级 89.8 vs step 级平均 85.8、step 级末 token 87.3;BeyondAIME:66.8 vs 60.5 / 62.8),佐证了 3.2 节跳过观测 token 级 GAE 的选择。

**附录 B(局限与影响)**:作者讨论了方法对 value model 质量的依赖,以及在更通用奖励场景下的适用边界。

## 结语评价(编者)

**亮点**:问题切得准(GRPO 组采样与异步不兼容是行业真痛点);三件套均有独立消融、可拆解复用;已被 GLM-5.2(750B-A40B)agentic RL 管线采用;在线学习实验打开了「真·在线 RL」的空间。

**局限与疑点**:全部实验基于 Qwen3-30B-A3B 单一模型族,更大基座/其他架构上的表现待验证;对 value model 的强依赖是双刃剑——奖励更稀疏、更主观的任务里,critic 可能先拖垮全局;单条 rollout 在简单任务上的样本效率是否吃亏,论文未正面回答。

**相关阅读**:本站 [Raschka 推理强度综述](/zh/distilled/controlling-reasoning-effort-in-llms/)中 Kimi Toggle、DeepSeek V4 分档训练,与本文的「异步+单条」是后训练效率大战的两条战线;速递区近期还有 staleness-adaptive trust regions 等同类工作可对照。

> 本文为论文全文精读:正文按原文结构译出并附译注,公式与图表来自原文;原文见 [arXiv:2607.07508](https://arxiv.org/abs/2607.07508)。
