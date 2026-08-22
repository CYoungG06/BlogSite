---
title: "Agent Harness 的两个世界，工业界在做什么，学术界在研究什么"
date: "2026-08-21"
description: "把 Claude Code 和 AutoHarness 放在一起，Harness 这个词就显出了两个世界：工业界按产品责任划边界，学术界按实验变量划边界。这篇综述梳理 2026 年的研究与产品实践——Codex/Claude Code 的工程责任，AutoHarness/Meta-Harness/AHE/Harness-R1/ClawGym II 等工作的研究对象，评测配平与安全边界，以及「自动演化」离强 RSI 还缺的证据。"
tags:
  - Agent
  - Harness
  - LLM
  - 综述
---

把 Claude Code 和 AutoHarness 放在同一篇文章里，Harness 这个词会显得有些奇怪。

Claude Code 要处理会话状态、上下文压缩、工具调用、权限、沙箱、恢复和不同客户端的交互。AutoHarness 在一组游戏实验里生成的 Harness，有时只负责过滤非法动作，再往前一步，它甚至会生成一份完整的代码策略，决策时不再调用语言模型。两者承担的责任差了几个数量级，却都被叫作 Agent Harness。

把近两年的论文和产品资料放在一起看，最先碰到的问题是，Harness 并没有一个天然固定的大小。它更像一条系统边界。工业界按照产品需要承担的责任划这条边界，学术界按照实验中允许修改的变量划边界。到了 2026 年，学术研究又在不断扩大可编辑范围，从 prompt、工具和 memory 进入 runtime、Harness optimizer、模型训练、安全和真实工业环境。

这个词目前还没有一套公认的接口标准。有人用它指 system prompt 外加工具定义，有人指一整套 agent loop，也有人直接把可运行的 coding agent 产品叫作 Harness。它们能共享名称，靠的是相近的拓扑位置。模型在一边，外部环境在另一边，中间那套安排观察、动作、状态和验证的程序，都可以落入这个概念。至于程序究竟包到哪一层，要看说话的人正在承担产品责任，还是正在控制一个实验变量。

这条边界怎样划，决定了 Codex、Claude Code 和论文里的 action filter 为什么能共享一个名称，也决定了许多所谓 Harness Evolution 离 Recursive Self-Improvement 究竟还有多远。

## 先给 Harness 画一条能工作的边界

一次 Agent 执行大致分成四步。Harness 先构造模型这一步看见的上下文，里面可能有 system prompt、文件、历史、长期记忆、检索结果和工具返回。模型生成输出以后，Harness 再把它转成环境能够执行的动作，包括工具解析、参数检查、路由和权限判断。动作发生以后，它还要更新状态，决定怎样保存轨迹、压缩上下文、重试、回滚或终止。终端、代码目录、浏览器和数据库则是 Agent 实际作用的环境。

按这个定义，Agent Harness 是模型参数之外的一套可执行程序。它负责组织观测、动作、控制流和状态，也负责判断结果能否被接受。再换成日常说法，它管模型能看到什么、能够做什么，多步执行怎样继续，以及哪些信息能留到下一步或下一次会话。

把这套职责写得稍微形式化一些，可以将第 $k$ 代 Harness 的持久设计快照记作 $\eta_k$，它包含纳入版本控制或晋升流程的源码、配置、memory policy 和长期 artifact。当前执行中随步骤变化的 memory 内容、checkpoint 和重试计数另记为运行时状态 $r_t$。普通评测会重置 $r$，持续任务也可以在同一 $\eta_k$ 下把它带到下一项任务。只有经过保存、审查和晋升的状态，才进入 $\eta_{k+1}$。

Harness 的四组职责可以合写成 $H_\eta=(C_\eta,P_\eta,U_\eta,S_\eta)$。$C$ 构造上下文，$P$ 解析动作并检查权限与格式，$U$ 根据环境返回更新状态，$S$ 决定继续、完成、失败或等待确认。若把完整细节先收起来，一次运行只需要下面这条关系。

$$
\tau=\operatorname{Run}(M_\theta,H_\eta,x,\mathcal W;\xi,B)
$$

$x$ 是任务，$\mathcal W$ 是环境，$\xi$ 收拢模型采样和环境随机性，$B$ 是本次运行预算，$\tau$ 则是最终轨迹。这个写法强调一个简单事实，实际表现来自模型与 Harness 的组合。模型保持不变，Harness 改动上下文、动作接口或停止条件以后，轨迹仍会改变。

停止判断也不能依赖模型随口说一句“完成了”。$S$ 可以读取 target Harness 可见的测试结果、文件是否存在、编译日志、运行时 validator 或人工审批。隐藏的 benchmark scorer 属于评测侧，不能进入 $S$，否则最终评分会泄漏给执行系统。SemaPLC 一类工作后来重新强调外部验证，追到最小执行循环里，位置就在这一项。

四组函数对应四类常见失败。上下文构造漏掉约束，模型从一开始就没有得到完整任务。动作解析有误，合理的模型输出也可能变成错误工具调用。状态更新处理不好，压缩会丢内容，重试还可能重复产生副作用。完成判断太松，Agent 会在工件尚未通过检验时提前收工。它们都发生在模型权重之外，却能直接改变最终表现。

这个定义仍然很宽。若把模型参数之外的所有东西都放进来，UI、计费和 Kubernetes 也会变成 Harness，概念就失去区分能力。比较实用的办法是把系统分成五层。

| 层次 | 主要对象 | 常见内容 |
| --- | --- | --- |
| L0 | 模型 | 权重、推理能力、训练和后训练 |
| L1 | 行为层 | prompt、上下文构造、工具定义、memory、planning、routing、verification、agent loop |
| L2 | Agent runtime | 工具执行、sandbox、session、checkpoint、并发、重试、取消、压缩和持久化 |
| L3 | 产品层 | CLI、IDE、Web、认证、协议、审批、兼容性、可观测性和成本治理 |
| L4 | 改进层 | traces、eval、失败归类、候选修改、搜索、回归测试、版本晋升和回滚 |

L0 到 L4 是本文为了比较不同对象采用的分析框架，并非领域已经接受的标准分层。

![同一个 Harness 名称覆盖的系统范围。本文用 L0 到 L4 比较工业产品、学术 target harness 与外层改进系统，颜色表示讨论或可编辑范围，不代表行业已经形成统一标准。](/images/blog/agent-harness-boundary/system-boundary.svg)

Codex 和 Claude Code 通常横跨 L1、L2，并带有大量 L3 能力。论文里的 target harness 常集中在 L1 和少量 L2，论文新提出的方法则经常位于 L4。完整产品还包括模型、行为 Harness、runtime 和产品外壳，这几部分共同承担责任，不能当成四个可以直接相加的数值。

日常讨论把完整产品叫作 Harness，原因也不难理解。模型相同的情况下，用户能直接感受到的很多差异，正是周围这套程序造成的。

可以沿着一次普通的代码修复看看这五层怎样接在一起。L1 决定 Agent 读到哪些仓库说明、历史消息和工具 schema，也规定它怎样编辑文件、运行测试。模型发出命令后，L2 创建进程、隔离工作目录、保存输出，并在中断以后恢复 session。命令需要联网或越过当前权限时，L3 将审批请求交给客户端，再把决定同步回运行中的任务。测试结果进入轨迹以后，L4 才能比较候选修改、检查回归并决定是否晋升新版本。L0 的模型一直参与决策，周围四层却分别决定它得到什么信息、能够把决定落实到哪里，以及系统凭什么相信任务已经完成。

## 工业 Harness 先要把任务可靠地跑完

