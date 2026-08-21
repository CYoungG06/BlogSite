# SWE-1.7:以极低成本实现前沿智能

> 2026-07-08

> 本文转载自 [Cognition Blog](https://cognition.com/blog)，原文 [SWE-1.7: Frontier Intelligence at a Fraction of the Cost](https://cognition.com/blog/swe-1-7)，作者 Ben Pan、Carlo Baronio(共同一作)等，首发于 2026-07-08。此处为中文翻译，略去了产品推广部分，仅供学习交流。

SWE-1.7 是 Cognition 目前训练出的最强模型，以低得多的成本达到了前沿级智能，推进了成本—性能的 Pareto 前沿。它来自对整个 RL 管线的广泛改进:更好的基础设施、更稳定的训练、更高质量的数据，以及面向长程任务的新技术。

一个值得注意的点:SWE-1.7 的基座是 Kimi K2.7——一个已经过充分 RL 后训练的模型。在这个基座上，Cognition 自己的训练仍然带来了大幅额外提升，这对「后训练天花板」的说法是一个挑战，说明 RL 能把能力推得比此前认为的远得多。

评测数据(agentic coding benchmark 通过率):

| Benchmark | SWE-1.7 | Kimi K2.7 Code | GPT-5.5 | Opus 4.8 | Opus 4.7 | GLM-5.2 | Composer 2.5 | SWE-1.6 |
|---|---|---|---|---|---|---|---|---|
| FrontierCode 1.1 Main | 42.3% | 30.1% | 43.0% | 46.5% | 38.5% | 24.5% | 25.6% | 9.4% |
| Terminal-Bench 2.1 | 81.5% | 72.7% | 84.2% | 86.9% | 83.0% | 81.0% | 76.0% | 39.7% |
| SWE-Bench Multilingual | 77.8% | 73.5% | 76.8% | 84.4% | 80.5% | 74.5% | 71.6% | 58.3% |

这篇文章的主体是 SWE-1.7 的训练方法:基础设施、算法与数据工作。重点有四个组件，最后是训练带来的一些有趣行为变化。

## 保持熵与稳定训练

训练的稳定性，是在规模扩大后能否**可预测地持续进步**的关键。

用异步 RL 训练时([PipelineRL](https://arxiv.org/abs/2509.19128))，最棘手的问题之一是推理与训练之间的 KL 散度失配——trainer 的策略和采样策略通常不是同一个([参考](https://fengyao.notion.site/off-policy-rl))。此前(在较小规模上)他们用重要性采样修正、面向低精度 rollout 的量化感知训练(NVFP4)，以及专家路由回放([R3](https://arxiv.org/abs/2510.11370))来纠正。在更大规模上，还需要下面这些新的干预手段。

### top-p 采样:从源头防止熵坍缩

他们发现 [top-p 采样](https://arxiv.org/abs/1904.09751)对防止熵坍缩有显著作用。熵坍缩(见 [Entropy Mechanism](https://arxiv.org/abs/2505.22617)、[DAPO](https://arxiv.org/abs/2503.14476))指的是:强模型停止探索，奖励在几百步内就进入平台期。

极低概率的 token 往往属于已经跑偏、跑到分布外的轨迹，这些轨迹大概率拿低奖励;而 softmax 的性质决定了，采样到这些 token 会让分布变得更尖锐。推导一下:假设三个 token 的 logits 满足 $x_1 > x_2 \gg x_3$，概率为

$$p_i = \frac{e^{x_i}}{e^{x_1} + e^{x_2} + e^{x_3}}$$

其中 token 3 是那个会导致低奖励的低概率 token。如果采样到了 token 3，它的 logprob 对 logits 的梯度是:

$$\nabla \log p_3 = \nabla \log \left[\frac{e^{x_3}}{e^{x_1} + e^{x_2} + e^{x_3}}\right] = \begin{bmatrix} -p_1 \\ -p_2 \\ p_1 + p_2 \end{bmatrix}$$

策略梯度对 logits 的更新为 $\Delta x_i \propto \hat{A}\ \nabla \log p_3$,$\hat{A}$ 是采样 token 的 advantage。这条轨迹奖励低，$\hat{A} < 0$，于是:

$$\Delta x_1 \propto |\hat{A}|\,p_1, \qquad \Delta x_2 \propto |\hat{A}|\,p_2, \qquad \Delta x_3 \propto -|\hat{A}|\,(p_1 + p_2)$$

$x_3$ 被惩罚，而 $x_1$ 比 $x_2$ 涨得更多——采样到 $x_3$ 反而拉大了本就领先的 token 的优势，分布被锐化、熵下降。top-p 采样让这些低概率 token 根本不会被采样、不会成为优化目标，从第一步就掐断了这个机制。

![图 1:训练过程中的策略熵。SWE-1.7 的配方让熵在整个训练中大致保持恒定。](/images/distilled/swe-1-7/policy-entropy.svg)

### 采样分布回放(sampling distribution replay)

但朴素地加 top-p 显然会加大训练—推理失配:trainer 计算概率是在全部 token 上，而 rollout 只在 top-p 子集里采样，两个分布的散度更大，几步之后就会崩。

他们的解法是采样分布回放(类似 [DeepSeek-V3.2](https://arxiv.org/abs/2512.02556) 的做法):rollout 时记录实际参与采样的 token 集合(kept-set),trainer 侧用这些 mask 对概率做重归一化。修复之后，整个训练过程中熵大致恒定，训练—推理散度保持有界。

![图 2:训练过程中的训练—推理失配曲线。](/images/distilled/swe-1-7/train-infer-mismatch.svg)

top-p 回放还有一个有趣的副作用:它实际上只对 $p < \text{top-p 阈值}$ 的 token 计算梯度。概率高于阈值的 token,kept-set 大小为 1，重归一化后的分布恒等于 1，梯度为零。经验上，模型采样出的 token 里有一大半都在常规 top-p 阈值之上，于是它们被整体排除在梯度计算之外——这降低了梯度噪声，让优化算法把注意力集中在轨迹中高学习信号的 token 上。

此外，他们还从 [Muon 优化器](https://kellerjordan.github.io/posts/muon)(另见 [Muon is Scalable for LLM Training](https://arxiv.org/abs/2502.16982))和消除 trainer 中的非确定性操作里获得了收益。

## 多集群训练与容错

Cognition 处在算力受限的环境里:单网络 fabric 上 1 万–10 万卡的大集群是稀缺资源，而世界各地的小集群到处都是——只要用得对。RL 的结构恰好有利:它天然可以跨集群分解。**只有 trainer 必须待在单个高带宽集群里;生成 rollout 的推理引擎是自包含的，跑在哪儿都行，只需要当前权重。**

他们围绕这一点建了基础设施:RL 训练横跨三大洲的四个数据中心，把自有 GPU 集群和 Fireworks 这类推理供应商的算力拼在一起，使 RL 的规模不再受单一集群上限的约束。

这套架构可以概括为:美国的一个 trainer 集群负责优化，每 K 个梯度步计算一次当前与上一版权重的**压缩差量**(XOR diff + zstd)，传输量降低 99% 以上([参考 Fireworks 的分析](https://fireworks.ai/blog/frontier-rl-is-cheaper-than-you-think));差量不直接点对点广播，而是写入云端对象存储作为权重版本的单一事实源;各集群的 weight controller 轮询 manifest，发现新差量后让 worker 下载各自分片，再用 tree broadcast 在本地磁盘间复制。同一套对象存储还反向把 routing matrices 和 top-p masks 从推理引擎带回 trainer。

推理引擎会在**继续服务轨迹的同时**把差量预取进 CPU 内存，全部就位后才短暂暂停、就地应用;在途的轨迹直接在 KV cache 不动的情况下用新权重继续跑。效果是:1T 参数模型的跨洲权重更新端到端 1–2 分钟完成，全程异步，训练不被阻塞，推理只停 3–4 秒。

### 容错

大规模下硬件故障是持续的背景噪声，每次失败都全局重启，长时间 run 根本跑不下去。他们按故障位置分别处理:

- **推理侧失败，设计上就是廉价的。** 引擎自包含、除当前权重外无状态，挂一个引擎只损失它在途的会话。他们用 NVIDIA Dynamo 管理引擎生命周期并路由推理:每个 agent 沙盒有独立 proxy 记录 token 进出，replica 挂了不会丢整条轨迹，Dynamo 会把它重路由到别的 worker。副本被调度到健康节点后，weight controller 从对象存储加载最近的 checkpoint，再依次回放差量到最新版。
- **trainer 是唯一失败昂贵的地方**——它是单点紧耦合组件，死一个节点拖住整个集群。为了快速恢复:每个节点每步都异步 checkpoint 到本地磁盘，并把分片复制给 peers，死节点的状态几秒钟内从副本重建;容量仍不足时，run 按整个 data-parallel replica 缩容，节点回来后再长回去。整个过程中 rollout 管线保持温热。trainer 重启后，一个 buffer policy 负责挑选用哪些积累下来的 rollout，避免中断期间训练—推理吞吐失衡引入的偏差。

## 数据质量

数据是模型学到什么能力、什么技能的核心决定因素。他们的目标是:校准过的、足够难的数据，同时抑制不良行为。重点关注三方面:

- **Verifier 质量。** 一个任务的 verifier 可能错在两个方向:接受错误解(假阳性)，或拒绝正确解(假阴性)。他们建了成体系的质量保证管线，把训练中观测到的假阳性和假阴性都压到最低。
- **难度。** 模型总能解出、或总能失败的任务，都提供不了有意义的学习信号。他们挑选模型只有较低解出率的任务——既产生真实的学习信号，又持续推高能力上限。
- **作弊检测与防治。** 针对各种形式的 reward hacking 做了多层防御:沙盒断网、剥离 git 历史和参考产物、评分路径与 agent 本体隔离、对已知利用特征做程序化检测。最后，为了保证激励正确:轨迹中只要出现任何一次作弊企图，reward 直接记 0——不管它最终有没有成功。

## 长程任务的智能自我压缩

SWE-1.7 直接训在 Devin 的 harness 里，目标就是异步、长时间运行的任务。这带来两个挑战:其一，rollout 会远超原始上下文窗口;其二，如 [DeepSeek R1](https://arxiv.org/abs/2501.12948) 所示，推理任务上的 RL 会让响应越来越长，但他们希望模型的推理是高效的——只在困难任务上展开。

### 自我压缩(self-compaction)

当 agent 接近上下文上限时，让它总结自己的工作状态，然后从这份自己写的总结里恢复继续。训练过程中，模型同时学会两件事:(1) 写出信息量更足、更简洁的总结;(2) 更好地基于这样的总结继续工作。这个方法最早在 [Kevin-32B](https://cognition.com/blog/kevin-32b)(CUDA kernel 优化的多轮 RL)里引入。借助自我压缩，SWE-1.7 训练中的 rollout 最长达到了**六个小时**。

### 交替长度惩罚(alternating length penalty)

长度惩罚不是全程均匀施加的，而是分阶段交替([参考 Kimi K2.5](https://arxiv.org/abs/2602.02276)):

- **无约束阶段**:模型只为任务成功而优化;
- **预算阶段**:对超出预算的解施加惩罚，预算用一个加权成本函数衡量，包含 token 数、轮次和工具调用的总耗时。

效果是:在模型能力范围内的任务上，响应长度趋于压缩;而在困难任务上，长程行为被完整保留。

![图 3:交替长度惩罚下，训练过程中的平均响应长度。](/images/distilled/swe-1-7/response-length.svg)

## 结果:模型行为的变化

经过大量 RL,SWE-1.7 的行为和它的基座 Kimi K2.7 Code 有了明显差异。

**浓缩的思维链(condensed chain-of-thought)。** 与 Kimi K2.7 Code 相比，SWE-1.7 第一段 CoT 的虚词比例(充当语法「胶水」的词占比)明显更低，句均词数几乎减半。他们认为这是交替长度惩罚中预算阶段的直接结果。

**更彻底的代码库探索。** SWE-1.7 在动手之前会做多得多的探索——工具调用、文件读取、搜索的次数都显著更高。

![图 4:FrontierCode 1.1 Main 上的行为倾向对比。](/images/distilled/swe-1-7/behavioral-tendencies.svg)

这一点在 bug 修复上体现得最清楚:bug 报告通常只描述一个主要症状，但底层问题往往波及更大的范围。SWE-1.7 明显更倾向于追查 bug 的根因，考虑边界情况、各种假设、对抗输入和「超出字面要求」的需求;遇到语义模糊的地方，它倾向于**写小 Python 脚本做实验来确认**，而不是靠猜。

![图 5:思维链主动探查边界情况与隐藏需求的频率(对数坐标)。](/images/distilled/swe-1-7/edge-cases.svg)

他们认为，这些行为直接来自数据侧为清除假阳性/假阴性所做的大量质量保证——模型被迫给出更完整、端到端的解法，而这种增强的「尽职调查」直接转化成了各 benchmark 上更高的分数。

代价是改动范围的扩大:好的解法应该只改必需的最小文件集，而思考更多的模型也做得更多——写额外的测试用例、动更多文件。他们在整个行业的模型上都观察到了这个趋势:推理越多，触及的文件范围越大。这是他们接下来想改进的一个方向。

## 评测方法

所有模型都在各自最高的推理强度档位下评测。Terminal-Bench 2.1 用内部评测框架(Anthropic 模型走 Claude Code、OpenAI 模型走 Codex、其余走 Devin CLI)，超时 4 小时;SWE-Bench Multilingual 优先采用自报数字，否则用 Devin CLI 评测;FrontierCode 1.1 见其[评测博客](https://cognition.com/blog/frontier-code-1.1)。
