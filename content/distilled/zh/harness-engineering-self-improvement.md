---
title: "面向自我改进的 Harness Engineering"
date: "2026-07-04"
description: "Lilian Weng 关于 Harness Engineering 的研究综述:Harness 设计模式(工作流自动化、文件系统持久记忆、sub-agent)、上下文与工作流优化,以及自我改进与进化式程序搜索。"
tags: ["LLM", "Agent"]
source:
  name: "Lil' Log"
  url: "https://lilianweng.github.io/posts/2026-07-04-harness/"
  author: "Lilian Weng"
---

> 本文转载自 [Lil' Log](https://lilianweng.github.io/),原文 [Harness Engineering for Self-Improvement](https://lilianweng.github.io/posts/2026-07-04-harness/),作者 Lilian Weng,首发于 2026-07-04。此处为中文翻译,仅供学习交流。

**递归式自我改进（recursive self-improvement，RSI）**这一概念可以追溯到 [I. J. Good（1965）](https://philpapers.org/rec/GOOSCT)。他将“超智能机器（ultraintelligent machine）”定义为一种能在所有智力活动中超越人类、并能设计出更好的机器来改进自身的系统。[Yudkowsky（2008）](https://www.lesswrong.com/posts/JBadX7rwdcRFzGuju/recursive-self-improvement)用“递归式自我改进”来指称一种特定的反馈回路：AI 利用当前的智能去改进产生其智能的认知机制。

在现代 AI 中，这一反馈回路可以指模型直接重写自己的权重；更广义地说，也可以指模型改进*训练流水线（training pipeline）*和*部署系统（deployment system）*，而后者又促成性能更强的后继模型，使其在具有经济价值的各类任务上取得更好的表现。已有迹象表明，前沿实验室中的 AI 研究开发速度已显著加快（[Anthropic](https://www.anthropic.com/institute/recursive-self-improvement)；[OpenAI](https://openai.com/index/how-agents-are-transforming-work/)）。

我特意提到*“部署系统”*，因为原始模型与真实世界上下文之间的这一层，似乎与模型的原始智能同等重要（这里的原始智能指预训练完成后立即进行的评测所反映的能力）。Claude Code 和 Codex 等成功的 coding agent 产品已经说明，Harness 是 AI 部署的重要组成部分。所谓 **Harness**，是指围绕基础模型搭建的一套系统：它负责编排执行，并决定模型如何思考与规划、如何调用工具与采取行动、如何感知和管理上下文、如何保存产物，以及如何评估结果。

本文将聚焦于 Harness Engineering 相关研究，以及它如何推动 RSI。近期有关自动化研究（auto-research）、自我改进 agent 和进化式程序搜索（evolutionary program search）的许多工作，都可以围绕这个问题来理解。模型自博弈（self-play）、合成数据（synthetic data）、测试时训练（test-time training），以及更广泛的持续学习（continual learning）主题，也符合 RSI 的愿景（例如 [Yuan et al. 2024](https://arxiv.org/abs/2401.10020)、[Chen et al. 2024](https://arxiv.org/abs/2401.01335)、[Zhao et al. 2025](https://arxiv.org/abs/2505.03335)、[Choi et al. 2026](https://openreview.net/forum?id=lTbBFAoPSA)），但它们不是本文的重点。

## Harness 设计模式

早期的 [agent 框架](https://lilianweng.github.io/posts/2023-06-23-agent/)通常可概括为“agent = LLM + memory + tools + planning + action”。相比之下，Harness Engineering 还包括*工作流设计（例如循环工程，loop engineering）、评估、权限控制和持久状态管理*。它不再只是 prompt 模板，而是更接近 runtime 与软件系统设计：模型如何观察、行动、记忆、自检和改进。

设计应当有意识地保持简单和通用，以便实现泛化；同时可以借鉴既有的软件工程实践，从预训练知识中受益。操作系统与 Harness 之间也存在很强的类比关系。与 OS 相似，Harness 应封装复杂逻辑，同时保持接口简单。与此同时，配置、工具接口及其他协议可能会逐渐在整个行业中实现标准化。

### 模式 1：工作流自动化

定义一种让模型可以在其中操作、测试和迭代的工作流，是实现自动化的关键设计。Karpathy 的 autoresearch 仓库（https://github.com/karpathy/autoresearch）清晰展示了如何构建这样的工作流。一种常见工作流会遵循目标导向的循环：规划、执行、观察/测试、改进，然后再次执行，*直到*目标达成为止。过程中，系统可能会主动请求用户进一步澄清任务要求或执行偏好。

![简化的 Codex agent 循环：agent 调用工具，而工具响应会影响模型的下一次生成。](/images/harness/openai-agent-loop.png)

*简化的 Codex agent 循环：agent 调用工具，而工具响应会影响模型的下一次生成。图片来源：[OpenAI Codex agent 文章](https://openai.com/index/unrolling-the-codex-agent-loop/)。*

工作流图也强调：模型会分析自己的轨迹和失败案例，随后通过“agent runtime”不断推进和迭代，而非依赖静态的 prompt 模板。

### 模式 2：以文件系统作为持久记忆

在长时程 agent 系统中，一个反复出现的模式是：用简单的控制方式管理丰富的状态和产物。Harness 不应把整个工作流和所有日志都放在上下文中，而应将持久状态保存在文件里。在长时程 agent rollout 中，实验日志、代码 diff、论文摘要、错误 trace 和过往 rollout 轨迹等产物，往往会增长到远超模型训练时上下文窗口的长度。

学习如何读取、写入和编辑文件系统（通常通过 `bash` 命令）是 LLM 的基础能力。因此，以简单文件形式管理持久记忆，天然可以从核心模型能力的提升中受益。

### 模式 3：Sub-agent 与后端任务

Harness 可以生成多个 sub-agent 并行执行，并监控后端任务。当主 agent 需要探索多个假设、并发运行实验，或在不污染主上下文的情况下委派相互隔离的子任务时，这一能力很有用。父 agent 随后需要一个小型进程管理器，用于启动任务、检查日志、取消失败的运行，并将结果合并回主 agent 线程。

关键设计选择，是让并行过程保持显式且可检查。如果 sub-agent 的输出只存在于临时的对话上下文中，它们很快就会过时并被隐藏。如果这些输出保存为文件、日志和状态记录，模型就能在中断后恢复，并基于自己的执行历史进行推理。

### 案例研究：Coding Agent Harness

Claude Code、Codex、OpenCode 和 Cursor 风格 agent 等主流 coding agent 的核心接口已经趋于稳定。它们通常采用如下循环：

![Coding Agent Harness 循环](/images/harness/coding-harness-loop.png)

有了一组工具可供使用，coding agent 就能在给定仓库中开发代码并排查问题，类似于人类开发者配备 IDE 后的工作方式。

（下表并非完整清单，仅用于示范。如有兴趣，可阅读[此处](https://github.com/yasasbanukaofficial/claude-code)。）

| 类别 | 工具定义 |
| --- | --- |
| 文件系统 | 文件发现：`glob`、`grep`、`ls`<br />文件读取：`read`、`read_many`<br />文件修改：`write`（写入一个全新文件）；`edit`（精确匹配字符串并替换）；`multi_edit`；`apply_patch`（应用结构化 patch/diff） |
| Shell 执行 | 运行命令：`bash`、`PowerShell` |
| IO | `lsp`，以及 `git_status`、`git_diff`、`git_commit` 等 git 工具 |
| 外部上下文 | MCP 工具、Skills |
| Web 搜索 | `web_search`、`web_fetch`、浏览器工具 |
| 产物 | 读取文档、图片；生成 HTML、图片 |
| 后端进程 | 例如：`CronCreate`、`CronDelete`、`CronList` |
| Agent 委派 | 例如：`spawn_agent`、`resume_agent`、`wait_agent`、`list_agents`、`close_agent`、`interrupt_agent` 等 |

### Harness 层与核心智能？

未来的 RSI 会在多大程度上依赖 Harness Engineering，很难预测；但 RSI 的近期发展路径不太可能从模型直接重写自身权重开始。我对一条切实可行的近期路径的预测是：

1. Harness Engineering 将朝元方法论（meta-methodology）的方向发展（即改进获得更好答案的机制，而不只是改进答案本身）。Harness 系统自身会成为优化目标，其中的启发式规则更少，通用机制更多。
2. 反过来，成熟的 Harness 能够支持模型自我改进循环中的自动化研究；而更智能的模型则能防止 Harness 被过度设计，并维持系统的可持续性。

最终，许多 Harness 改进可能会被*内化*为核心模型行为，但与外部上下文和工具交互的接口应当继续存在。我们已经在 [prompt engineering](https://lilianweng.github.io/posts/2023-03-15-prompt-engineering/) 中看到过这种模式的温和版本：随着指令微调和模型推理能力提升，手工设计 prompt 的技巧不再那么核心，但*明确目标、约束、上下文和评估的需求并未消失*。

## Harness 优化

Harness 系统中被优化对象的演进路径大致是：指令 [prompt](https://lilianweng.github.io/posts/2023-03-15-prompt-engineering/) → 结构化 context → workflow → harness 代码 → optimizer 代码。随着模型变得更智能、能力更强，我们会转向更复杂的优化目标和更通用的方法。

### Context Engineering

随着 agentic 任务的时间跨度显著增加，如果只是把所有工具响应和模型生成内容不断追加到 context 中，其规模很快就会失控。Context management 是这样一层机制：为 LLM 构建结构更清晰、更简洁的 context，并管理持久状态。毫无疑问，long-context 研究还会继续进步，但就目前而言，long-context intelligence 与 context engineering 有时会交织在一起。

**Agentic Context Engineering**（ACE；[Zhang et al. 2025](https://arxiv.org/abs/2510.04618)）不把 context 视为一个不断变长的 prompt，而是把它看作一份持续演化的行动手册。它包含三个组件，共同维护一份由要点组成的 context 手册；每条要点都有一个标识符和一段描述。

1. *Generator*：生成任务轨迹，并引用相关要点。
2. *Reflector*：从成功和失败的轨迹中提炼洞见。
3. *Curator*：以增量、条目化的方式更新结构化 context。

![Agentic Context Engineering（ACE）框架](/images/harness/ace.png)

*Agentic Context Engineering（ACE）框架。（图片来源：[Zhang et al. 2025](https://arxiv.org/abs/2510.04618)）*

为了防止迭代重写过程中出现 context collapse 和 brevity bias，ACE 的一项关键设计是：curator 不会重写完整的 prompt 文本块。相反，它会输出一组结构化、条目化的要点，每条采用（标识符，描述）的形式，再通过确定性逻辑把这些要点合并到结构化的 context 日志中。系统还会定期精炼 context 条目并去重。

ACE 能够从 rollout 中学习洞见，这有助于我们迈向自主管理的 memory；不过，它的更新规则和整体 workflow 仍然是手工设计的。为了走向更具自我改进能力的循环，**Meta Context Engineering**（MCE；[Ye et al. 2026](https://arxiv.org/abs/2601.21557)）将机制（如何管理 context）与产物内容（context 中包含什么）分离开来：在 meta-optimization 层执行 skill evolution，在 base level 执行 context optimization。

一个 MCE skill $s \in \mathcal{S}$ 定义 context function $c_s=(\rho_s,F_s)$，并将输入 $x$ 映射为 context $c = F_s(x;\rho_s)$，其中：

- $\rho_s = \{\rho_1,\dots,\rho_m\}$ 是静态组件（prompt、knowledge base、code library）。
- $F_s = \{F_1,\dots,F_k\}$ 是动态 operator（搜索、选择、过滤、格式化）。

这种双层优化要做的是：给定 skill $s$，在训练数据上找到最佳 context $c_s^*$；与此同时，外层循环寻找能在验证集上取得最佳表现的最优 skill：

$$
\text{Inner: }c_s^*=\arg\max_{c_s}J_\text{train}(c_s;s)\quad \text{Outer: }s^*=\arg\max_{s\in\mathcal{S}}J_\text{val}(c_s^*)
$$

skill 数据库会记录此前 skill、context function 和 eval metric 的历史：$\mathcal{H}_{k-1} = \{(s_i,c_i,J_i^\text{train}, J_i^\text{val})\}_{i=1}^{k-1}$。一个 meta-level agent 会对既有 skill 执行 agentic [crossover](https://en.wikipedia.org/wiki/Crossover_(evolutionary_algorithm))，针对任务 $\tau$ 创建一个新 skill：$s_k=\text{crossover}(\tau,\mathcal{H}_{k-1})$。

随后，base-level context engineer 执行 skill $s_k$，在当前 skill 的指导下，从 rollout feedback $\mathcal{R}_k$ 中学习 context function：$c_k=\text{engineer}(\tau,s_k;c_{k-1}^*,\mathcal{R}_k)$。

![Meta Context Engineering（MCE）框架](/images/harness/mce.png)

*Meta Context Engineering（MCE）框架：meta-level skill evolution 在各种 context management 机制中进行搜索，而 base level 则优化任务 context。（图片来源：[Ye et al. 2026](https://arxiv.org/abs/2601.21557)）*

MCE 不像 ACE 那样通过启发式规则来约束 context 的结构。它使用 *free-form skill* 存储对任务最重要的知识，并让 skill 与以该 skill 为条件的 context 共同迭代演化。在实现上，一个 context function $c$ 会被实例化为专用目录中的一组文件，同时包含静态组件（`skill.md`）和动态组件（context 与 data rollout）。meta-level 和 base-level 优化都在配有标准工具集的 agentic coding environment 中执行：

$$
\mathcal{T}=\{\texttt{Read},\texttt{Write},\texttt{Edit},\texttt{Bash},\texttt{Glob},\texttt{Grep},\texttt{TodoWrite}\}
$$

**Meta-Harness**（[Lee et al. 2026](https://arxiv.org/abs/2603.28052)）又向更深一层推进：被优化的对象是决定并优化“哪些信息应被存储、检索并呈现给模型”的*代码*。名称中的“Meta-”表示，它是一个用来优化 harness 的 harness。

![Meta-Harness 外层循环优化算法](/images/harness/meta-harness-outer-loop.png)

*Meta-Harness 的 outer-loop 优化算法。（图片来源：[Lee et al. 2026](https://arxiv.org/abs/2603.28052)）*

负责创建新 harness 的 proposer 本身就是一个 coding agent，最终输出则是位于 Pareto frontier 上的一组 harness candidate。

- 完整的执行历史都可以通过文件系统访问，因此 coding agent 会使用 `grep` 或 `cat` 等命令读取历史，而不是把所有内容一股脑塞进单个 prompt context。
- 每个候选 harness 都是文件系统中的一个目录，其中包含自身的源代码、分数、rollout trajectory 和状态更新。
- meta-harness 循环会迭代创建新的 harness，并且只保留达到标准的候选项。

![Meta-Harness 在文本分类和 TerminalBench-2 上的表现](/images/harness/meta-harness.png)

*Meta-Harness 在（左）少量迭代的文本分类任务和（右）TerminalBench-2 上的表现。需要注意的是，TerminalBench-2 实验中的搜索以 Terminus-KIRA 和 Terminus-2 为初始点，这两个 harness 的能力都非常强。（图片来源：[Lee et al. 2026](https://arxiv.org/abs/2603.28052)）*

尽管如此，重要的结论已经很清楚：一旦 harness design 成为可执行的搜索空间，强大的 coding agent 就能利用人类工程师所使用的同一个设计空间。

### Workflow Design

在 harness engineering 中，workflow design 可以由领域专家手工完成。以自动化研究为例，人们已经提出并测试了多种框架。**AI Scientist** 系统（[Lu et al. 2026](https://www.nature.com/articles/s41586-026-10265-5)）构建了一条完整 pipeline，用于提出研究想法、编写代码、运行实验、分析结果、撰写论文并进行同行评审。[Meng et al. (2026)](https://arxiv.org/abs/2605.26340) 则在 **ScientistOne** 中把可验证性设为核心设计约束：每一项主张（引用、数值、方法和结论）都必须能够追溯到证据来源，并通过 Chain-of-Evidence 检查接受审计。

![AI Scientist pipeline](/images/harness/ai-scientist.png)

*AI Scientist 用于想法生成、实验、论文写作和评审的 pipeline。（图片来源：[Lu et al. 2026](https://www.nature.com/articles/s41586-026-10265-5)）*

**Autodata** agent（[Kulikov et al. 2026](https://arxiv.org/abs/2606.25996)）被设计成一名 data scientist，用于生成训练和评估数据。主 agent 管理一个负责提出问题的 *challenger*、一个 *weak solver*、一个 *strong solver* 以及一个 *verifier/judge*，目标是合成难度“恰到好处”的数据，也就是 strong solver 能成功解决，而 weak solver 会失败的数据。

在 Autodata 中，challenger prompt 会根据 solver 和 verifier 的反馈迭代更新。这里的局限在于，合成任务会用于 fine-tune weak solver，却不会用于 fine-tune strong solver；如果这个循环无法迭代提升 strong model，那么它更像是在生成的 prompt distribution 上进行间接 distillation，RSI 的意味会弱一些。

![Autodata agentic workflow](/images/harness/autodata.png)

*Autodata 的 agentic workflow design：围绕 challenger、solver 和 verifier 三类角色生成合成训练与评估数据。（图片来源：[Kulikov et al. 2026](https://arxiv.org/abs/2606.25996)）*

workflow 的设计空间*极其庞大*。很自然地，我们可以把 workflow design 视为一个搜索问题，因此应当能够通过算法找到优秀解，而不只依靠手工设计。沿着这个方向，**Automated Design of Agentic Systems**（ADAS；[Hu et al. 2025](https://arxiv.org/abs/2408.08435)）把 agent design 本身表述为一个优化问题，即“meta-agent search”：由一个 meta-agent 提出新的 agentic workflow design。

1. 用 CoT、self-refine 等简单 agent 初始化一个 agentic workflow archive。
2. 让 meta-agent 从 archive 中的既有方案获取启发，以*代码*形式编写新的 agent。
   - meta-agent 首先生成新 workflow 的 high-level description，然后用代码实现它。
   - 接着，这个 draft program 会由 meta-agent 执行两轮 self-refine（即先让模型提供反馈，再让同一个模型根据反馈改进此前生成的输出；[Madaan et al. 2023](https://arxiv.org/abs/2303.17651)），以检查其新颖性。
3. 评估每个新 candidate，并把成功的 candidate 加回 archive。
4. 重复第 2—3 步，直到达到最大迭代次数。

![Automated Design of Agentic Systems（ADAS）示意图](/images/harness/adas.png)

*Automated Design of Agentic Systems（ADAS）示意图。（图片来源：[Hu et al. 2025](https://arxiv.org/abs/2408.08435)）*

**AFlow**（[Zhang et al. 2025](https://arxiv.org/abs/2410.10762)）把 agentic workflow 表示为一个图，其中节点表示调用 LLM 的 action，边则在代码中实现逻辑操作。workflow 优化依赖 [MCTS](https://en.wikipedia.org/wiki/Monte_Carlo_tree_search)（Monte Carlo Tree Search）：

1. 使用模板在搜索树中初始化起始 workflow $W_0$。
2. 通过对分数与均匀探索进行 soft mixture，选择一个 workflow 节点。
3. 让 LLM 根据该 workflow 的评估表现生成修改后的 workflow，从而扩展这个节点。
4. 执行并评估新的 workflow。
5. 如果新 workflow 在 $N$ 轮的预算内表现出提升，就把它加回搜索树。
6. 重复第 2—5 步；当 top-$k$ average score 进入平台期或预算耗尽时停止。

![AFlow 对 workflow candidate 搜索树的优化过程](/images/harness/aflow.png)

*AFlow 在 workflow candidate 搜索树上的优化过程。（图片来源：[Zhang et al. 2025](https://arxiv.org/abs/2410.10762)）*

AFlow 在问答、代码和数学任务上的实验显示，与人工设计的 workflow 和 ADAS 相比，AFlow 取得了不错的提升。

![AFlow 与人工方法及 ADAS 的实验对比](/images/harness/aflow-exp.png)

*AFlow 与人工方法及 ADAS 的实验对比。（图片来源：[Zhang et al. 2025](https://arxiv.org/abs/2410.10762)）*

### 自我改进的 Harness

无论是 context engineering 还是 workflow design，都只是 Harness 的一部分。我们需要搜索整个设计空间，同时优化 context-management logic、workflow、permissions 以及许多其他 Harness 组件。正如 Meta-Harness、ADAS 和 AFlow 等工作所展示的，**✨代码✨**是定义程序和系统的**通用语言**。简单来说，Harness 就是这样一种代码：它规定了 prompts、tool calls、subagents、control flow、memory 和 workflow logic 如何协同工作。如果 LLM 能够优化执行 Agent 的代码，它所能触及的设计空间就会比手写 prompts *大得多*。

**Self-Taught Optimizer**（STOP；[Zelikman et al. 2023](https://arxiv.org/abs/2310.02304)）是递归式 scaffold 改进的早期案例之一。在步骤 $t=0$ 时，一个初始改进器 $I_0$ 接收初始解 $s$、效用函数 $u$ 和黑盒语言模型 $M$，并返回一个改进后的解 $s’$，即 $s’ = I(u, s; M)$。STOP 的目标并不是直接改进 $s$，而是*改进改进器 $I$ 本身*。

首先，我们把 meta-utility 定义为：给定改进器函数 $I$ 在一组下游任务 $\mathcal{D}$ 上的平均效用：

$$
\hat{u}(I) \triangleq \frac{1}{\vert\mathcal{D}\vert}\mathbb{E}_{(u,s)\sim \mathcal{D}}[u(I(u,s; M))]
$$

由于改进改进器函数本身也是一个优化问题，我们可以根据 meta-utility 对 $I_{t-1}$ 性能的衡量，通过一次自我改进更新，递归地得到新版本的 $I_t$：

$$
I_t=I_{t-1}(\hat{u},I_{t-1};M)
$$

![Self-Taught Optimizer（STOP）算法](/images/harness/STOP-algo.png)

*Self-Taught Optimizer（STOP）算法。（图片来源：[Zelikman et al. 2023](https://arxiv.org/abs/2310.02304)）*

在实验中，改进后的改进器发现了多种策略，例如 genetic algorithms、分解并改进各个部分、multi-armed prompt bandits、simulated annealing、改变 temperature，以及 beam/tree search。这类似于把 Harness workflow 表示为一个可供优化的对象。

![STOP 发现的自我改进策略示例](/images/harness/STOP-patterns.png)

*STOP 发现的自我改进策略示例。（图片来源：[Zelikman et al. 2023](https://arxiv.org/abs/2310.02304)）*

Zelikman et al.（2023）的研究中有一个值得*警惕*的结果：使用 GPT-4 时，STOP 能够在多轮迭代中提高下游任务的平均性能；但使用 GPT-3.5 和 Mixtral 等能力较弱的模型时，性能反而下降。仅有递归结构并不够。基础模型必须*足够有能力*，才能改进这一机制。这意味着，Harness 的改进能够让模型得到更好的部署和使用，但 intelligence 仍然是核心。

[Lin et al.（2026）](https://arxiv.org/abs/2605.30621)更细致地研究了 Harness 演化对模型能力的依赖。他们拆分出两个维度：（1）*harness-updating*，指生成有用 Harness 修改的能力；（2）*harness-benefit*，指利用更新后的 Harness 来提高任务解决能力的能力。有趣的是，在他们的实验中，从 Qwen3.5-9B 到 Claude Opus 4.6，一系列规模和核心 intelligence 各异的模型表现出了近似的 harness-updating 能力；9B 的 Harness proposer/evolver 能够写出一种在程序结构上与 Opus 所写版本同构的 skill。若要充分利用 Harness，模型需要正确、及时地调用 skills/tools，并擅长 long-horizon instruction following。

![Harness 更新能力与 Harness 收益能力的主要实验结果](/images/harness/harness-update.png)

*主要结果：（A）从 Qwen2-32B 到 Opus 4.6，一系列模型测得的 harness-updating 能力基本持平；（B）harness-benefit 能力呈非单调变化，中等梯队的模型获益最大。（图片来源：[Lin et al. 2026](https://arxiv.org/abs/2605.30621)）*

更新近一些的工作 **Self-Harness**（[Zhang et al. 2026](https://arxiv.org/abs/2606.09498)）依靠 LLM Agent，通过 propose-evaluate-accept loop 来改进自身的 Harness。

![Self-Harness 的 Harness 更新循环](/images/harness/self-harness.png)

*Self-Harness 通过 weakness mining、受约束的 Harness proposal 和 validation 构成循环，以更新 Harness。（图片来源：[Zhang et al. 2026](https://arxiv.org/abs/2606.09498)）*

Self-Harness 的循环分为三个阶段：

1.  *Weakness mining*：将失败案例聚类为以 verifier 为依据的 failure patterns。
    - 使用当前 Harness $h_t$ 在任务上进行评估，并收集 execution traces 供分析。
    - 需要注意的是，两次运行在表面的错误日志中可能具有相同的 verifier 结果，例如 timeout 或 missing artifact，但背后的因果机制可能不同。因此，我们需要包含丰富信息的 failure record：其中应包含 verifier 层面的最终原因、相关 Agent 行为的因果状态，以及 trace 暴露出的抽象 Agent 机制，以便揭示根本原因。
2.  *Harness proposal*：根据挖掘出的 failure patterns，提出范围受限的 Harness 修改。
    - 在 $h_t$ 下调用同一个模型作为 proposer。
    - 提供给模型的是一个范围受限的 proposal context，包括：（1）当前 Harness 的 editable surfaces；（2）评估系统给出的、以 verifier 为依据的 failure patterns；（3）应当保留的成功行为记录；（4）此前尝试过的修改摘要。
    - Harness 修改应优先针对反复出现、能够处理（例如并非任务本身的特定难点），且可通过小范围变更解决的错误模式。
    - Harness 修改候选项之间应当具有明显差异并保持多样性。
3.  *Proposal validation*：验证并合并合格的修改，创建新的 Harness $h_{t+1}$。
    - 在 held-in $D_\text{in}$（用于检验弱点是否已解决）和 held-out $D_\text{out}$（用于检查是否引入其他未知问题）两个数据划分上，通过 regression tests 评估候选修改。
    - 候选修改只有在 held-in 和 held-out 数据上都没有出现 regression 时才会被接受。
    - 接受的候选项会被合并，以将 Harness 更新至 $h_{t+1}$；被拒绝的候选项会被记录下来，但不会改变当前生效的 Harness。

在 Terminal-Bench-2 上运行 `MiniMax M2.5`、`Qwen3.5-35B-A3B` 和 `GLM-5` 时，Self-Harness 能够学到针对不同基础模型、面向其不同弱点的模型特定 Harness instructions，并提高 held-out pass rates。

Self-Harness 这类工作确实让我担心：如果允许一个程序编辑 OS system，抽象边界就会被打破。editable surface 需要得到恰当设计，权限控制与安全层也必须位于这个循环之外。围绕 [reward hacking](https://lilianweng.github.io/posts/2024-11-28-reward-hacking/) 的所有挑战依然存在。

**Agentic Harness Engineering**（AHE；[Lin et al. 2026](https://arxiv.org/abs/2604.25850)）认为，Harness 演化的瓶颈集中在**可观测性（observability）**上：也就是说，当一次 rollout 失败时，我们需要知道究竟是哪一个组件应当负责，而且每一次修改都应以证据为依据。

该框架以三项可观测性支柱构成一个闭环：

1.  *Component observability*：每一个可编辑的 Harness 组件在文件系统中都有对应表示，从而让 action space 明确且可追踪。
    - 一个 Harness 包含 7 个组件：system prompt、tool description、tool implementation、middleware、skill、sub-agent configuration 和 long-term memory。
    - 每一种 failure pattern 都会映射到一个组件，使修改更有针对性。
2.  *Experience observability*：分析并汇总大量原始 trajectories，将其整理为具有层级结构的证据与 failure patterns。
    - 每个 Harness 生成 $k$ 条 traces。
    - 使用一个 Agent（“Agent debugger”）分析各自存储在单独文件中的 trajectories，并为每项任务生成一份分析报告，说明失败或成功的根本原因。
    - 所有任务级报告都会被汇总为一份 benchmark overview，供下一步使用；如有需要，也可以访问原始 traces。这种分层访问结构具有更高的 token 效率。
3.  *Decision observability*：每一次修改都伴随一项对下一轮结果的预测，以供验证。
    - 一个 Agent（“Evolve agent”）读取 repo，决定应修改哪个组件，然后生成修改及其背后的推理。
    - 每一次修改都是一项文件级、可证伪的主张，可以在下一轮中得到验证，并受以下两项约束：
      - \(1\) 修改只能应用于 Harness workspace。runs directory、tracer、verifier 和 LLM configuration 均为只读；这会禁用一系列 reward hacking 手段（例如关闭 verifier、替换模型或提高 reasoning budget），因而可以确保每一项被记录的性能提升都可归因于 Harness 修改。
      - \(2\) 修改必须由证据驱动，并附带一条变更声明，其中包括：failure evidence 的名称、推断出的根本原因、有针对性的修复，以及一项预测影响；预测影响同时包含预期修复的问题和存在 regression 风险的部分。

在 Terminal-Bench-2 上，除 Hard tier 外，AHE 的表现优于人工设计的 Harness（OpenCode、Terminus-2、Codex），也优于若干 self-evolve baseline（ACE、TF-GRPO）。在不进行进一步演化的情况下，同一个冻结的 Harness 还能迁移到 SWE-bench-verified，这说明演化后的 Harness 能够把工程经验编码进 Harness 组件中，而非仅仅针对特定 benchmark 进行优化。

### Evolutionary Search

Evolutionary search 是一种受 natural selection 启发的优化方法（参见我以前关于 [evolutionary algorithm](https://lilianweng.github.io/posts/2019-09-05-evolution-strategies/) 的文章）。它通过 mutation 演化一组候选解，并只保留其中 “fitness” 较高的候选项。当（1）search space 非常广阔或形状异常；且（2）难以直接使用 gradients 优化、但容易评估候选解时，Evolutionary search 会很有用。Harness 搜索看起来非常适合这种方法。

以往的研究已经把 Evolutionary search 用于 prompt engineering。**Promptbreeder**（[Fernando et al. 2023](https://arxiv.org/abs/2309.16797)）通过丰富的 mutation operations 来优化 task-specific prompts；有趣的是，mutation prompts（即指导 LLM 修改 task prompt 的指令）本身也会通过演化得到改进。**GEPA**（[Agrawal et al. 2025](https://arxiv.org/abs/2507.19457)）把基于 [reflection](https://lilianweng.github.io/posts/2023-06-23-agent/#self-reflection) 的 prompting 与 Evolutionary search 结合起来，并对反复试错形成的 trajectories 进行自然语言反思，以提出 prompt 更新。

[Novikov et al.（2025）](https://arxiv.org/abs/2506.13131)提出 **AlphaEvolve**，它是一套 coding-agent Evolutionary search 系统：系统保存一个候选程序池，并通过 prompting 让冻结的 LLM 生成用于改进的 diffs。随着系统反复评估子程序并保留成功者，它会逐渐发现更好的解。

![AlphaEvolve 的工作方式](/images/harness/alphaevolve.png)

*AlphaEvolve 的工作方式。（图片来源：[Novikov et al. 2025](https://arxiv.org/abs/2506.13131)）*

AlphaEvolve 的设计中有几项细节很重要：

- prompt 包含 parent programs、results、instructions，有时还包含 meta information。
- coding agent 可以访问整个 repo，但明确使用 `# EVOLVE-BLOCK-START` 和 `# EVOLVE-BLOCK-END` 标记需要改进的代码区域。
- Meta-prompt 会按照 LLM 的建议与 instructions 和 context 共同演化，其方式与演化 solution programs 类似。

消融实验显示了演化流程、prompts 中的 context、meta-prompts、full-file evolution 以及使用更强 LLM 的作用。

![AlphaEvolve 多项设计的消融实验](/images/harness/alphaevolve-plot.png)

*消融实验显示了 AlphaEvolve 中多项设计的价值。（图片来源：[Novikov et al. 2025](https://arxiv.org/abs/2506.13131)）*

最近出现的变体包括 **ThetaEvolve**（[Wang et al. 2025](https://arxiv.org/abs/2511.23473)），它把 Evolutionary search 与 RL 和 in-context learning 结合起来；以及 **DemoEvolve**（[Che, et al. 2026](https://arxiv.org/abs/2605.24539)），它向 self-rollout archive 中加入人类专家 demonstrations，将其作为 Harness 级 diagnosis 和 editing 的参考经验。另一方面，**ShinkaEvolve**（[Lange et al. 2025](https://arxiv.org/abs/2509.19349)）引入了三个新组件，以提高 LLM sampling efficiency：

- 设计 parent sampling，在 performance rank 与 offspring count 之间取得平衡，从而以更高的 sample efficiency 进行探索。
- 基于 embedding 的 cosine similarity，丢弃与现有 population 过于相似的候选项，从而执行 code-novelty rejection sampling。
- 在 meta-scratchpad 中识别成功解里的良好模式，用来指导后续 mutation。

与上述聚焦于 solution improvement 的方法不同，**Darwin Gödel Machine**（DGM；[Zhang et al. 2025](https://arxiv.org/abs/2505.22954)）明确把一个可编辑 Harness-code repo 的演化作为目标，并使用基于 LLM 的 coding agent。准确地说，该 Agent 可以修改自己的 Harness。后续关于 Hyperagents 的工作（[Zhang et al. 2026](https://arxiv.org/abs/2603.19461)）引入了一个 meta-agent，用于控制如何修改现有 task agents 来创建新的 Agent。

1.  从池中的一个 coding agent 开始。
2.  每轮迭代中，选择一个 parent；它被选中的概率与其性能成正比、与其已有 children 的数量成反比。随后修改这个 parent，并从中创建分支，以生成新的 Agent。
3.  被选中的 parent agent 检查自己的 benchmark evaluation log，然后提出对自身 Harness codebase 的改进，生成新版本的 coding agent。代码编辑通过两个基本工具实现：（1）bash（参数：`<bash_command>`）；（2）editor（参数：`view/create/edit <file_path>`）。
4.  对新的 coding agents 进行评估，只有性能足够高的 Agent 才会被重新加入池中。
5.  重复步骤 2–4，直到满足某项停止条件。

DGM 是固定模型条件下的 Harness 演化。在以 `Claude 3.5 Sonnet` 为基础 LLM、初始 Harness configs 较为简单的实验中，DGM 发现的 Agent 在 SWE-bench Verified（20% 提高到 50%）和 Polyglot（14.2% 提高到 30.7%）上，能够达到或超过手工构建 Agent 的表现。

当候选解能够被自动评估，且候选项的 fitness 易于量化时，这一类方法会很有效，例如 matrix multiplication、GPU kernel optimization、algorithm contests 和 datacenter scheduling。如果一个领域的评估缓慢、含糊，或主要依赖 heuristic，则这类方法会遇到困难。演化的 compute efficiency 和 effectiveness 同样值得担忧。

### 与模型权重联合优化

Harness 演化改变的是模型周围的 non-parametric system。为了实现完整的自我改进，完全可以允许模型同时更新自己的 weights。权重更新可以通过改进模型训练 pipeline，或在 test time 进行 continual learning 来实现。continual learning 这个主题值得以后单独写一篇文章。

**SIA**（[Hebbar et al. 2026](https://arxiv.org/abs/2605.27276)）是较早把 Harness 改进和模型参数更新纳入同一个优化循环的尝试之一，其设计包含三个组件：

- *Meta-Agent*：提出初始 Harness。
- *Task-Specific Agent*：执行任务。
- *Feedback-Agent*：根据最近的 trajectories，决定更新 Harness 还是模型权重。

![SIA 中的 Feedback-Agent 决定下一轮迭代类型](/images/harness/SIA.png)

*SIA 中的 Feedback-Agent 决定下一轮迭代的类型。（图片来源：[Hebbar et al. 2026](https://arxiv.org/abs/2605.27276)）*

SIA 的实验中存在一些 confounding choices，使结果难以解读。例如，task-specific agent 明显弱于 Meta-Agent 和 Feedback-Agent 所用的模型（`gpt-oss-120b` 对比 `Claude Sonnet 4.6`），而且 baselines 太弱，难以与相关方法进行清晰的交叉参照。我认为这个方向很有意思，但目前的证据仍是初步的。此外，training stability、Goodhart effect 等许多挑战仍未解决。

**Continual Harness**（[Karten et al. 2026](https://arxiv.org/abs/2605.09998)）在 long-horizon gameplay setting 中进行了实验：它更新 Harness，同时通过把强 teacher model 在 low-reward trajectories 上给出的 labels 蒸馏给 policy model，来共同训练该 policy model。

## 未来挑战

AI Scientist 这一系列工作有力地证明了：由专家设计的 Harness 可以协调自动研究循环中的很大一部分工作，相关实验以撰写研究论文的形式展开。但论文生产并不等同于科学发现。一个系统可以写出看似可信的论文，同时仍存在伪造引用、implementation drift 或实验结果薄弱等问题。

[Trehan 与 Chopra（2026）](https://arxiv.org/abs/2601.03315)测试了 LLM 能否在极少的 scaffolding 和基础工具（即 `read_file`、`write_file`、`llm_search`、`list_files`）支持下，从研究想法一路走到论文。每个想法都有一个专用 workspace，agent 可以在其中生成和读取文档，并把它们用作 context。实验覆盖三个领域（world models、multi-agent RL、AI safety & alignment），每个领域包含 45-50 份高质量 seed document，用于启发新想法。人类专家只选出四个想法进入完整 pipeline，最终只有一个被完整执行并写成论文。实验中反复出现了六类失败模式：

- *偏向训练数据中的默认方案（Bias toward training-data defaults）*：使用旧 library、过时 command、标准格式，或采用并未基于实际 repository 或 dataset 的假设。
- *执行压力下的实现漂移（Implementation drift under execution pressure）*：当实现变得技术复杂时，模型可能偏离原提案，转向一种常见但更简单的方案。
- *Memory 与 context 退化（Memory and context degradation）*：在长周期项目中，如果日志没有作为 persistent artifact 写入，关键细节就会丢失。
- *过度乐观（Over-optimism）*：即使实验噪声很大或已经失败，模型仍会宣布成功。[Bubeck et al.（2025）](https://arxiv.org/abs/2511.16072)也观察到类似的 “p-hacking and eureka-ing” 模式：当信号仍然只是噪声时，模型会引入“数值胶带”（numerical duct tape）并宣告胜利。
- *Domain intelligence 不足（Insufficient domain intelligence）*：模型缺少隐性的专业技艺知识，例如预测实现复杂度、判断实验结果是否合理，或者知道哪些 baseline 真正重要。
- *Scientific taste 薄弱（Weak scientific taste）*：实验可能能够执行，却没有回答正确的问题。

在迈向完整 RSI 的过程中，研究者已经取得实际进展，但仍存在若干瓶颈。

**1. 薄弱且模糊的 evaluator（Weak and fuzzy evaluators）。** 许多研究主张并没有快速而精确的 verifier，很多现实任务也是如此。当前的自我改进循环最适合 evaluation metric 可测量且客观的任务，这一点与 [RL 的工作方式](https://lilianweng.github.io/posts/2018-02-19-rl-overview/)相似。

Research taste、novelty 与长期科学价值要难衡量得多。例如，research taste 往往混合了问题 framing、实验设计，以及对哪些意外结果值得继续追踪、哪些失败案例值得重试的判断。

**2. Context 与 memory 的生命周期（Context and memory lifecycle）。** 随着 AI agent 变得更加自主、独立，memory 也会持续增长。一个有用的 Harness 需要管理 context 和 memory，以弥补现有 long-context generation 的局限，同时尽可能提高长周期任务的成功率。人类能够在一生中维持记忆，我由此想到一种类比：[context engineering](#context-engineering) 将会、也应该成为 intelligence 的核心组成部分，而不是一直停留在软件系统层。

**3. 负面结果（Negative results）。** 研究者受到发表成功结果的激励，因此文献天然偏向成功。LLM 训练于海量数据之上（至少目前主要还是人类创造的数据，哈哈），而数据中的成功案例与失败案例并不均衡，这可能使模型不擅长判断何时应放弃一个 hypothesis、报告负面结果，甚至承认失败。Research Harness 应该让失败尝试易于保存，因为从失败中学习是缩小任务搜索空间的最佳方式。

**4. 多样性坍缩（Diversity collapse）。** Evolutionary loop 与 RL loop 倾向于利用已知的高 reward 模式。我们需要相应的[机制](https://lilianweng.github.io/posts/2020-06-07-exploration-drl/)，防止整个 population 坍缩成同一个 solution 的各种变体。这对于开放式研究尤其关键，因为最好的路径在当前 evaluator 下，起初可能显得更差。

**5. [Reward hacking](https://lilianweng.github.io/posts/2024-11-28-reward-hacking/)。** 自我改进循环会优化它所接收到的任何信号。如果 reward 来自 unit test，agent 可能会过拟合测试；如果来自 judge model，它可能会学到专门针对这个 judge 的 reward hacking 技巧；如果来自 benchmark score，它可能会利用 benchmark artifact。

Evaluator 与 permission control 很可能应该位于演化 Harness 的循环之外，并在重要决策点配合 held-out test、trace audit 与 human review。能够把多大程度的 oversight 扩展并自动化，仍是一个开放的研究方向。

**6. 长期成功（Long-term success）。** 外部优化循环作用于单次 rollout 之外、可以在训练 sandbox 中模拟的 reward。

以 coding agent 为例，它已经提高了软件工程的日常生产力，但很多优化目标仍然过于短期。它通常可以完成眼前任务，却很难判断应该怎样保护一个由数百或数千名工程师共同维护的 repository 的长期健康。标准的 sandbox-based、RLVR-style 训练很少能够覆盖 maintainability、ownership boundary、migration cost、backwards compatibility 或未来的 debugging burden。

**7. 人类的角色（The role of humans）。** 人类应该上移到系统栈的更高层，而不是被移出循环。这意味着人类需要在正确的时间、以正确的抽象层级提供 oversight；系统设计也应考虑何时、如何设置这样的接触点。

上面列出的许多挑战都需要人类的反馈与引导。毕竟，我们是在为人类更好的未来建设技术，而不是反过来。

## 引用

请按以下格式引用本文：

> Weng, Lilian. “Harness Engineering for Self-Improvement”. Lil’Log (Jul 2026). https://lilianweng.github.io/posts/2026-07-04-harness/

也可以使用以下 BibTeX：

```bibtex
@article{weng2026harness,
  title = {Harness Engineering for Self-Improvement},
  author = {Weng, Lilian},
  journal = {lilianweng.github.io},
  year = {2026},
  month = {July},
  url = "https://lilianweng.github.io/posts/2026-07-04-harness/"
}
```

## 附录：一些有用的 Benchmark

- **[PaperBench](https://arxiv.org/abs/2504.01848)**：从头复现 20 篇 ICML 2024 Spotlight 和 Oral 论文，包括理解论文贡献、开发 codebase，以及成功执行实验。
  - 每个复现任务都被拆分为更小、可单独评分的任务。
  - 共 8,316 条 rubric，由 benchmark 团队与论文作者共同制定。
  - 当时表现最好的模型（`Claude 3.5 Sonnet`，约 21%）没有超过 ML PhD。
  - 包含 PaperBench、PaperBench Code-Dev（较轻量版本）和 JudgeEval。
- **[CORE-Bench](https://arxiv.org/abs/2409.11363)**：评估已发表研究的计算可复现性。
  - 包含 270 个任务，来自计算机科学、社会科学和医学领域的 90 篇科学论文。
  - 任务要求使用给定代码与数据复现结果。
  - 包含多个难度等级，以及纯语言和视觉语言任务。
  - 当时公开报告中表现最好的 agent（`GPT-4o` 和 `GPT-4o-mini`）在最难任务上的准确率仅为 21%。
- **[ScienceAgentBench](https://arxiv.org/abs/2410.05080)**：评估用于数据驱动科学发现的 LLM agent。
  - 从数学、化学、生物学和地理学四个学科的 44 篇同行评审论文中提取 102 个任务。
  - 覆盖这些领域中的基础 data science 任务：数据处理、模型开发、数据分析和信息可视化。
- **[RE-Bench](https://arxiv.org/abs/2411.15114)**：把 frontier AI agent 与人类专家放在现实的 ML research-engineering 环境中进行比较。
  - 包含 7 个有挑战性的开放式 ML research-engineering 环境。
  - 每个环境 =（scoring function、starting solution、reference solution）；均可使用不超过 8 张 H100 GPU 运行。
  - 示例包括：优化 kernel、运行 scaling-law 实验、修复 embedding、为 QA fine-tune GPT-2 等。
  - 包含 61 位不同人类专家完成的 71 次、每次 8 小时的尝试数据。
  - 人类专家在 82% 的 8 小时尝试中取得非零分数；24% 的尝试达到或超过强 reference solution。
  - 在 2 小时预算下，最好的 AI agent 得分是人类的 4 倍；但人类从更长预算中获得的收益更大，并在 8 小时和 32 小时设置下超过 agent。
- **[MLE-bench](https://arxiv.org/abs/2410.07095)**：在离线 Kaggle 竞赛上评估 ML engineering agent。
  - 包含从 Kaggle 筛选的 75 个 ML engineering 竞赛。
  - 测试训练模型、准备 dataset、运行实验，以及向评分脚本提交预测等能力。
  - 使用 Kaggle 公开 leaderboard 作为人类 baseline。
  - 论文中的最佳设置 `o1-preview` + AIDE scaffolding，在 16.9% 的竞赛中至少达到 Kaggle 铜牌水平。
  - 包含 resource scaling 与 contamination analysis。
- **[KernelBench](https://arxiv.org/abs/2502.10517)**：评估生成 GPU kernel 的正确性与速度。
  - 包含 250 个 PyTorch 任务，用于测试 LLM 能否编写快速且正确的 kernel。
  - Evaluation metric `fast_p` = 生成的 kernel 中既正确、又快于 baseline 的比例。

## 参考文献

> 参考文献题名、出版信息和链接保留原文写法。

\[1\] Good, I. J. [“Speculations Concerning the First Ultraintelligent Machine.”](https://philpapers.org/rec/GOOSCT) *Advances in Computers*, 6:31-88, 1965.

\[2\] Yudkowsky, Eliezer. [“Recursive Self-Improvement.”](https://www.lesswrong.com/posts/JBadX7rwdcRFzGuju/recursive-self-improvement) LessWrong, 2008.

\[3\] Choi, et al. [“Anchored Self-Play for Code Repair.”](https://openreview.net/forum?id=lTbBFAoPSA) ICML 2026.

\[4\] Zhao, et al. [“Absolute Zero: Reinforced Self-play Reasoning with Zero Data.”](https://arxiv.org/abs/2505.03335) arXiv preprint arXiv:2505.03335, 2025.

\[5\] Yuan, et al. [“Self-Rewarding Language Models.”](https://arxiv.org/abs/2401.10020) arXiv preprint arXiv:2401.10020, 2024.

\[6\] Chen, et al. [“Self-Play Fine-Tuning Converts Weak Language Models to Strong Language Models.”](https://arxiv.org/abs/2401.01335) ICML 2024.

\[7\] Zhang, et al. [“Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models.”](https://arxiv.org/abs/2510.04618) ICLR 2026.

\[8\] Ye, et al. [“Meta Context Engineering via Agentic Skill Evolution.”](https://arxiv.org/abs/2601.21557) arXiv preprint arXiv:2601.21557, 2026.

\[9\] Lee, et al. [“Meta-Harness: End-to-End Optimization of Model Harnesses.”](https://arxiv.org/abs/2603.28052) arXiv preprint arXiv:2603.28052, 2026.

\[10\] Lu, et al. [“Towards end-to-end automation of AI research.”](https://www.nature.com/articles/s41586-026-10265-5) *Nature*, 651:914-919, 2026.

\[11\] Meng, et al. [“ScientistOne: Towards Human-Level Autonomous Research via Chain-of-Evidence.”](https://arxiv.org/abs/2605.26340) arXiv preprint arXiv:2605.26340, 2026.

\[12\] Kulikov, et al. [“Autodata: An agentic data scientist to create high quality synthetic data.”](https://arxiv.org/abs/2606.25996) arXiv preprint arXiv:2606.25996, 2026.

\[13\] Hu, Lu, and Clune. [“Automated Design of Agentic Systems.”](https://arxiv.org/abs/2408.08435) ICLR 2025.

\[14\] Madaan, et al. [“Self-Refine: Iterative Refinement with Self-Feedback.”](https://arxiv.org/abs/2303.17651) NeurIPS 2023.

\[15\] Zhang, et al. [“AFlow: Automating Agentic Workflow Generation.”](https://arxiv.org/abs/2410.10762) ICLR 2025.

\[16\] Zelikman, et al. [“Self-Taught Optimizer (STOP): Recursively Self-Improving Code Generation.”](https://arxiv.org/abs/2310.02304) COLM 2024.

\[17\] Zhang, et al. [“Self-Harness: Harnesses That Improve Themselves.”](https://arxiv.org/abs/2606.09498) arXiv preprint arXiv:2606.09498, 2026.

\[18\] Fernando, et al. [“Promptbreeder: Self-Referential Self-Improvement Via Prompt Evolution.”](https://arxiv.org/abs/2309.16797) arXiv preprint arXiv:2309.16797, 2023.

\[19\] Agrawal, A. et al. [“GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning.”](https://arxiv.org/abs/2507.19457) arXiv preprint arXiv:2507.19457, 2025.

\[20\] Novikov, et al. [“AlphaEvolve: A coding agent for scientific and algorithmic discovery.”](https://arxiv.org/abs/2506.13131) arXiv preprint arXiv:2506.13131, 2025.

\[21\] Lange, Imajuku, and Cetin. [“ShinkaEvolve: Towards Open-Ended And Sample-Efficient Program Evolution.”](https://arxiv.org/abs/2509.19349) arXiv preprint arXiv:2509.19349, 2025.

\[22\] Wang, et al. [“ThetaEvolve: Test-time Learning on Open Problems.”](https://arxiv.org/abs/2511.23473) arXiv preprint arXiv:2511.23473, 2025.

\[23\] Zhang, et al. [“Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents.”](https://arxiv.org/abs/2505.22954) arXiv preprint arXiv:2505.22954, 2025.

\[24\] Zhang, et al. [“Hyperagents.”](https://arxiv.org/abs/2603.19461) arXiv preprint arXiv:2603.19461, 2026.

\[25\] Yuksekgonul, et al. [“Learning to Discover at Test Time.”](https://arxiv.org/abs/2601.16175) arXiv preprint arXiv:2601.16175, 2026.

\[26\] Riaz, et al. [“Epistemic Uncertainty for Test-Time Discovery.”](https://arxiv.org/abs/2605.11328) arXiv preprint arXiv:2605.11328, 2026.

\[27\] Hebbar, et al. [“SIA: Self Improving AI with Harness & Weight Updates.”](https://arxiv.org/abs/2605.27276) arXiv preprint arXiv:2605.27276, 2026.

\[28\] Trehan and Chopra. [“Why LLMs Aren’t Scientists Yet: Lessons from Four Autonomous Research Attempts.”](https://arxiv.org/abs/2601.03315) arXiv preprint arXiv:2601.03315, 2026.

\[29\] Bubeck, et al. [“Early science acceleration experiments with GPT-5.”](https://arxiv.org/abs/2511.16072) arXiv preprint arXiv:2511.16072, 2025.

\[30\] Starace, et al. [“PaperBench: Evaluating AI’s Ability to Replicate AI Research.”](https://arxiv.org/abs/2504.01848) ICML 2025.

\[31\] Wijk, et al. [“RE-Bench: Evaluating frontier AI R&D capabilities of language model agents against human experts.”](https://arxiv.org/abs/2411.15114) ICML 2025.

\[32\] Chan, et al. [“MLE-bench: Evaluating Machine Learning Agents on Machine Learning Engineering.”](https://arxiv.org/abs/2410.07095) arXiv preprint arXiv:2410.07095, 2024.

\[33\] Chen, et al. [“ScienceAgentBench: Toward Rigorous Assessment of Language Agents for Data-Driven Scientific Discovery.”](https://arxiv.org/abs/2410.05080) ICLR 2025.

\[34\] Siegel, et al. [“CORE-Bench: Fostering the Credibility of Published Research Through a Computational Reproducibility Agent Benchmark.”](https://arxiv.org/abs/2409.11363) TMLR 2024.

\[35\] Ouyang, et al. [“KernelBench: Can LLMs Write Efficient GPU Kernels?”](https://arxiv.org/abs/2502.10517) arXiv preprint arXiv:2502.10517, 2025.

\[36\] Lin, et al. [“Harness Updating Is Not Harness Benefit: Disentangling Evolution Capabilities in Self-Evolving LLM Agents.”](https://arxiv.org/abs/2605.30621) arXiv preprint arXiv:2605.30621, 2026.

\[37\] Lin, et al. [“Agentic Harness Engineering: Observability-Driven Automatic Evolution of Coding-Agent Harnesses.”](https://arxiv.org/abs/2604.25850) arXiv preprint arXiv:2604.25850, 2026.

\[38\] Karten, et al. [“Continual Harness: Online Adaptation for Self-Improving Foundation Agents.”](https://arxiv.org/abs/2605.09998) arXiv preprint arXiv:2605.09998, 2026.

\[39\] Che, et al. [“DemoEvolve: Overcoming Sparse Feedback in Agentic Harness Evolution with Demonstrations.”](https://arxiv.org/abs/2605.24539) arXiv preprint arXiv:2605.24539, 2026.