OpenAI 在 2026 年 8 月发布的 [Codex 平台介绍](https://learn.chatgpt.com/blog/codex-as-a-platform) 里，把 Harness 直接描述为模型周围的执行系统。它要维持上下文，调用工具，暴露进度，处理失败，在必要时请求人工批准，并把工作带到后续回合。Codex 的 app-server 又把 thread、turn、事件流和审批请求做成可接入的客户端协议。

同一篇文章也保留了宿主应用的责任。Codex app-server 提供 agent loop 与沙箱执行，接入方仍要掌管产品界面和业务上下文，并决定应用自有工具、用户同意边界与事实记录落在哪里。嵌入一套成熟的 Harness 以后，推理和执行流程可以复用，业务上的最终裁决权仍留在宿主系统。这是工业边界里很关键的一刀，Harness 负责让 Agent 行动，产品负责说明这次行动在具体业务里是否有权发生。

这里已经能看见工业 Harness 的两种口径。窄口径指协调用户、模型和工具的 agent loop。宽口径还会包含 thread 的创建、恢复、分叉与持久化，配置和认证，沙箱中的工具执行，MCP、skills、审批，以及多个客户端之间的状态同步。

LangChain 的两篇官方文章把这种浮动表现得更直接。[The Anatomy of an Agent Harness](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness) 采用很宽的分析口径，把模型之外的 prompts、tools、filesystem、sandbox、orchestration 和 middleware 都算进 Harness。随后讨论生产架构的 [The Runtime Behind Production Deep Agents](https://www.langchain.com/blog/runtime-behind-production-deep-agents) 又把边界收窄，将 prompts、tools、skills 与 model-tool loop 归入 Harness，把 durable execution、checkpoint、长期存储、多租户和可观测性放进下方的 runtime。

两种划法服务于不同问题。前一篇在解释 Agent 由哪些部分组成，后一篇在确定生产模块由谁拥有。连同一团队都会按概念说明或部署架构重新切边界，阅读任何 Harness 材料时，最好先问作者正在定义整个系统，还是某个可独立维护的模块。

工业系统还要区分另一条轴，Harness 包得有多宽，与执行过程由模型还是代码主导并非同一个问题。Anthropic 在 [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) 中把常见设计分成 workflow 与 agent。workflow 由预先写好的代码路径安排模型和工具，agent 则让模型根据中间环境反馈决定下一步。一套很宽的产品 Harness 可以包含确定性的审批和恢复流程，核心任务仍由模型选择路径。一个很窄的 agent loop 也可能把下一步工具选择完全交给模型。Harness 变宽不会自然提高自治程度。设计者有时扩大模型的选择空间，有时会在高风险动作前把控制收回给程序。

Anthropic 在 [Agent 评测说明](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) 里也做了相近区分。evaluation harness 负责启动任务、提供工具、记录轨迹、评分和汇总。agent harness 或 scaffold 让模型能够行动，Claude Code 就被列作一个灵活的例子。[Claude Code 工作机制](https://code.claude.com/docs/en/how-claude-code-works) 及相关功能页继续列出了项目和 Git 状态、CLAUDE.md、记忆、hooks、subagents、文件改动的 checkpoint 与 rewind、权限、自动压缩，以及终端、IDE、Web、Slack 和 CI 等运行入口。

这些能力里有很大一部分不会产生新颖的 Agent 算法。工具进程崩溃以后怎样恢复，网络断开后任务能否继续，同一个 session 怎样由另一台客户端重新连接，多个 Agent 怎样隔离工作目录，shell 和文件访问怎样授权，协议升级后旧客户端还能否工作，这些都是传统系统工程问题。一次有副作用的操作尤其麻烦。系统不能在状态不明时随手重试，也不能在缺少证据时宣布成功。

工具进程崩溃和客户端掉线看起来都像“任务停了”，系统要采取的动作却不同。正常可观察的子进程退出时，Harness 能读取退出码和已经持久化的输出。前端断开只说明用户暂时收不到事件，后端任务可能仍在运行。若 session 的事实只保存在某个浏览器页面里，换设备重连或进程重启时，系统就无法判断先前走到了哪一步。durable session 的作用正在这里。展示层可以换，任务事实要有独立的保存位置。

副作用又多一层困难。一次写文件、创建工单或调用外部服务的请求遇到网络超时，调用方只能确认没有收到完整回执，无法据此断言远端没有执行。直接重试可能把同一件事做两遍，直接放弃又可能把已经发生的动作记成失败。产品系统的运行层因此需要在执行前记录意图，在执行后保存证据，并为能够安全重试的操作建立幂等约束。结果仍无法确定时，最可靠的状态往往就是“未知”，随后交给 reconcile、人工检查或专门的恢复协议处理。

上下文压缩同样属于运行责任。它要给后续模型调用腾出空间，又不能把用户限制、尚未完成的子任务和关键工具结果一起删掉。并发 Agent 还会把问题扩展到工作目录隔离、共享资源和写入冲突。产品团队花在这些地方的时间，很少出现在 Agent 算法图里，用户能否放心让任务跑几个小时，却由它们决定。

压缩只是上下文工程的一部分。Anthropic 的 [Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) 把 context 严格落到每次采样真正进入模型的 token，其中既有指令和消息，也有工具定义、检索内容、工具返回与被选入本轮的状态表示。窗口容量有限，context 变长时，召回与长程推理还可能下降。Harness 因此要决定哪些高信号信息立即进入，哪些内容只留下可寻址的入口。Claude Code 采用了一种混合方式，CLAUDE.md 一类高优先级说明预先放入上下文，其余仓库内容通过文件路径、glob 和 grep 按需发现。文件系统在这里同时承担执行环境、外部记忆与上下文索引，模型无需在每一轮重新读完整个世界。

OpenAI 在 [Skills、Shell 与 Compaction 的实践说明](https://developers.openai.com/blog/skills-shell-tips) 里进一步把稳定流程、执行环境和连续性分开。Skill 是按需加载、能够版本化的流程说明与资源包，shell 提供真实执行环境，compaction 负责在上下文接近上限时保留任务脉络。启动时可以只暴露 skill 的名称、说明与路径，匹配到相关任务以后再读取完整步骤和所需资源。这样既避免把全部流程塞进一份巨型 system prompt，也让操作知识能够单独审查、测试和回滚。三者合在一起很像工业 Harness 的基本分工，流程说明告诉 Agent 怎样做，环境让动作真正发生，连续性机制让未完成的工作能够继续。

跨窗口长任务还需要把交接证据留在上下文之外。Anthropic 在一组 full-stack Web 应用实验中使用 [long-running agent harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)，首轮先建立功能清单、进度文件、Git 历史、启动脚本和测试，后续 session 再从这些 artifact 读取已经完成和仍待处理的工作。模型上下文可以重置，已落盘的项目状态与交接记录仍能接续。这些记录可能陈旧或写错，最终还要由测试和环境状态验证。这套办法来自特定实验，文章也把稳定的跨窗口推进视作尚未完全解决的问题。它至少说明，在这类长任务中，compaction 不能独自承担 durable state，外部 artifact 提供了不同 session 可以共同核对的证据。

工业系统因此会把很多精力花在运行和治理上。产品必须同时关心正确性、延迟、成本、安全和交互。离线 eval 只是信号之一，线上故障、用户反馈和回滚记录也会改变 Harness 的下一版。

这些信号需要经过整理，才能进入可复现的改进循环。LangChain 的 [Agent 可观测性文章](https://www.langchain.com/blog/agent-observability-powers-agent-evaluation) 建议分别查看单次模型调用、完整 trace 和跨回合 thread。线上暴露的未知失败还要经过筛选、脱敏、标注与重放设置，才适合整理成离线 test case。trace 能还原模型输出、工具调用与中间步骤，仍不能单独证明任务成功。文件是否生成、外部状态是否改变，还要由环境和 artifact 给出结果证据。

OpenAI 的 [Skill 评测实践](https://developers.openai.com/blog/eval-skills) 把这条链写成 prompt、被捕获的 trace 与 artifact、检查项、可比较分数。检查项可以观察 outcome、process、style 与 efficiency，确定性测试和模型 rubric 各自覆盖适合的部分。某条命令被调用，最多证明过程走过这一步，应用能否构建和运行仍要靠 smoke test、端到端测试或外部 validator。放到本文的 L4 框架里，产品团队还可以把真实失败变成回归案例，修改可版本化的 skill 或 Harness，再通过门禁和渐进发布把候选带回线上。

工业界的 Harness 也没有永远固定的外沿。Anthropic 在 [Managed Agents 架构](https://www.anthropic.com/engineering/managed-agents) 里把 durable session、负责上下文与模型调用的 Harness、执行代码的 sandbox 分开处理。session 保存可恢复的完整事件，Harness 决定本轮把哪些内容放进模型上下文，sandbox 承担代码执行。这里的 Harness 被收窄成 orchestration layer，相邻责任仍属于完整 Agent 系统。

工业定义随着责任归属变化。谁负责哪一段产品行为，边界就画到哪里。

由此也能看清工业改进与学术 Harness Evolution 的连接处。两边都有观察、修改和验证组成的 L4 回路。工业团队通常由工程师定位责任，候选修改经过代码审查和回归门禁，再以可回滚方式进入真实用户环境。关注自动 Harness evolution 的许多受控实验会固定模型、环境、任务切分和预算，让 optimizer 产生候选，并用受控分数决定是否晋升。它们的回路形状相似，修改权限、反馈来源和发布含义都不同。benchmark 内的自动晋升只说明候选通过了该实验协议，不能直接等同于一次工业发布。

## 学术 Harness 先要把实验变量说清

学术论文面对的是另一种约束。研究者要固定尽可能多的条件，再观察某项修改是否带来变化。环境、模型和预算经常被固定，只留下 prompt、工具、memory、workflow、action validator 或 verifier 作为可修改范围。

很多今天被归入 Harness 的研究，原来使用别的名称。SWE-agent 在 2024 年谈 Agent-Computer Interface，研究文件编辑、代码目录导航和测试接口怎样改变 Agent 表现。[ADAS](https://arxiv.org/abs/2408.08435) 把 Agent 写成代码，让 meta-agent 自动发明 prompt、工具使用和 workflow。[AFlow](https://arxiv.org/abs/2410.10762) 把 workflow 写成代码图，再用 Monte Carlo Tree Search 搜索。scaffold、workflow、agent architecture、ACI、context engineering 和 tool orchestration，后来逐渐汇到 Harness 这个词下面。

这个汇合也让 Harness 形成了一条很长的尺寸连续谱。最小的一端可能只有 system prompt 或 tool schema，往外可以加入 action validator、context policy 和 memory policy，再往外是完整 agent loop。加入 sandbox、session、协议与多客户端交互以后，它已经接近产品 runtime。名称本身无法告诉我们作者改了多大一块。读论文时更可靠的入口是可修改范围，先看哪些文件和组件允许变化，再看其余条件怎样固定。

这波研究增长还有一个技术条件。模型如今能读代码、检查轨迹、运行测试并改程序。过去由工程师手写后固定下来的执行结构，开始成为可以搜索、编辑和验证的程序对象。

讨论这类论文时，至少要分清三套程序。

Target harness 负责完成任务。Evaluation harness 启动环境、执行任务、收集轨迹和评分。Meta-harness 是更外层的系统，可以包含提出修改的 optimizer、评测系统和版本晋升逻辑。Optimizer 生成候选，评测系统给出证据，晋升规则再决定哪个版本可以留下。很多论文标题强调第一套，主要研究贡献却位于后两套系统。

学术 Harness 有时看起来很小，实验系统却很重。最终候选可能只是一份紧凑的执行程序，外层 proposer 却要检查远超当前上下文窗口的历史代码、分数和轨迹。研究系统还要保存候选谱系，反复运行任务，并把随机结果整理成可比较的证据。学术复杂度常集中在搜索、统计归因和泛化验证上。

把两边的差别归成“工业复杂，论文简单”会漏掉这一点。工业系统主要承担运行复杂度，论文更关心优化复杂度。工业团队在多目标约束下人工审查、灰度发布和回滚；研究系统要在随机模型输出下生成候选，控制预算，再证明增益来自 Harness 修改。

两边的复杂度可以沿七个维度拆开看。

| 比较维度 | 工业 Harness | 学术 Harness 研究 |
| --- | --- | --- |
| 行为问题 | 让真实长任务稳定完成 | 判断哪种外部结构提高目标任务表现 |
| 运行问题 | 持久化、权限、并发、恢复、协议和延迟 | 常简化或固定环境，以便控制变量 |
| 优化问题 | 工程师结合线上反馈、eval 和发布流程修改 | 自动搜索、归因、候选选择和泛化验证 |
| 目标函数 | 正确性、可靠性、成本、安全与交互共同约束 | 一个或少数 benchmark 指标 |
| 评测信号 | 离线 eval、用户反馈、线上故障与回滚记录 | 固定任务集、回归集、测试或模型评分器 |
| 修改方式 | 代码审查、渐进发布、canary、版本晋升与回滚 | meta-agent 或搜索算法生成候选 |
| 模型关系 | 围绕具体模型版本持续调试 | 经常冻结模型，以便把变化归到 Harness |

目标函数的区别尤其重要。学术实验可以先把成功率当作主指标，工业产品通常面对带约束的多目标问题。某个新 Harness 多完成两道题，却让每次任务多花三倍 token，或者提高了误操作风险，产品团队未必会发布它。反过来，产品为恢复、审批和兼容性投入的工程不会自动提高 benchmark 分数，它仍然决定系统是否能长期运行。

评测信号也改变了修改节奏。论文可以在一组任务上批量运行候选，等统计结果出来后再选版本。线上系统的错误会夹杂网络故障、用户中断、工具升级和真实数据分布变化。工程师还要判断某次下降来自模型、Harness、依赖服务，还是产品入口。学术系统努力排除这些扰动，工业系统每天都在承受它们。

同一个模型版本也不能和 Harness 完全拆开。Anthropic 在 [长任务 Harness 设计](https://www.anthropic.com/engineering/harness-design-long-running-apps) 中记录过一个很具体的变化。Sonnet 4.5 会在长上下文里出现明显的 context anxiety，单靠 compaction 不够，跨 session reset 一度成为必要设计。Opus 4.5 基本消除了这种行为，reset 随后被删掉，Harness 改成连续 session 加自动压缩。一个版本需要的纠错结构，换到更强模型后可能只剩 token、延迟和编排开销。

这个例子说明 Harness 优化总带着条件。较弱模型可能需要更多状态提醒和强制检查，较强模型面对同一套规则时会重复验证，消耗更多 token。一类任务需要严格的阶段纪律，换到探索空间更大的任务，这些阶段又可能过早收窄搜索。benchmark 上的 pass@1 上升，也可能伴随延迟增加和交互变长。模型与 Harness 的组合才是实际执行者，单独寻找一份跨版本通用的最优 Harness，很容易忽略这种耦合。

因此，Harness 的实验结论总是带着模型版本、任务分布、工具和预算。论文里的增益不能直接搬进另一个产品，工业系统投入大量 session 和权限工程，也不会自动成为新的学习算法。两边属于同一个上位概念，研究和交付的层次不同。

## 同一种东西只能回答到三个层面

概念层面上，工业产品和论文对象属于同一类系统。它们都在模型参数之外安排上下文、工具、状态与验证，都会改变模型在环境中的实际行为。把它们放进 Agent Harness 这个上位概念，有助于讨论模型外部程序怎样贡献能力。

工程对象层面上，两者通常不能直接等同。论文里的 target harness 往往是产品 Harness 的一个投影，只暴露 prompt、tool schema、memory、verification hook 或少数 workflow 节点。产品要继续承担身份、权限、会话持久化、故障恢复和客户端协议。某篇论文把 runtime 固定在评测系统里，并不表示这些责任消失了，只表示它们没有进入本轮搜索空间。

研究结论层面还要再收紧。固定模型在某个 benchmark 上改动几项 Harness 组件后得分提高，只能证明这组条件下的新配置更好。它没有同时证明新配置适合另一种模型，适合真实用户分布，成本和延迟可以接受，也没有证明安全与可靠性不会回退。将它并入 Codex 或 Claude Code，还要经过代码审查、完整回归、权限审计和发布验证。

所以两边可以共用一套概念语言，不能互相替代证据。工业产品展示了 Harness 能承担多宽的责任，学术论文提供了控制变量后怎样识别因果的办法。

## 2026 年，研究开始改动哪些对象

这批论文按月份排列会显得很乱，按被修改的对象看就清楚得多。$M_{\theta_k}$ 表示模型，$H_{\eta_k}$ 表示执行任务的 target harness，$O_{\phi_k}$ 表示读取证据并提出修改的 optimizer，$\mathcal Q$ 则是负责隔离运行、记录和预算控制的 evaluation harness。评测侧还要分出产生指标的 $V$，以及决定晋升与回滚的规则 $\Gamma$。这些记号只服务于本文比较，不是该领域共同使用的标准。

一次受控的 Harness 更新可以缩成三步。约定 $\widetilde\eta_{k,0}=\eta_k$，编号 0 始终代表当前版本。$\mathcal E_k$ 是 optimizer 能看到的轨迹、指标与历史证据，$\Pi$ 则把 gate 任务、环境、评分器、单配置预算与配对种子收进同一评测协议。

$$
\begin{aligned}
\delta_{k,j} &\sim O_{\phi_k}(\cdot\mid\eta_k,\mathcal E_k),
\qquad \widetilde\eta_{k,j}=\operatorname{Apply}(\eta_k,\delta_{k,j}),
\quad j=1,\ldots,J \\
m_{k,j} &= \operatorname{Eval}_{\mathcal Q}(M_{\theta_k},H_{\widetilde\eta_{k,j}};\Pi),
\qquad j=0,\ldots,J \\
\eta_{k+1} &= \operatorname{Promote}_{\Gamma}
\left(\{(\widetilde\eta_{k,j},m_{k,j})\}_{j=0}^{J}\right)
\end{aligned}
$$

当前版本和候选要使用同一模型、环境与 gate 任务，重复运行采用配对种子和匹配预算。$O_\phi$ 只负责提议，$\mathcal Q$ 负责重跑与保存证据，$V$ 产生指标，$\Gamma$ 才能决定新版本是否生效。准确率也不是唯一目标，成本、延迟、安全和可靠性都会影响一个候选能否发布。

![模型、Harness、Optimizer 与 Evaluator 的改进回路。实线表示执行和候选晋升，回流表示训练模型或训练 Harness Engineer，虚线外框里的任务分布、奖励协议与人工审批在很多实验中仍保持固定。](/images/blog/agent-harness-boundary/four-object-loop.svg)

这里最容易混淆的三类关系需要先说清。VeRO 提供的是外层或 evaluation harness，Shor 测量 optimizer 能否找对修改优先级。ClawGym II 通过固定黑盒 Harness 训练模型，TaoLive 则把开发者审查的 Harness Evolution 与 Harness-Aware Training 分成两条路径。它们都不能被笼统写成“训练一个会自动演化的 Harness”。

VeRO 已被作者列为 ICML 2026 接收。2026 年 7 月和 8 月的大量工作仍是刚发布的 arXiv 预印本，下面的实验数字均为作者报告，多数还缺少独立复现。

![近两年 Harness 研究地图。各行按照真正被修改或测量的对象组织代表工作，右侧列出常见的固定外层。](/images/blog/agent-harness-boundary/research-map-2026.svg)

## Harness 到底可以改到什么程度

年初的 Terminal-Bench、BioAgent Bench 一类工作里，evaluation harness 主要负责运行和评测 Agent。VeRO 随后把问题推进到怎样评测 Agent 修改另一个 Agent，原本固定的程序也开始进入实验对象。

学术研究打开的可修改范围，从一句 prompt 一直延伸到完整程序。几项代表工作的差别，可以先压进这张表。

| 工作 | 研究对象 | 带来的新认识 | 仍留在外部的责任 |
| --- | --- | --- | --- |
| [VeRO](https://arxiv.org/abs/2602.22480) | 版本、预算、轨迹与外层评测 | Agent 优化 Agent 可以重复比较 | 产品发布与线上责任 |
| [AutoHarness](https://arxiv.org/abs/2603.03329) | action filter 到 code policy | 边界取决于谁产生任务策略 | session、权限与恢复 |
| [Meta-Harness](https://arxiv.org/abs/2603.28052)、[NLAH](https://arxiv.org/abs/2603.25723) | 完整代码与可移植控制表示 | 完整程序进入搜索范围，控制表示开始与 runtime 分层 | 大型 runtime 与协议 |
| [AHE](https://arxiv.org/abs/2604.25850) | tools、middleware、memory 与文件组件 | 修改可以观察、回滚和核对 | 回归预判仍然较弱 |

VeRO 是承载优化实验的外层或 evaluation harness，并没有提出一个固定的最强 optimizer。AutoHarness 则让边界问题变得很具体。作者报告代码 action filter 消除了 145 个 TextArena 游戏中的非法动作，模型仍然负责策略。进一步生成完整 code policy 后，执行阶段不再调用 LLM。程序位于模型和环境之间还不够，谁产生任务策略，决定了它更接近 Harness 还是 policy。

这条控制权连续谱可以再看细一点。action filter 只拒绝非法动作，模型继续决定下一步。更强的 Harness 会根据环境生成合法候选，再由模型选择或解释，策略已经由两边共同形成。完整 code policy 直接输出动作序列以后，模型退出实际决策阶段。代码量无法替我们划线，关键要看程序是在约束策略、参与策略，还是已经接管策略。

Meta-Harness 把整套 Harness 代码交给 proposer。一次评测最多会留下约一千万 token 的信息，proposer 通过文件系统选择源码、旧候选和原始轨迹，一个发现的 Harness 还迁移到五个 held-out model。NLAH 走了另一条路，它把可移动的自然语言 pattern layer 与共享 runtime 分开，测试和验证继续由确定性程序承担。两项工作都说明 Harness 与 runtime 的界线来自接口设计。

Meta-Harness 的外层搜索本身并不复杂。它保存候选群体和 Pareto frontier，让 proposer 选择历史版本作为参考，search set 用来评估新代码，最终 test set 不向 proposer 开放。论文消融还显示，只给分数或摘要的效果明显弱于允许读取原始轨迹。对长时程程序来说，过早压缩 trace 会连同定位失败所需的线索一起删掉。

AHE 把组件、经验和修改决定做成可查看的文件与证据。作者报告 Terminal-Bench 2 pass@1 从 69.7% 提高到 77.0%。消融中，主要收益来自 tools、middleware 和 long-term memory，单独替换 system prompt 反而下降。系统能够解释修复理由，预见回归却更弱。学术 Harness 已经进入部分真实程序结构，完整产品责任仍没有随之进入搜索空间。

这里的可观测性有很具体的工程含义。组件先映射到可回滚的文件，长 trace 再按失败类别逐层展开。每次修改还要写清预期修复和潜在回归，下一轮结果回来以后再决定保留或撤销。优化器由此能追到行为对应的代码位置，修改失败时也知道该回滚哪一块。

## Agent 能力属于模型，还是模型与 Harness 的组合

[Harness-Bench](https://arxiv.org/abs/2605.27922) 用 106 个离线沙箱任务和 5,194 条轨迹比较模型与 Harness 的不同组合。任务、预算和评测协议保持一致，各 Harness 原生的 prompt、工具接口、状态管理与恢复行为继续存在。论文主张将 Agent capability 报告到组合这一粒度。Codex 属于 model-bound coding agent，只能作为实用参照，无法像可配置 Harness 那样进入完整的后端模型矩阵。

这种比较有一个难点。初始 workspace、超时和 evaluator 要一致，否则分数不可比；各 Harness 原生的工具、恢复与控制流又不能被抹平，否则被比较的对象已经换了。模型名称相同，tool schema、上下文和停止条件不同，轨迹分布就会变化。能力归因因此要落在具体组合上。

比较 Harness 时，模型、任务、环境、verifier 与预算都要固定。任一条件变化，两个 Harness 的差值都可能换方向。一篇立场论文 [Stop Comparing LLM Agents Without Disclosing the Harness](https://arxiv.org/abs/2605.23950) 认为，部分长时程任务里的 Harness 差异足以改变模型排名。它目前仍是 position paper 加有限控制实验，适合支持披露要求，不能推广到所有 Agent 任务。

[Harness Updating Is Not Harness Benefit](https://arxiv.org/abs/2605.30621) 又拆开了两种能力。harness-updating 看模型能否写出有用的持久修改，harness-benefit 看任务 Agent 会不会找到、理解并采用这些修改。作者报告 Qwen3.5-9B 生成的更新可以接近 Claude Opus 4.6，任务 Agent 得到的收益却没有随模型强度单调增加。

一份 skill、memory 或 artifact 写得准确，只能说明信息存在。任务 Agent 还要在合适时机调用它，并在长流程里持续遵循。工业产品实际交付的是这套联合行为，只列模型名无法解释最后结果。

这也把模型训练拆出一个独立目标。任务 Agent 要先判断当前问题需不需要某项 artifact，读取以后还要把规则落实到后续动作。更新者很强、执行者较弱时，系统可能不断写出好文件，最后几乎没有用上。昂贵模型放在 evolver 位置，并不能自动解决 invocation 和 adoption。

## 一份 Harness 能在持续任务中越积越好吗

[Continual Harness](https://arxiv.org/abs/2605.09998) 把 Harness 放进不重置的长期环境。prompt、sub-agents、skills 和 memory 会在一次持续运行内部更新，另有一条 co-learning 路径用过程奖励与 teacher 信号更新模型权重。这两层变化发生在不同时间尺度，不能混成一次普通版本晋升。

持续状态会把成功经验留下，也会保存错误判断与过期规则。memory 变长以后，检索可能变慢，旧策略还会和新任务冲突。[Adaptive Auto-Harness](https://arxiv.org/abs/2606.01770) 因此维护 harness tree，用 solve-time routing 为当前任务选择分支，证据不足时再请求人工 steering。

一份为代码仓库修复积累的强约束，放到开放网页搜索里可能过早收窄探索。为长数学推理保存的大量 memory，也会拖慢只需一次工具调用的短任务。分支与路由的作用，就是避免把这些彼此冲突的经验硬塞进同一份全局模板。

长期 Harness optimization 更接近条件选择。系统需要判断当前任务该用哪一份 Harness，旧经验何时失效。脱离模型、任务分布和运行历史去寻找一份永久最优的模板，很难成立。

## 怎样证明增益真的来自 Harness

自动 Harness Evolution 会反复读取反馈、生成候选，再回到 benchmark 上比较。观察到的提升可能同时来自 Harness 结构变化、额外搜索和 benchmark adaptation。若 baseline 只运行一次，三种来源就混在了最终分数里。

公平比较要匹配 inference 与 feedback budget。rollout 数、模型调用、token、verifier 调用、墙钟时间和费用都属于预算。起始模型、Harness、任务划分与环境版本也要一致，并加入 parallel sampling、sequential refinement 等简单 test-time scaling baseline。

“都运行十轮”仍然可能差得很远。一种方法每轮只生成一个候选，另一种方法会在几十项任务上重复采样，再让 proposer 阅读数百万 token 的 trace。若这些消耗没有报告，读者无法判断提升来自更好的程序结构，还是来自更大的搜索规模。

![Harness Evolution 的三类数据职责。search 轨迹用于提出修改，gate 分数反复决定晋升，最终 test 在搜索结束前保持独立；底部展示需要配平的预算。](/images/blog/agent-harness-boundary/evaluation-evidence.svg)

2026 年 7 月的 [重新评估研究](https://arxiv.org/abs/2607.12227) 实例化了一种 AHE 式设置，并关闭 explore agent，范围没有覆盖全部 Evolution 算法。作者在 Terminal-Bench 2.1、GPT-5.4 与 Claude Opus 4.6 上报告，它没有稳定胜过简单扩展。迁移到 held-out task 时，一个模型提高 1.2 个百分点，另一个没有提高，平均只有 0.6 个百分点。

这个结果留下了清楚的证据边界。Harness 确实会改变 Agent 表现，当前自动 Evolution 在匹配预算下发现通用结构改进的能力还没有稳定证明。search、gate 与最终 test 也不能混用。gate 即使不暴露轨迹，只要反复决定晋升，就已经参与优化。

后续方法开始处理搜索收缩与泛化。[HarnessBank](https://arxiv.org/abs/2607.13683) 保存语义上不同的高分候选，作者在七个 benchmark 上报告 5.1% 到 15.4% 的 Pass@1 增益，跨模型测试仍没有可直接移植的统一赢家。[HarnessCompass](https://arxiv.org/abs/2608.01918) 限制与具体任务绑定的修改，并加入任务 Agent 对 Harness 使用情况的反馈。它把 SWE-bench Verified 分为 50 个 evolution sample 和 450 个 held-out task，GPT-5.4 分别从 54.0% 提高到 66.0%、从 51.6% 提高到 60.4%。这些 7、8 月预印本结果仍需独立复现。

## 当前瓶颈是不会写 patch，还是不知道该改哪里

现实 Harness 的一个高层行为可能散落在多个目录、middleware、tool adapter 和少见路径里。[Harness Handbook](https://arxiv.org/abs/2607.13285) 在两个开源 Harness 上建立行为到代码的表示，再让 Agent 逐层展开到文件与符号。修改工具审批时，只改 prompt 可能漏掉 runtime 的直接执行路径，只改某个 adapter 又可能漏掉 shell 或 MCP。代码库导航由此成为 optimizer 的一项能力。

[Model or Harness](https://arxiv.org/abs/2607.28802) 将 41 类失败映射到模型、Harness、工具、memory、用户、环境和 grader 的交互边，再判断修复应落在哪里。作者报告最强自动 judge 与人工类别的一致度达到 $\kappa=0.76$。这个数字衡量分类一致性，不是修复成功率。

| 主要责任位置 | 更合适的修复对象 | 误诊后的典型结果 |
| --- | --- | --- |
| 模型能力 | model post-training 或更换模型 | Harness 规则不断加厚，困难任务仍不会做 |
| Harness 行为 | prompt、memory、middleware、控制流或验证器 | 只换模型，原有运行错误继续出现 |
| 工具接口 | schema、实现、错误语义与权限边界 | 模型被迫猜参数或把工具故障当任务失败 |
| 环境与依赖 | workspace、服务、数据和执行条件 | optimizer 针对偶发环境噪声写入永久规则 |
| benchmark 与 grader | 任务规范、测试和评分器 | 系统学会迎合错误信号 |

责任位置会直接改变修复动作。模型稳定缺少某种推理能力，持续给 system prompt 加提醒通常没有用，问题可能需要 post-training。工具 schema 返回错误时，改 prompt 只能绕开接口缺陷。环境依赖已经损坏，optimizer 若把偶发噪声写成永久规则，下一版 Harness 反而会多出新的失败面。

[Shor](https://arxiv.org/abs/2605.22505) 则用 182 个经人工确认的场景直接测 optimizer 的组件优先级判断。任务先不要求它写出整份新 Harness，只让它给 prompt、tool、memory 和 workflow 排序，判断哪一项最该改。这个工作仍标为 Work in Progress。作者报告 OpenHands-CLI 配 DeepSeek-V4-Pro 的最高 Acc@1 约为 0.305，Claude Code 配 Sonnet 4.6 的最高平均 NDCG 约为 0.793，也没有一个模型与 Harness 配置在所有领域领先。把正确组件直接告诉 optimizer 后，修复成功率明显上升。

[Evo-Bench](https://arxiv.org/abs/2608.09096) 又试图把模型本身的 Harness evolution 能力从最终 Agent 分数里拆出来。它先用辅助任务演化寻找确实对 Harness 修改敏感的任务，再做 sensitivity-aware split，并覆盖 Search、Office 和 General 三类环境。作者在九个模型上报告最高 16.6 个百分点的提升，同时发现 Search 类任务更容易，依赖特定 workflow 的 Office 任务更难，演化还经常较早饱和。

Shor 测组件优先级，Evo-Bench 测模型在敏感任务上的 Harness evolution 能力，两者都在拆开最终 Agent 分数。很多 coding agent 已经能写出 patch，薄弱处更常落在 **诊断 → 定位 → patch → 验证** 这条流程的前半段。只看修改前后的总分，很难知道系统究竟学会了哪一步。

## 2026 年究竟开始训练谁

几篇标题相近的论文，实际更新对象差得很远。有的训练修改 Harness 的 optimizer，有的训练任务模型怎样使用外部状态，ClawGym II 则通过固定黑盒 Harness 训练模型。SIA 与 Co-Harness 才把模型和 Harness 放进同一长期过程。先把关系放在同一张表里。

| 工作 | 真正更新的对象 | Harness 是否改变 | 仍然固定的外层 |
| --- | --- | --- | --- |
| [Continual Harness](https://arxiv.org/abs/2605.09998) | 持续运行中的 Harness state，并可更新模型 | prompt、sub-agent、Skill 和 memory 在线变化 | teacher、奖励协议与持续环境设置 |
| [Harness-R1](https://arxiv.org/abs/2608.02276) | 专门修改 Harness 的 9B optimizer | 生成 executable runtime patch | target、环境与 reward protocol |
| [EvoHarness-RL](https://arxiv.org/abs/2608.05446) | 任务模型使用外部状态的策略 | 状态会变，runtime 源码不变 | 状态接口与奖励设计 |
| [ClawGym II](https://arxiv.org/abs/2608.16798) | 通过黑盒 Harness 轨迹更新模型 | Claude Code、OpenClaw 保持黑盒 | Harness 与训练协议 |
| [SIA](https://arxiv.org/abs/2605.27276)、[Co-Harness](https://arxiv.org/abs/2607.22688) | 模型与 Harness | 两者都会变化 | 外层目标、评分与更新协议 |
| [TaoLive](https://arxiv.org/abs/2608.15763) | Harness 与适应 Harness shift 的模型分两路更新 | 两条路径彼此独立 | 开发者门禁与训练流程 |
| [EvolveNet](https://arxiv.org/abs/2608.04968) | 各部署的本地 Harness 与共享版本 | 通过程序 patch 聚合 | 中央聚合规则与模型设置 |

Harness-R1 训练的是 $O_\phi$。失败轨迹进入 9B engineer，候选 patch 由冻结 target 重跑，实际任务结果成为 reward。作者报告 vanilla target 从 44.3% 提高到 53.6%，已微调 target 从 59.2% 提高到 64.2%。target 更换以后要重新训练对应 engineer，因此论文没有证明一个 optimizer 能跨所有模型与 runtime 通用。EvoHarness-RL 学的是另一件事，它训练模型何时读写外部状态，作者在 ALFWorld 上报告 Qwen3-8B 达到 96.9%，状态接口和 runtime 源码仍然固定。

ClawGym II 把工业 Harness 变成训练环境。serving proxy 在模型调用边界采集多轮调用并恢复成 prefix tree，再用 PPO 或 GRPO 训练模型。Qwen3-30A3B 经 OpenClaw 和 Claude Code 训练后，作者报告 ClawGym-Bench 分别增加 9.98 和 14.81 个 Pass@1 百分点。Claude Code 没有被改写，研究者也无须复刻它的 session、权限与沙箱，工业产品在这里承担轨迹生成环境。

同一模型还可以通过多种异构 Harness 训练。这样有机会减少它对某套工具名和 prompt 模板的依赖，也会带来新的分布问题。不同 Harness 的动作语义和恢复方式并不一致，训练系统仍要判断哪些经验能够共享。

SIA 每轮由 Feedback-Agent 选择更新 scaffold 或模型参数。Co-Harness 按固定顺序先修 Harness，再用新 Harness 生成筛选后的轨迹，最后训练模型。Harness 决定训练数据怎样产生，模型更新又会改变下一轮合适的 Harness，联合更新因此带来数据漂移和信用分配问题。超过 200 小时的 autonomous case study 只能算一次案例，外层目标与评分仍然固定。

这里还有一个容易被忽略的因果关系。tool schema 写错时，高质量轨迹可能根本不会出现；重试规则过短，训练数据只会记录任务怎样提前终止。Harness 改好以后，模型能看到的数据支持集随之改变，原先到不了的行为才可能进入训练。联合更新的价值与风险都来自这层相互作用。

TaoLive 的两条路径责任分开。AI 可以聚类失败并提出 Harness 修改，开发者审查、评测和晋升；另一条 Harness-Aware Training 路径训练模型适应变化的 skills、hooks 与 tool schemas。团队报告固定 Harness SFT 让 IFEval 下降 7.7 分，这仍是团队技术报告中的受控结果。[EvolveNet](https://arxiv.org/abs/2608.04968) 则聚合各地提交的程序 patch。patch 无法像梯度那样直接平均，也可能泄露本地结构，上传 patch 本身不构成隐私证明。

## 安全研究为什么把控制交回确定性程序

[HarnessSafe](https://arxiv.org/abs/2608.06984) 关注 memory、skills、tools 和 shared artifacts 等持久载体。恶意内容可以在早期 session 进入，只被写入 memory，等后续正常请求再次检索时才触发危险动作。论文提供 328 个可执行案例和七类载体，分别观察进入、持久化、跨边界、触发与阻断。只看第一段 session 的最终回复，会漏掉整条传播路径。

阻断也可能发生在不同位置。输入过滤可以拦截进入，持久化策略可以拒绝保存，retrieval policy 能隔离不可信内容，tool policy 则在动作执行前再次检查。最终回复的一次分类无法告诉我们攻击停在哪一步，安全评测必须保留跨 session 的轨迹与环境证据。

[Safety Harness Evolution](https://arxiv.org/abs/2608.09885) 将安全责任拆进 System Prompt、Rule Bank、Safety Memory 和 Tool Policy。失败轨迹先归因，再局部更新对应 artifact，并同时检查 safety 与 utility。作者报告 ASR 降至静态 SafeHarness 的约 1/3.1。局部 artifact 让回滚更清楚，也能避免所有规则持续堆进 system prompt。

安全修改必须同时检查正常任务。过强的拒绝规则或 tool policy 会降低 attack success rate，也可能让正常请求一起失败。把普遍原则、具体失败经验和动作权限拆开，团队才能知道一次回归来自哪类 artifact。

[HarnessRisk](https://arxiv.org/abs/2608.17597) 用 128 个沙箱案例检查三个 Harness、六个模型和 14 个配置，attack success rate 从 12.6% 到 80.9%。这个跨度属于具体配置组合，不能当作某个模型的固定风险率。

| 生命周期位置 | 主要风险 | 更靠外的控制手段 |
| --- | --- | --- |
| 配置 | 初始规则、权限和默认值错误 | 配置审查、最小权限与版本绑定 |
| 能力扩展 | 新工具、skill 或 MCP 扩大动作面 | 来源验证、schema 检查与能力审批 |
| runtime | 多步执行中被诱导或误用工具 | sandbox、参数约束与实时策略 |
| 状态持久化 | memory 与共享 artifact 保存不可信内容 | 来源标记、隔离、过期和清理规则 |
| 动作控制 | 模型理解风险后仍执行危险动作 | 确定性 policy、人工批准与外部 verifier |
| 事故恢复 | 重试、回滚或取证失败 | 持久日志、reconcile、吊销与恢复演练 |

[SemaPLC](https://arxiv.org/abs/2608.18565) 将 specification、compilation 和 live runtime behavior 交给外部日志确认，Agent 不能自行宣布完成。[CTIFoundry](https://arxiv.org/abs/2608.18613) 则把 CVE、CWE、CAPEC 和 ATT&CK 做成 typed ontology graph，再通过 typed tools 与 procedural skills 暴露给固定 Harness。作者报告小模型超过使用扁平检索数据的旗舰模型，Claude 模型上的工具调用量约减半。

两项工作都在缩小模型需要临场猜测的空间。Harness 变好，有时靠更清楚的 action surface 与不可绕过的外部验证。越接近真实副作用，runtime 与确定性 policy 承担的责任越重。

## 自动循环离 RSI 还有多远

把系统状态与真正承担改进的对象记成

$$
\begin{aligned}
\Sigma_k &= (M_{\theta_k},H_{\eta_k},I_k,\mathcal Q_k,V_k,\Gamma_k,\mathcal L_k) \\
\Sigma_{k+1} &= \mathfrak R[I_k](\Sigma_k;\mathcal E_k,B_k) \\
\Sigma_{k+2} &= \mathfrak R[I_{k+1}](\Sigma_{k+1};\mathcal E_{k+1},B_{k+1})
\end{aligned}
$$

第一行包含模型、Harness、实际改进者 $I_k$、evaluation harness、评分器、晋升规则与历史 archive。$\mathcal E_k$ 汇总本代证据，$B_k$ 是预算。固定外层流程 $\mathfrak R$ 会调用 $I_k$ 完成提议、评测与晋升。若两轮始终调用同一个外部改进者，系统只是在反复自动优化。修改关系要闭合，第一轮必须产生或改变 $I_{k+1}$，下一轮也要真的由它承担改进。

能力有没有跨代增长，还需要一套不随代次改变的外部元评测。后继系统要在未见过的 target 与改进任务上工作，再比较单位计算能带来多少后续提升。固定 benchmark 上多跑几轮，只能证明系统越来越适应这批题，无法单独证明改进能力本身在增长。

| 层次 | 本轮发生的变化 | 下一轮由谁改 | 仍然固定的部分 | 合适的称呼 |
| --- | --- | --- | --- | --- |
| reflection 或 retry | 当前轨迹被重写 | 同一运行逻辑 | 模型、Harness 与改进规则 | 推理时重试 |
| 持久 memory 或 skill | 后续任务读到新状态 | 固定写入与检索机制 | 核心改进协议 | 持续适应 |
| 外部 optimizer 修改 target harness | $\eta_k$ 更新 | 外部 meta-agent | 模型、optimizer、evaluator | 自动化 Agent 设计 |
| Self-Harness | operating harness 更新 | 同一基础模型继续提议 | 权重、评测器和接受规则 | 有界自修改 |
| SICA 与 DGM | Agent codebase 或 Harness 源码更新 | 改进版本继续参与 | 基础模型以及 archive、选择和评测机制 | 一阶自指改进 |
| HSI | evolver strategy 更新 | meta-evolver | frozen backbone 与 outer anchor | 层级递归改进 |
| SIA 与 Co-Harness | Harness 和模型共同变化 | 固定外层算法 | 目标函数与评测协议 | 联合适应 |
| 强 RSI 的证据目标 | 改进者与改进能力跨代提高 | 后继系统 | 只保留必要外部约束 | 开放式递归改进 |

[SICA](https://arxiv.org/abs/2504.15228) 让 coding agent 修改自己的 Python codebase，再由改进版本继续参与后续自修改。[Darwin Gödel Machine](https://arxiv.org/abs/2505.22954) 维护 Agent archive，让候选修改自己的 Harness 代码。基础模型、archive maintenance、parent selection 和评测仍由外层掌管。论文估算一次 SWE-bench 演化运行约需两周和 2.2 万美元，部分 workflow 还会用另一种 foundation model 评估并选择多次尝试中的候选。[STOP](https://arxiv.org/abs/2310.02304) 更早让 LM 驱动的代码 improver 改进自身，作者也明确说明语言模型本身没有变化。

[Self-Harness](https://arxiv.org/abs/2606.09498) 让同一基础模型分析轨迹并修改未来使用的 operating harness。作者在三个模型与三个 benchmark 组成的九种组合里都报告提升，Qwen3.5-35B-A3B 在 AppWorld 上的最高总体相对增益为 132%。proposer 看不到 gate 轨迹，gate 分数却每轮决定候选是否晋升。它能证明修改没有只改善直接暴露给 proposer 的任务，仍不能充当完全未触碰的最终测试。模型权重、可修改范围、evaluator 和接受规则也保持固定。

它的门禁要求 search 与 gate 都不能下降，并且至少一组得到改善。这个规则降低了明显回归，也让 gate 明确参与了每轮版本选择。轨迹没有暴露给 proposer，与这组数据完全没有参与优化，属于两种强度不同的隔离。

[Recursive Agent Harnesses](https://arxiv.org/abs/2606.13643) 研究父 Harness 调用多个完整子 Harness，属于执行结构递归。Self-Harness 研究未来 Harness 怎样被修改，属于修改关系递归。[Hierarchical Self-Improvement](https://arxiv.org/abs/2608.08466) 再允许 meta-evolver 修改 evolver strategy，frozen backbone 与 outer anchor 仍然固定。论文也观察到 feedback fidelity 和 backbone capability 的上界。

这个上界在超过基础模型能力的 NLE 任务上表现得很直接，Harness evolution 没有带来改善。外层结构可以帮助模型组织已有能力，无法保证它跨过 backbone 本身没有提供的能力边界。

若把 target、外部 optimizer、evaluation harness 和人类全部装进“系统”这个词里，常见 AutoML 与 CI 优化也能被叫作 system-level self-improvement。更严格的判断会追问，改进后的 Agent 是否真的成为下一轮改进者。

| 仍缺的证据 | 需要观察什么 | 当前系统常见的固定外层 |
| --- | --- | --- |
| 后继改进权 | 改进版本是否接管下一轮提议与选择 | 原始 proposer 或固定 meta-agent |
| 评测与迁移 | evaluator 是否独立，改进能否离开反复接触的 benchmark | 固定 grader 与回归集 |
| 改进效率 | 单位计算换来的新能力是否跨代提高 | 预设搜索预算与采样策略 |
| 安全与旧能力 | 新能力出现时成本、旧能力与安全是否保持 | 外部权限、审查与停止机制 |
| 联合信用分配 | 多个对象同时变化时怎样判断贡献 | 人工设计的消融与发布门禁 |

公开研究已经展示多层、有界、参数与非参数混合的系统改进。现有系统仍依赖固定 evaluator、任务分布或外层目标，也没有证明每一代都会更擅长产生下一代改进。强 RSI 需要的证据远高于“自动循环已经运行很多轮”。

## 工业界与学术界正在相遇，完整产品仍然更宽

2026 年的论文已经碰到许多工业问题。研究对象包含工具、middleware、memory 和可执行 runtime，也开始处理大型代码定位、私有 workload、实时业务、持久状态与生命周期安全。ClawGym II 甚至直接借 Claude Code 这类黑盒产品训练模型。

工业端也在进入 L4。OpenAI 的 [Codex 公开用例](https://learn.chatgpt.com/use-cases) 已经把困难任务写成带评分的改进循环，也支持让 Codex 构建 eval。放到 Agent improvement 里，可编辑对象会包含 instructions、tools、routing、输出要求和 validation checks，traces、feedback 与 eval 随后形成下一版修改要求，再由 coding agent 实施和复验。

Anthropic 的长任务工作也经历了结构变化。早期方案用 initializer 拆任务，coding agent 每次推进一项，再用跨 session artifact 交接。后来的方案加入 planner、generator 和 evaluator，使用结构化任务与交接材料；模型换成 Opus 4.5 后，原先为 Sonnet 4.5 准备的 context reset 又被删掉。工业团队也在观察失败、修改 Harness 和重新验证，只是还要把版本发布、真实用户和故障责任一起算进去。

多数论文公开的可修改范围仍集中在 prompts、skills、memories、tools、middleware、workflow、validators 和少量 runtime code。完整产品还要承担 durable session、多客户端同步、authentication、tool approval UX、sandbox lifecycle、断线恢复、并发隔离、协议兼容、telemetry、canary、回滚、配额和成本控制。

因此，2026 年的学术 Harness 已经从行为层切片扩展到部分真实 runtime，完整产品平台仍有大量责任没有进入搜索空间。ClawGym II 的黑盒路径提供了一个实用折中。研究者无须复刻 Claude Code 的每一层工程责任，也能研究真实 Harness 产生的训练轨迹。

两边由此靠近同一套改进过程。系统先执行任务，记录失败和环境结果，再定位原因、修改模型外部程序，随后验证和发布。工业团队要让它长期、安全、低成本地服务真实用户。学术研究需要控制变量，证明某种优化机制确实有效。

若按研究对象回看这两年，边界移动的顺序已经很清楚。最初进入搜索的是 Harness 程序 $\eta$，随后是提出修改的 $O_\phi$。研究者接着训练模型怎样读取和采用 Harness，又让 Harness 产生经过验证的模型训练轨迹。模型与 Harness 后来被放进同一长期更新过程，安全研究则把配置、持久状态、动作控制和事故恢复一起纳入评测。每次范围扩张都会留下新的固定外层。修改者进入训练以后，reward protocol 仍由人设计；模型与 Harness 一起更新以后，evaluator 和发布门禁仍要保持可靠。

## 看下一篇 Harness 论文时，我会先问这些问题

先看可修改范围。论文究竟只改 prompt，还是会碰工具、memory、middleware、控制流、verifier、runtime 或整个代码目录。名称相同，搜索空间可能差几个数量级。

接着找提出修改的人。当前任务 Agent、同一基础模型的另一次调用、更强外部模型和人类工程师，对“自我改进”的含义完全不同。若新版本没有负责下一轮改进，自指关系仍然没有成立。

Evaluator 应该和 optimizer 分开。搜索用过哪些 public task，最终报告是否仍用同一批数据，held-out task 和 regression suite 是否保持独立，这些信息比 Self-Evolving 之类命名更有判断力。

预算也要配平。Harness Evolution 读取了多少失败轨迹，生成了多少候选，额外调用了多少模型，都应该和 parallel sampling、sequential refinement 等简单方法放在同一 feedback 和 inference budget 下比较。

最后看迁移。修改能否跨任务、模型和版本成立，成本、延迟、可靠性和安全怎样变化，原有能力有没有回退。只在一组搜索任务上分数上涨，很难说明得到了一条可复用的 Harness 设计原则。

把现有证据放在一起看，几项判断可以同时成立。多项受控配置显示，Harness 能显著改变 Agent 表现，现有自动 Harness Evolution 的通用性仍缺稳定证据。AHE 的消融支持 tools、middleware 和 long-term memory 的贡献，AutoHarness 展示 action filter 与 code policy 的控制权差异，SemaPLC 和 CTIFoundry 则支持外部验证与 typed action surface 的价值。当前证据仍没有给出一份跨模型、任务和预算通用的最优 Harness，条件一变，原来的设计就可能变成负担。

接下来的突破大概会出现在一条更完整的链上。系统要先诊断失败，找到行为对应的代码位置，做局部且可回滚的修改，再用匹配预算、跨任务和安全回归去验证。模型也要学会使用变化中的 Harness，并从 Harness 产生的已验证轨迹里继续训练。

Agent Harness 已经由固定工程配置进入学习系统。公开研究目前能支持的是有界的、多层系统改进。强 Recursive Self-Improvement 还在更远的位置。

## 建议阅读顺序

- **建立主线**　[VeRO](https://arxiv.org/abs/2602.22480)、[AutoHarness](https://arxiv.org/abs/2603.03329)、[Meta-Harness](https://arxiv.org/abs/2603.28052)、[AHE](https://arxiv.org/abs/2604.25850)、[Harness-Bench](https://arxiv.org/abs/2605.27922) 和 [匹配预算评测](https://arxiv.org/abs/2607.12227)

- **训练与递归**　[Harness Updating](https://arxiv.org/abs/2605.30621)、[Self-Harness](https://arxiv.org/abs/2606.09498)、[Harness-R1](https://arxiv.org/abs/2608.02276)、[ClawGym II](https://arxiv.org/abs/2608.16798)、[SIA](https://arxiv.org/abs/2605.27276)、[Co-Harness](https://arxiv.org/abs/2607.22688)、[HSI](https://arxiv.org/abs/2608.08466) 和 [TaoLive](https://arxiv.org/abs/2608.15763)

- **安全与工业运行**　[HarnessSafe](https://arxiv.org/abs/2608.06984)、[Safety Harness Evolution](https://arxiv.org/abs/2608.09885)、[HarnessRisk](https://arxiv.org/abs/2608.17597)、[SemaPLC](https://arxiv.org/abs/2608.18565) 和 [CTIFoundry](https://arxiv.org/abs/2608.18613)

## 主要来源

- [OpenAI 对 Codex Harness 与平台边界的说明](https://learn.chatgpt.com/blog/codex-as-a-platform)
- [OpenAI 对 Skills、Shell 与 Compaction 的实践说明](https://developers.openai.com/blog/skills-shell-tips)
- [OpenAI 把 Skill 运行轨迹转成评测的方法](https://developers.openai.com/blog/eval-skills)
- [OpenAI 的 Codex 与评测用例](https://learn.chatgpt.com/use-cases)
- [Anthropic 对 workflow、agent 与控制权的区分](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic 的 Agent context engineering 方法](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic 的跨上下文长任务 Harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Anthropic 对 evaluation harness 与 agent harness 的区分](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Claude Code 的 Agent loop、状态与运行入口](https://code.claude.com/docs/en/how-claude-code-works)
- [Anthropic 的长任务 Harness 设计与模型版本变化](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Anthropic Managed Agents 对 session、Harness 和 sandbox 的拆分](https://www.anthropic.com/engineering/managed-agents)
- [LangChain 对 Agent Harness 的宽口径拆解](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness)
- [LangChain 对 Harness 与 production runtime 的切分](https://www.langchain.com/blog/runtime-behind-production-deep-agents)
- [LangChain 从 production trace 建立 Agent eval 的方法](https://www.langchain.com/blog/agent-observability-powers-agent-evaluation)
- [VeRO 论文](https://arxiv.org/abs/2602.22480)
- [Agentic Harness Engineering 论文](https://arxiv.org/abs/2604.25850)
- [Harness-Bench 论文](https://arxiv.org/abs/2605.27922)
- [自动 Harness Evolution 的匹配预算评测](https://arxiv.org/abs/2607.12227)
- [Harness-R1 论文](https://arxiv.org/abs/2608.02276)
- [ClawGym II 论文](https://arxiv.org/abs/2608.16798)
- [HarnessSafe 论文](https://arxiv.org/abs/2608.06984)
- [HarnessRisk 论文](https://arxiv.org/abs/2608.17597)
