# 规模化自动后训练

> 2026-08-03

> 本文转载自 [Intology Blog](https://intology.ai/blog/scaling-automated-post-training)，原文 *Scaling Automated Post-Training*，作者 Intology 团队，首发于 2026-08-03。此处为中文翻译，仅供学习交流。原文的图表是动态组件，本文图片为按文中数据点重绘的示意图(曲线形状非原始数据);评价与局限见文末「译者注」。

## 引言

Intology 的目标是自动化研发。几个月前他们预览了 Locus——一个号称在 AI R&D 任务上超越人类的通用自动研究系统。他们把**自动化 LLM 后训练**当作衡量进展的试金石:后训练需要大量算力，实验搜索空间横跨基座模型、数据、目标函数和训练算法，是一个困难、昂贵、开放的问题。

这次他们公布了 Locus 的更新版:Agent 本体改进之外，还配了一套专门的实验基础设施，能规划、启动并自适应地调度大量并行实验，时间跨度达数天。结果:

- 在 PostTrainBench 上超过所有前沿 Agent 基线;
- 在更大算力的 PostTrainBench+ 上，后训练出的模型集体超过基线和人工指令调优的官方 Qwen3-1.7B;
- 能力可以跨域泛化:开箱即用打当时所有带奖金的 Kaggle 比赛，平均排名第四;
- 已产生实际业务价值:为无代码平台 Bubble 端到端训练的模型已上线生产。

## Locus 在 PostTrainBench 登顶

PostTrainBench 考察 Agent 跨七个基准(从医疗到编程)做后训练的能力:给定基座模型、目标基准、一台单卡 H100 和联网权限，产出一个为该基准优化过的后训练模型。

在官方 Tier 1 设定下，Locus (Opus 5) 得分 **44.7**，领先 Claude Code (Fable 5) 的 41.8 约 2.9 分，更远高于 Codex (36.2)、Claude Code (Opus 5) (34.1) 和 AlphaEvolve (19.2)。该结果经 PostTrainBench 作者外部验证，并通过了官方的污染与作弊检查(防测试集泄漏判官、API 使用判官、模型身份检查等)。

![图 1:官方 Tier 1 设定下，Locus (Opus 5) 以 44.7 领跑 PostTrainBench 综合分。](/images/distilled/locus-post-training/tier1-composite.svg)

但原设定有明显局限:Agent 只有 10 小时墙钟和单卡。而小型前沿生产模型的后训练估计要上千 H100 小时——至少多两个数量级。更重要的是，深度学习史上反复出现「小算力下的最优方法在大算力下不是最优」(LSTM 是经典例子)，低算力优化的结果未必能外推。

于是他们引入了大算力变体 **PostTrainBench+**。

## 更大算力，看得更清

PostTrainBench+ 与原设定相同，但算力放宽了几个数量级(从 70 H100 小时提到 4,500，取消单机和 10 小时限制，Agent 可以向 K8s 集群提交作业;运行到 100 小时墙钟、或连续 50 次提交无提升、或 Agent 自认到顶为止)。

几乎所有基线在更大算力下都有提升，但 Locus 提升最大:综合分 **51.6%**，超过人工调优的官方 Qwen3-1.7B-Instruct(**49.4%**);最强基线 Claude Code (Opus 4.8) 44.3%,GLM 5.2 42.7%,GPT-5.5 34.6%。

![图 2:算力—性能曲线(按文中端点数据重绘的示意)。约 2000 H100 小时后基线停滞，Locus 持续爬升并超过人工调优 checkpoint。](/images/distilled/locus-post-training/performance-vs-compute.svg)

两个值得记住的观察:

- **低算力下的排名噪声极大。** 70 到 1,000 H100 小时之间，四方的完整排名变换了 11 次;从该区间随机取一个算力截断，复现 4,000 小时处排名的概率是 0%。排名要到约 1,284–2,000 H100 小时才稳定。
- **基线在 2,000 小时后集体停滞，Locus 没有。** 它的曲线到 4,000 小时仍在稳步上升。

论文进一步拆解了原因:大算力下，获胜方法从「通用 SFT」转向更大规模、更多样的方案;Locus 执行大规模实验更可靠，探索的方案也更多。

## 案例研究:大规模实验是推理后训练的关键

AIME 2025(竞赛数学)是最能体现这一点的基准，因为强竞赛数学表现历来依赖大规模的推理导向后训练。Locus 后训练的模型达到 **20%**，是第二名 GLM 5.2 (CC)(10%)的两倍，其余基线贴着地板。

**Locus 的做法**:在 OpenMathReasoning 数据集上做大规模 SFT——先在 8 张 H100 上分布式训练约 3.17B token;检查中间 checkpoint 的 rollout 时，它发现**连续几个 checkpoint 的推理 CoT 越来越不能正常终止**，判断这伤害了性能，于是回溯到更早的 checkpoint，改用过滤后不超过约 6k token 的样本继续 SFT，累计约 3.64B token。

**基线的对照**:

- Codex (GPT-5.5) 全程没有尝试过超过 1.53M token 的训练，一直在 20–300 步的小 LoRA 和 checkpoint 合并之间打转;
- Claude Code (Opus 4.8) 敢上十亿级(最大 1.42B token 的 SFT)，但不可靠——一次 SFT+RL 跑出 0.00%，一次 295M token 的 SFT 只得 3.33%;
- GLM 5.2 (CC) 基线里最好(10%)，做法是把 3 个公开学术数据集清洗合并后做了约 85M token 的中等规模训练。

![图 3:各方法「历史最佳方案」的 AIME 准确率与其训练 token 数(示意)。Locus 呈现清晰的时序扩展轨迹;GLM 与 Codex 的最佳方案用的 token 反而比之前的方案更少——即没能通过加数据变好。](/images/distilled/locus-post-training/aime-training-scale.svg)

## 高绩效的方法，探索得也更多

更大的算力预算不只是能跑更大的实验，也能试更多种类的方案。统计每个 benchmark 上各方法尝试过的**独立方法数**(approach，指高层假设层面的不同路线，定义见文末附录)发现:Locus 的探索量是基线的最多 3 倍，且探索量与得分正相关。

![图 4:每基准独立方法数与综合分(示意散点)。](/images/distilled/locus-post-training/approach-diversity.svg)

一个典型例子是 ArenaHard:Locus 的最终方案是「同家族更大模型的教师蒸馏 → 长度归一化 DPO → APO-zero」的组合——蒸馏 SFT 模型约 55%，长度归一 DPO 提到 73.5%,APO-zero 续训到 84.5%。而**没有一家基线把 DPO 跑通过**，全部停在 50% 以下(Opus 4.8 CC 49.9%、GLM 5.2 CC 46%、Codex 6.3%)。方案多样性让 Locus 突破了所有基线都没能打破的平台期。

## 跨领域泛化:Kaggle 实战

Locus 的能力不止于后训练。他们把它**开箱即用**地扔到当时所有带奖金、有公开排行榜的 Kaggle 比赛上——只给 Kaggle API 和比赛链接，无任何专门设定。六场比赛横跨 OpenAI 越狱攻防、细胞追踪、油气钻探地质预测等领域，累计一万五千多支队伍、175 万美元奖金;这些比赛当时已进行了最长三个半月，Locus 只跑了 16 天。

结果:平均击败 **89.5%** 的人类队伍;去掉每日限交一次、已被人类优化了一年多的 ARC-AGI-2 后，其余比赛平均击败 **94.5%**。按六赛平均排名，Locus 排第四(前三名也都是人类)。这是首个在所有在营奖金制 Kaggle 比赛上被系统评估的自动系统。

![图 5:Locus 在六场 Kaggle 比赛的排行榜百分位。](/images/distilled/locus-post-training/kaggle-standings.svg)

## 生产落地:Bubble

今年早些时候，Intology 开始与最大的无代码开发平台 Bubble 合作。Locus 为 Bubble 的一个核心 AI Agent 工作流自主发现了一套后训练配方，端到端微调了一个开源模型，替换了原来的前沿 API 方案:生产规模下**错误率约 2.8× 更低、延迟约 5.4× 更低、单次查询成本约 105× 更低**。Locus 目前还在为 Bubble 训练一个懂其私有编程语言的通用模型，首个版本已上线。

![图 6:Bubble 生产指标，相对原系统(=100)的对比。](/images/distilled/locus-post-training/bubble-production.svg)

## 局限与译者注

**原文自陈的局限**:PTB/PTB+ 都是针对单一基准优化，有过拟合基准而非获得通用能力的风险;大算力运行成本高，每个设定只跑了单次，无法测量运行间方差;Locus 与编码 Agent 不完全可比——它的集群调度与实验管理基础设施是系统的一部分，而基线在 PTB+ 里只拿到了「能向共享集群提交作业」这一子集工具。

**译者补充几点**:

- PostTrainBench+ 是作者方自己引入的变体设定，算力配额、终止条件、可用算力的定义(见原文附录 A)都会影响对比，读数字时留意;
- 这是公司博客，服务于 Locus 的产品叙事;但 AIME 案例研究、基线失败模式、低算力排名不稳定这几个观察，剥离宣传语境后依然有独立价值;
- 单次的 51.6 vs 49.4(超过人工调优 checkpoint)差距不大，不宜过度解读为「自动后训练已超越人类」，更稳妥的读法是:在大算力长周期下，Agent 的后训练能力已经摸到了人工调优小模型的量级。

## 附录精选

### AlphaEvolve 为什么垫底(19.2)

原文附录 B 的分析颇有参考价值，两点原因:

1. **进化机制不适合快速调试迭代。** AlphaEvolve 会故意写带更好日志的崩溃代码来捕获错误，但这些候选被赋予低适应度，几乎不会成为后续候选的父代——含关键错误信息的候选只有 13.7% 的时间被用作父代(高分候选是 60.7%)。而编码 Agent 天然能把报错带进下一轮迭代。
2. **模型本身弱。** 当时 AlphaEvolve 可用的最强 Gemini 3.5 Flash 能力不够——典型翻车是在信息充足的情况下，仍为 BFCL 工具调用任务构造了格式错误的训练数据。

两者叠加，导致平均 30% 以上的算力浪费在无法产生有效分数的 bug 上。

### 「独立方法数」怎么算

原文附录 D:用一个编码 Agent 检查每个「方法 × 基准」格子的完整实验记录(trace、训练作业、产物)，把工作归并为若干 approach——approach 指一个自洽的高层假设:用什么监督来源、想注入什么能力、用哪类学习算子/目标函数。实现细节变化(脚本重写、混合比例、课程权重、续训阶段、合并拓扑)不算新 approach，只有高层科学假设变了才算。分类由 GPT-5.6 Sol 执行，误差棒为 benchmark 间 bootstrap 置信区间。

### 结果验证

全部 PTB/PTB+ 产物(checkpoint、摘要化 trace、工作区、判官裁决)在发布前交给了 PostTrainBench 作者独立验证;PTB+ 全部结果完成于 2026-07-01 之前，验证贯穿整个七月。PTB+ 不作弊取最高分:对被标记作弊的提交不打零分，而是报告滚动最佳中无污染的那一个，并重跑三次推理取均值。

## 主要参考文献

- Rank et al. *PostTrainBench: Can LLM Agents Automate LLM Post-Training?* [arXiv:2603.08640](https://arxiv.org/abs/2603.08640)
- Moshkov et al. *AIMO-2 Winning Solution: OpenMathReasoning Dataset.* [arXiv:2504.16891](https://arxiv.org/abs/2504.16891)
- DeepSeek-AI et al. *DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via RL.* [arXiv:2501.12948](https://arxiv.org/abs/2501.12948)
- Ouyang et al. *Training Language Models to Follow Instructions with Human Feedback.* [arXiv:2203.02155](https://arxiv.org/abs/2203.02155)
- Lambert et al. *Tulu 3: Pushing Frontiers in Open Language Model Post-Training.* [arXiv:2411.15124](https://arxiv.org/abs/2411.15124)
- Google DeepMind. *AlphaEvolve: A Gemini-powered coding agent for designing advanced algorithms.* 2025
