---
title: "语言模型 Harness 是组合式泛化器"
date: "2026-07-20"
description: "Alex Zhang 与 Omar Khattab(MIT CSAIL)提出:组合式泛化的能力可以住在 harness 里——用 RL 训练递归语言模型(RLM),只在短任务上训练就能泛化到 8–32 倍长的任务并跨域迁移;核心是通过上下文卸载与程序化子调用,让每次 LM 调用都「局部在分布内」。"
tags: ["LLM", "Agent", "Harness", "RL"]
source:
  name: "Alex L. Zhang's Blog"
  url: "https://alexzhang13.github.io/blog/2026/harness/"
  author: "Alex Zhang, Omar Khattab"
---

> 本文转载自 [Alex L. Zhang's Blog](https://alexzhang13.github.io/),原文 [Language model harnesses are compositional generalizers](https://alexzhang13.github.io/blog/2026/harness/),作者 Alex Zhang 与 Omar Khattab(MIT CSAIL),首发于 2026-07-20。此处为中文翻译,仅供学习交流。本站另有一篇相关译文:[《面向自我改进的 Harness Engineering》](/zh/distilled/harness-engineering-self-improvement/)(Lilian Weng),可对照阅读。

**现代后训练已经变成了一种蛮力范式:堆砌越来越多的环境、越来越长的训练时程。** 这在很大程度上是因为,前沿 Transformer 仍然不擅长*组合式泛化*(compositional generalization)——通过组合熟悉的要素来解决未见问题的能力。除非我们的模型能把学到的单点经验组合起来,否则扩展(scaling)的回报就会低于预期:每个新领域都会要求一份属于自己的训练数据投入。

当然,训练数据不是唯一的杠杆。过去几年,我们通过给 Transformer 搭*脚手架*(scaffolding)来攻克更难的任务——先是思维链推理,然后是工具使用,等等。但在这整个过程中,*泛化*本身却被留给了底层神经网络,以及它 [2017 年那套 token 级归纳偏置](https://arxiv.org/abs/1706.03762)。我们认为,更好的泛化在很大程度上是今天所谓 **harness** 的职责。harness 是位于外部世界与神经网络之间的程序:它决定如何把环境的当前状态(可以任意长、任意复杂)编码成一个或多个给 LLM 的输入,并决定下一步动作。**harness 的首要职责,应该是承载一种更高层的归纳偏置,把陌生而复杂的问题归约为更小子问题的组合,交给底层神经网络处理。**

具体来说,我们认为好的 harness 应该**塑造对底层 Transformer 的每一次调用,使得每次观测都*局部在分布内*(locally in-distribution)**——即每次 Transformer 调用面对的 prompt,都落在其训练数据的分布之内。事实上,好的 harness 经常能把那些看似需要后训练突破的问题,归约成当前这一代语言模型几乎平凡的能力。近一年前,我们在长上下文处理上展示过这一点的[一个版本](https://alexzhang13.github.io/blog/2025/rlm/);而在本文中,我们展示这一原则可以延伸到*学习*本身的效率上:**通过良好设计的 harness,模型学到的东西在任务长度和任务领域上的泛化,都远好于直接训练神经网络。**

我们用强化学习(RL)训练一个递归语言模型(Recursive Language Model,RLM)来验证这一点。RLM 是一种 harness:模型把上下文卸载出去,转而依靠程序化分解和递归子调用来执行。结果总结在图 1 中:只在短任务上训练,就能泛化到 8–32 倍长的留出任务;在训练集增益相同的情况下,评估增益约为直接训练底层 Transformer 的 10 倍。此外,在一个领域上训练,向其他领域迁移的比率也远好于普通 Transformer。

![**图 1.** 我们把 Qwen3-30B-A3B-Instruct-2507 分别作为 RLM 和基座 Transformer(+ YaRN)在一组任务上训练,绘制训练增益与评估增益。左图:在 6 个短任务环境上独立训练,在上下文长度 8–32 倍的同类任务划分上评估。右图:在 3 个任务环境上训练,在 3 个采用相似分解策略的不同领域上评估。可以看到 RLM 的评估增益追平或超过训练增益,而基座 Transformer 难以泛化。在一些长度泛化实验中,RLM 起初学到的方案只对短任务有效、不可泛化,但随后发现了更具泛化性的分解策略,使评估增益反超训练增益。](/images/distilled/lm-harness-compositional/fig1b_length_strategy_generalization_lift.png)

我们之所以能观察到这种泛化效应,是因为 RLM harness 在具有潜在相似性的任务之间诱导出了一种等价关系:对这些任务,RLM 的主上下文看到的几乎是相同的 token 级轨迹,如图 2 所示。这些结果说明:与调模型架构和训练配方类似,良好设计的 harness 既能降低堆砌更多数据、生成更长 rollout 的成本,又能扩大后训练可解任务的覆盖面。

![**图 2.** RLM harness 在两个不同任务(BrowseComp-Plus 与 OOLONG)上的示意:(理论上)根 LM 的上下文窗口可以看到完全相同的轨迹——任务相关的查询被推迟到子调用中,信息通过 REPL 变量流转。如果 RLM 在其中一种任务上训练,它就能泛化到另一种,因为根 LM 现在可以把它们视为同构。这种同构发生在两个任务共享潜在结构、且 RLM 能用子调用以程序化方式加以利用、同时把领域特定信息卸载为子任务时。换句话说,harness 在全部轨迹上诱导出一个商集(Hi/Q),把相似任务归约为同一条 token 轨迹。](/images/distilled/lm-harness-compositional/fig1a_rlm_trajectory_isomorphism.png)

## 更好的扩展需要组合式泛化

AI 的开放问题,往往归根结底都是让深度神经网络泛化的问题。现代后训练对此的应对,是按想象中的应用场景定制环境来打补丁。本文要论证的是:**组合式泛化**这个也许有些无聊的老概念——通过组合熟悉的概念与模式来解决未见问题的能力——正以一种令人无法忽视的方式,显露出它是现代 AI 系统必须开始优先对待的、必要且可扩展的元能力。

我们此前通过[**管理不善的天才假说**(Mismanaged Geniuses Hypothesis,MGH)](https://alexzhang13.github.io/blog/2026/mgh/)论证过:人类真正关心要解决的任务,几乎总是可以相当自然地分解为子任务,这些子任务不仅简单得多,而且也并没有超出当前这一代语言模型太多。要在实践中利用这一点,组合式泛化是关键——它让我们系统的可达任务空间,超出训练集的直接覆盖范围;尤其是那些表面 token 看起来毫不相似、但共享某种底层结构的任务。

![**图 3.** 人类定义的任务及其制品(如我们用来训练模型的 web 数据)天然有界,但更长的任务具有可以有效分解的可描述结构。关键在于:分解本身要短、要简单。](/images/distilled/lm-harness-compositional/fig2_mgh_long_task_decomposition.png)

遗憾的是,从过去几年在语言模型训练上的天文数字投入来看,Transformer 和其他现有的神经序列模型,在组合式泛化上至多只能算「不可靠」。虽然组合式泛化确实有可能在纯神经层面上涌现,但[在 AlexNet 五年后拼出来的](https://arxiv.org/abs/1706.03762)那套基本的可微神经运算,在编码我们训练语言系统所需的归纳偏置方面,似乎并不怎么最优。实际上,正因为我们现在拥有了如此强大的语言先验与语言模型,我们认为是时候认真追问:我们的归纳偏置,能否不只是几何性的、或关于简单对称性的,而是开始活在更高得多的抽象层级上?

## 组合式泛化的能力可以住在 harness 里

我们通常关心*智能体*(agent):任意一个「策略观测状态 $s$、执行动作 $a$、与环境 $E$ 交互」的循环。给定状态 $s$,人们很容易直接把 $s$ 序列化成 prompt、原样 tokenize,丢给 Transformer 当策略。但由于状态与动作空间可以任意大、任意复杂,我们整个领域在摸爬滚打中学会了引入 *harness* $H: s \rightarrow a$——一个位于外部世界与神经网络之间的程序:它决定如何把环境的当前状态(可以任意长、任意复杂)编码成一个或多个给 LLM 的输入,并决定下一步动作。

传统上,我们认为 Claude Code、Codex 这类 harness 之所以必要,是因为它们能在复杂环境中调用外部工具。但那只是智能体的一部分。我们认为,**harness 更根本的力量在于:它能把任意复杂的状态 $s$,简化为(可能)许多个更小的观测 $o$,使 harness 中的每一次 LM 调用都能妥善处理。** 我们已经知道 Transformer 在组合式泛化上不可靠,所以可以依靠 harness 来定义更高层的归纳偏置。设计任何东西都会触发人们对「苦涩的教训」(bitter lesson)的本能警惕,但没有免费的午餐:正是*可扩展的*归纳偏置,让我们的神经网络一开始就能够学习和泛化。

幸运的是,我们可以用一种有利于*改进*扩展的方式来表述它。**好的 harness,能把陌生问题归约为熟悉问题、把复杂问题归约为简单问题。** 换句话说,即使状态 $s$ 对任何单次语言模型调用的训练目标来说都是分布外(OOD)的,好的 harness 也能产出***局部在分布内*(locally in-distribution,LID)** 的观测 $o$——我们将其定义为:对该观测的每一次 LM 调用,都落在训练数据分布之内。

![**图 4.** 好的 harness 在设计上让每次 LM 调用看到的 prompt,都与其训练所学的内容局部「同分布」,哪怕完整任务轨迹本身是分布外(OOD)的。](/images/distilled/lm-harness-compositional/fig3_locally_in_distribution.png)

遗憾的是,Claude Code、Codex 这类现有 harness 设计,并不能为底层神经网络提供局部在分布内(LID)的观测。它们从根本上依赖于把任务相关信息、工具调用输出和推理过程不断追加、交错地灌进 Transformer 的上下文窗口。没错,这给模型提供了充足的上下文,但这些臃肿的历史很快就会掉出训练分布,表现为我们在实践中经常观察到的「[上下文腐烂](https://www.trychroma.com/research/context-rot)」(context rot)现象。

我们则提出:好的 harness 应该**让单次 LM 调用能把结构相似的任务视为同构**,从而实现组合式泛化。形式化地说,harness 在全部任务状态的集合 $\mathcal{T}$ 上诱导出一个等价算子 $\sim_{H}$:结构相似的任务落入同一个 harness 诱导的等价类,并为神经网络产生相似的观测集合。对于大多数「主 LM + 子代理」结构的 harness,只要假设子代理处理的是小的、各自在分布内的子任务,我们就可以仅就主上下文来理解这个论证。

好的 harness 在任务之上诱导出等价类,从而实现更好、更可组合的学习。设计良好的 harness,不仅把可学习轨迹的空间压缩到很小的 $\mathcal{T} / \sim_{H}$,还能泛化到比可用训练任务更广的一类轨迹上——包括那些放不进基座模型上下文窗口的轨迹。

## RLM 惊人地擅长组合式泛化

### RLM harness 诱导的轨迹等价类

理想的 harness 对任务的分解,会让主上下文对相似问题(即落入同一个 harness 诱导等价类 $[\tau^\prime] = \lbrace\tau \in \mathcal{T} : \tau^\prime \sim \tau\rbrace$ 的问题)**逐 token 地**看起来相似。这种同构使如下形式的泛化成为可能:*如果系统能解决任务 X,它应当能传递地解决任务 Y。*

![**图 5.** 我们对比了 RLM 的两个主要组件——上下文卸载与程序化子代理调用——如何让根 LM 把两个不同的问题看作相同/相似。**(1)** 标准 agent 方法把整个 query 和上下文作为 prompt 前缀塞满:在两个不同任务之间,即使解法相同,这个前缀也会显著改变模型的输出分布;上下文卸载让相似问题看起来相同。**(2)** 标准 agent 方法使用工具调用,返回值直接进入主上下文;程序化子代理调用则允许中间计算与信息存放在 REPL 里,主上下文无需看到会改变其输出分布的任务特定信息。](/images/distilled/lm-harness-compositional/fig4_context_offloading_programmatic_subcalls.png)

递归语言模型(RLM)harness 的设计,围绕「按分解方式抽象任务、把输入特定的信息推迟到子调用」展开。从这个意义上说,RLM 把分解方式相似的问题视为同构——值得注意的是,这个论证可以递归成立:每个被卸载的子代理都可以被看作拥有自己「主」上下文的独立实例(这正是 RLM「递归」的本意,尽管它并非维持局部在分布内观测的必要条件)。它通过两点实现:

**(1) 上下文卸载(context offloading)**:输入特定的上下文以符号变量的形式传入,根语言模型调用并不直接看到它,从而让不同问题在第一步就显得相似。最近,好几个脚手架也把这一特性作为上下文管理的一种形式(见 [Anthropic 的 Managed Agents 博客](https://www.anthropic.com/engineering/managed-agents))。但仅靠上下文卸载,并不能阻止环境反馈和/或子代理信息回流到主上下文;在长轨迹时程下,主上下文会变成 OOD,破坏 LID。

**(2) 程序化子代理调用(programmatic sub-agent calling)**:子代理(以及普通工具)被当作代码 REPL 中的函数,根 LM 可以选择性地取用信息、在后续工具调用和子代理之间传递信息,而根 LM 自己永远不必看到它们。这包括工具和子调用的输出——它们可以直接存入内存变量,供未来的子调用访问。在把任务特定信息从主上下文中抽象出去这件事上,程序化子调用与上下文卸载同等重要。

### RLM 可以只在短任务上训练,并泛化到更长的未见任务

众所周知,在某个领域、某个上下文长度上训练基于 Transformer 的 LM,并不必然能泛化到更长的上下文。在生产级模型(如 [Qwen 3.x](https://arxiv.org/abs/2505.09388)、[Kimi K2.x](https://arxiv.org/abs/2507.20534)、[GLM 5.x](https://arxiv.org/abs/2602.15763) 等)的中训练(mid-training)与后训练中,大量工作都致力于把越来越长的数据小心翼翼地混入训练,好让 LM 学会处理那些长度——而许多现代应用又常常超出那些长度。长度泛化问题对 [ReAct](https://arxiv.org/abs/2210.03629)、[CodeAct](https://arxiv.org/abs/2402.01030)、[Claude Code](https://code.claude.com/docs/en/overview)、[Codex](https://openai.com/codex/) 这类标准 agent 设计影响尤其严重,因为如前文所述,它们依赖于把观测不断追加到一个持续增长的上下文前缀里。

我们假设:对 RLM 而言,长度不同但相似的任务,可以落入 $\sim_{RLM}$ 的同一个等价类。在下面的实验中,我们探索只训练 RLM 的根 LM、且只用短序列,如何泛化到长一个数量级的序列——因为我们的假设是:两种设定下,RLM 根 LM 看到的分解(也即轨迹)几乎完全相同。

我们选取了 6 个沿不同长度轴变化的环境:输入长度、输出长度、指令数量各不相同。我们只在一个只含短任务的划分上训练,在一个只含显著更长任务的同领域划分上评估。以下所有设定都训练 150 步(batch size 64,每样本 4 个 rollout),使用 `prime-rl`([Decoupled PPO](https://verl.readthedocs.io/en/latest/algo/rollout_corr_math.html#decoupled-ppo-achieving-batch-size-invariance),GRPO 风格的优势函数 + KL 损失),每 10 步评估一次。

- [**MRCRv2**](https://github.com/google-deepmind/eval_hub/tree/master/eval_hub/mrcr_v2)(64k、2 针 → 2M、8 针设定)。前沿模型报告中常见的基准:在大规模对话语料中,找到第 $i$ 个能回答某个查询的「针」句。
- [**GraphWalks**](https://huggingface.co/datasets/openai/graphwalks)(\<128K → >1M 设定)。前沿模型报告中另一个常见基准:从图中抽取满足简单约束的节点。
- [**LongBenchPro**](https://arxiv.org/abs/2601.02872)(32k → 256k,仅英文)。涵盖 11 种 QA、代码与推理风格问题的选择题套件。
- [**OOLONG**](https://arxiv.org/abs/2511.02817) [trec-coarse](32k → 256k)。关于一个信息数据集的聚合式统计问题。
- [**OOLONG-Pairs**](https://arxiv.org/abs/2512.24601)(8k → 32k 输入,7k → 146k 输出)。OOLONG 的变体,要求找出满足特定约束的元素对。
- [**Ada-LEval**](https://arxiv.org/abs/2404.06480) [best-answer](8k → 128k)。给定问题和大量候选与干扰答案,选出最合适的一个。

我们同时绘制短任务上的训练奖励(半透明)和长任务版本上的评估奖励(深色),对比三组:RLM、提示分解策略的 RLM,以及基座 Transformer(长设定下加 YaRN)。所有设定都使用 [**Qwen3-30B-A3B-Instruct-2507**](https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507)。

![**图 6.** 在六个带长度划分的基准上,我们把 Qwen3-30B-A3B-Instruct-2507 分别作为「带分解提示的 RLM」「基础 RLM」和单独的 Transformer,在环境的短划分上训练;每 10 步在 8–32 倍长的划分上评估一次,绘制 150 步内的长任务评估分数与短任务训练奖励(平滑后)。我们还画了一个前沿模型 GPT-5.5 套 RLM harness 作为对照。MRCRv2 上的 Transformer 基线被省略,因为即使用上下文扩展也装不下 2M token。](/images/distilled/lm-harness-compositional/fig5_length_generalization_curves.png)

在全部六个任务上,只用短任务训练的 RLM 在长任务上取得了显著更好的评估结果;即使起点(第 0 步)评估更低,也以明显优势击败基座 Transformer。在 MRCRv2、GraphWalks、OOLONG 和 OOLONG-Pairs 上,训练后的 Qwen3-30B-A3B-Instruct-2507 RLM 在长任务评估上接近或超过搭载前沿模型 GPT-5.5 的 RLM,同时远超基座 Transformer。

**RLM 在长任务上的评估表现,与短任务上的训练奖励更为贴合。** 六个任务上,RLM 在长任务评估中相对第 0 步起点都有显著提升;而基座 Transformer 的评估表现基本持平——尽管它的训练奖励在增长、甚至经常超过 RLM 的训练奖励。这说明 *Transformer 学到的东西无法外推到更长的设定*。

**长度泛化为何发生、又在哪里失效。** 上述所有环境中,RLM 学到的解短任务的策略,与解长任务所需的策略大致等价;而由于上下文被卸载,根 LM 看到的长任务与短任务几乎逐 token 相同,RLM 相当于在训练中见过同一个任务。换句话说,许多任务跨长度共享同一个等价类,主要差别只在子调用的数量和内容——而每个子调用处理的都是一个在分布内的子任务。长度泛化发生的前提是 RLM 学到了可泛化的策略,*但这并不总有保证*:在上述不少短设定中,一个可行的「偷懒」策略是把整个问题卸载给一个子调用并直接返回——这就退化成了长上下文 Transformer 基线。

我们加入「提示分解」的用户消息变体([RLM 仓库附录](https://github.com/alexzhang13/rlm/blob/main/rlm/utils/prompts.py#L147)的浓缩版)来说明这一点:在 MRCRv2 上它就有帮助,因为那里的 RLM 没有学到跨长度可泛化的正确策略。在 RLM 乃至整个局部在分布内 LM 系统的训练中,一个完整的研究方向就是:需要多少监督/蒸馏,才能让系统收敛到可泛化解而非不可泛化解。我们的直觉是,在足够大的规模下不需要监督;但为了样本效率,[某种形式的监督或提示是有帮助的](https://noahziems.com/pedagogical-rl)。

### RLM 可以泛化到与训练任务共享潜在结构的未见任务

上一节表明,RLM 能学会把任务及其长度外推变体视为同构——在根模型层面把它们抽象成同一个任务。特别是对长度外推,只要 RLM 学到与长度无关的策略,就能很快泛化到更长长度。我们可以把这个直觉推广到「共享分解方式」的任务上:如果 RLM 学到的策略能从一个领域迁移到另一个领域(比如排序、过滤搜索、MapReduce 等),它同样可以抽象掉领域特定的 token,把两个问题视为等价。

我们考虑了 3 组设定:上下文与问题指向完全不同的领域,但底层策略大致相同。

- **OOLONG(TREC 粗分类问题 → 垃圾邮件问题)**:在关于 Jeopardy TREC 问题的聚合任务上训练,在「答案为 SPAM 或 HAM」的聚合任务上评估。
- **OBLIQ-Bench 类比(写作 → 数学)**:在「寻找疑似同一作者所写的文章」任务上训练,在「寻找需要相同推理过程的数学题」任务上评估。训练与评估指标均为 nDCG@10。
- **OBLIQ-Bench 描述(Twitter 立场 → Wildchat 错误)**:在「寻找满足特定立场的推文」任务上训练,在「寻找包含错误的 Wildchat 对话」任务上评估。训练与评估指标均为 nDCG@10。

![**图 7.** 在三个基准上,我们把 Qwen3-30B-A3B-Instruct-2507 分别作为 RLM 和单独的 Transformer,在一个领域环境上训练;每 20 步在另一个领域的划分上评估一次,绘制 500 步内的评估分数与训练奖励(平滑后)。](/images/distilled/lm-harness-compositional/fig6_strategy_generalization_curves.png)

我们同样发现:RLM 在与训练领域**完全不同的领域**上展现出清晰的泛化能力,而基座 Transformer 难以取得有意义的提升。与长度泛化实验类似,基座 Transformer 训练初期在 OBLIQ-Bench 上的评估提升,主要来自学会遵循正确的答案格式,而且很快就到头了。有意思的是,*基座 Transformer 的训练奖励普遍高于 RLM,但评估表现却被明显拉开*;相反,RLM 的训练奖励与评估奖励的趋势紧密贴合——尽管评估来自完全不同的领域。

比长度泛化更进一步的是,这些实验的训练与测试之间,token 分布完全不同——主要的相似性在于模型必须学会利用的潜在任务结构。与长度泛化的结果一样,这些结果表明:Transformer 的内部机制难以把任务分解成可泛化的可组合模式。

**关于训练 RLM 这类 harness 的成本。** 在相同规模的任务上,RLM 比直接训练 Transformer 有额外的运行时与内存开销:在长度与策略两组泛化实验中,由于每个样本要多步执行、还要等待子调用,RLM 的训练耗时是基座 Transformer 的 1.5–3 倍。但这个成本随任务复杂度的增长表现良好——在更长上下文/时程的任务上训练 Transformer 要昂贵得多;对一个 30B 模型来说,即使用 8xH100,在上述任务上训练一个简单的 ReAct agent 都很困难,因为上下文会膨胀。

### 未见的 RLM 任务轨迹与训练轨迹有多接近?

要刻画一个 prompt $x$ 是否对语言模型「在分布内」相当困难,但可以用基准表现作为代理——比如 LM 能解大多数 AIME 题,我们就认为这些任务「在分布内」。而 agent 轨迹往往很长、多轮、还夹杂着工具调用和 harness token 等杂质,要判定两条轨迹是否会表现出相同的输出分布行为就更难了。

如果 RLM 在未见任务上产生的轨迹,与训练任务中产生的某条轨迹*逐 token* 相同,那我们很容易论证这两个任务在 $\sim_{RLM}$ 下属于同一等价类、被视为同构。遗憾的是,即使是一个 token 的微小扰动,也可能在语义上改变一段文本的含义,所以要论证 $P_x$ 与 $P_{x^\prime}$ 之间存在某种有界差异是困难的。在**附录**中,我们讨论了判定两条轨迹是否属于同一等价类的几种代理方法;下面则给出一些来自实验的、与不同任务上某条训练轨迹相似的评估轨迹示例。

**注记。** 理想行为是:根 LM 学会抽象掉领域信息、隔离任务中可分解的行为,同时把领域特定信息推迟到子调用。在很多情况下,RLM 仍然会选择把任务特定信息打印出来、传回主上下文。从泛化角度看,这种行为通常不可取(而且如果小心处理,大概率可以训练掉),但我们仍然发现:在所有实验中,RLM 在评估时使用的策略都与训练中学到的策略高度相似——既包括通用的程序化子代理调用策略(如分块、扇出子调用),也包括一般的程序化策略(如 `regex` 调用)。

### 扩展的图景与下一步

看到这些有力的早期结果,人们很容易得出结论:我们都应该去捣鼓 harness 设计,或者把问题特定的直觉强加到 MapReduce、动态规划这类过度结构化的程序化策略上。但别误会——那样做,我们必然撞上「苦涩的教训」,不出几个月就会被甩在路边。

我们提出的是一个不同的论点。**扩展数据仍将是进步的最大驱动,但我们把数据喂进去的那套机器、以及它的归纳偏置,将决定这次扩展的系数。** 而站在今天看,Transformer 及相关神经架构在「不擅长组合式泛化」这点上的回报,就是怎么扩都扩不动。我们认为,这是因为它们以可微神经算子为主的狭窄设计空间,缺失了某种根本性的东西。

但好在有了语言这个强大的基底——过去几年我们已经能够在其上大规模训练——我们 AI 系统的架构不再局限于简单的可微算子或低级的几何归纳偏置。现在,我们可以编码更高层、更符号化的归纳偏置,并用 RL 端到端地训练系统;本文已经表明:通过上下文卸载与程序化子代理,RLM 架构在跨长度、跨领域的泛化上可以远优于普通的 Transformer。而这一切的核心,是 harness 设计中一个极其简单但重要的想法:确保这些系统能学会把复杂问题,归约成一串各自独立、局部在分布内的观测。

简言之,更好的扩展回报需要组合式泛化;而组合式泛化的能力,看起来在很大程度上必须住在今天所谓 harness 的地方——不过在未来,它可能会与我们眼中前沿 AI 系统的「基础架构」严重地融为一体。

### 附录

回顾一下:我们想刻画的是,harness 在未见任务上的轨迹与训练中学到的轨迹有多接近。两条 LM 轨迹逐 token 相同是很少见的;但如果我们对 LM 这个关于输入的函数做一些粗略的平滑性假设,真正关心的问题就是:在某种度量下,两条轨迹是否足够接近,以至于它们的输出分布几乎相同。

要把上述问题形式化成有实证意义的形式非常困难:我们需要知道 LM 所定义函数的某些性质、输入 prompt 上某个 $\delta$ 球内的距离度量,以及输出 logits 上某个 $\epsilon$ 球内的距离度量。作为起步,我们关心的是:对某个距离度量 $d(\cdot,\cdot)$,RLM 在评估与训练时根 LM 轨迹之间的差异。这里可以粗略地把「同构」定义为两个 prompt 的距离小于 $\epsilon$——不过如前所述,这个话题还需要更严格的处理。一般来说,我们想弄清楚的是:在这个度量下,评估 rollout 与*最接近的*训练配对的平均距离是多少?换句话说,在训练步 $t$,对轨迹 $x$、评估样本集 $\mathcal{E}_t$ 以及此前出现过的训练样本集 $\mathcal{T}_{\leq t}$,我们计算(记号上略有滥用):

$$\frac{1}{\lvert\mathcal{E}_t\rvert}\sum_{x\in\mathcal{E}_t}\ \min_{x^\prime\in\mathcal{T}_{\leq t}} d(x, x^\prime)$$

我们绘制相似度(即 $1 - d(\cdot,\cdot)$):最优的 RLM 与基座 Transformer 检查点,其平均评估 rollout 与此前任意训练轨迹的相似度。考虑以下距离度量:

| 图例 | 度量 | 距离定义 $d(x_{\text{train}}, x_{\text{eval}})$ |
|---|---|---|
| **Edit** | token 级、长度归一化的 Levenshtein 距离 | 令 $\mathrm{Lev}(\cdot,\cdot)$ 为 token 级 Levenshtein 距离,定义归一化相似度 $\mathrm{LevSim}(a,b)=1-\dfrac{\mathrm{Lev}(a,b)}{\max(\lVert a\rVert,\lVert b\rVert)}$,则 $d(a,b)=1-\mathrm{LevSim}(a,b)=\dfrac{\mathrm{Lev}(a,b)}{\max(\lVert a\rVert,\lVert b\rVert)}$ |
| **Contain** | 词级 3-gram 包含率 | 令 $N_3(x)$ 为 $x$ 中词级 3-gram 的多重集,则(非对称):$d(x_{\text{train}},x_{\text{eval}})=1-\frac{\lvert N_3(x_{\text{eval}})\cap N_3(x_{\text{train}})\rvert}{\lvert N_3(x_{\text{eval}})\rvert}$ |
| **Jaccard** | 3-gram Jaccard | $d(x_{\text{train}},x_{\text{eval}})=1-\frac{\lvert N_3(x_{\text{eval}})\cap N_3(x_{\text{train}})\rvert}{\lvert N_3(x_{\text{eval}})\cup N_3(x_{\text{train}})\rvert}$ |
| **Weighted Jaccard** | 加权 Jaccard | 令 $c_x(t)$ 为类型 $t$ 在 $x$ 中的 token(或 n-gram)计数,则 $d(x_{\text{train}},x_{\text{eval}})=1-\frac{\sum_t \min\!\big(c_{x_{\text{train}}}(t),c_{x_{\text{eval}}}(t)\big)}{\sum_t \max\!\big(c_{x_{\text{train}}}(t),c_{x_{\text{eval}}}(t)\big)}$ |
| **Length** | 长度比 | (与内容无关)设序列长度为 $\lVert x\rVert$:$d(x_{\text{train}},x_{\text{eval}})=1-\frac{\min(\lVert x_{\text{train}}\rVert,\lVert x_{\text{eval}}\rVert)}{\max(\lVert x_{\text{train}}\rVert,\lVert x_{\text{eval}}\rVert)}$ |

![**图 8.** 在 5/6 个包含基座 Transformer 的长度泛化实验和 3 个策略泛化实验中,我们绘制最优训练检查点的评估轨迹,与此前见过的最近一条训练轨迹之间的平均距离。我们用 5 种距离度量作图,凸显 RLM 在未见任务上的轨迹,比基座 Transformer 这种「上下文追加」基线接近训练轨迹多少。](/images/distilled/lm-harness-compositional/fig7_trajectory_similarity.png)

图 8 说明了一个总体结论:根 LM 的轨迹与训练中见过的轨迹更相似,这主要来自上下文卸载。不过,上面的图并不能完全捕捉这些轨迹之间的语义相似性(比如,它无法说明 RLM 是否总体上选择了与训练轨迹相同的分解策略)。

更有原则的距离度量应该同时考虑 token 相似性与语义相似性;但至少从这些代理度量可以清楚地看出:即使跨越更长的时间跨度,RLM 各次 LM 调用所看到的内容,也比普通基座 LM 调用更接近训练中可能看到的内容。

### 致谢

特别感谢 Braden Hancock 与 Laude Institute 通过 Laude Slingshots 计划,在短时间内慷慨提供了数台 8xH100 节点来跑这些实验。Alex 感谢他在 MIT OASYS 的优秀 labmates 以及 Noah Ziems 在博客写作过程中的有益反馈。
