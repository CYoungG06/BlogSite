# Agent Harness 的两个世界，工业界在做什么，学术界在研究什么

> 2026-08-21

把 Claude Code 和 AutoHarness 放在同一篇文章里，Harness 这个词会显得有些奇怪。

Claude Code 要处理会话状态、上下文压缩、工具调用、权限、沙箱、恢复和不同客户端的交互。AutoHarness 在一组游戏实验里生成的 Harness，有时只负责过滤非法动作，再往前一步，它甚至会生成一份完整的代码策略，决策时不再调用语言模型。两者承担的责任差了几个数量级，却都被叫作 Agent Harness。

把近两年的论文和产品资料放在一起看，最先碰到的问题是，Harness 并没有一个天然固定的大小。它更像一条系统边界。工业界按照产品需要承担的责任划这条边界，学术界按照实验中允许修改的变量划边界。到了 2026 年，学术研究又在不断扩大可编辑范围，从 prompt、工具和 memory 进入 runtime、Harness optimizer、模型训练、安全和真实工业环境。

这个词目前还没有一套公认的接口标准。有人用它指 system prompt 外加工具定义，有人指一整套 agent loop，也有人直接把可运行的 coding agent 产品叫作 Harness。它们能共享名称，靠的是相近的拓扑位置。模型在一边，外部环境在另一边，中间那套安排观察、动作、状态和验证的程序，都可以落入这个概念。至于程序究竟包到哪一层，要看说话的人正在承担产品责任，还是正在控制一个实验变量。

这条边界怎样划，决定了 Codex、Claude Code 和论文里的 action filter 为什么能共享一个名称，也决定了许多所谓 Harness Evolution 离 Recursive Self-Improvement 究竟还有多远。

## 先给 Harness 画一条能工作的边界

一次 Agent 执行大致分成四步。Harness 先构造模型这一步看见的上下文，里面可能有 system prompt、文件、历史、长期记忆、检索结果和工具返回。模型生成输出以后，Harness 再把它转成环境能够执行的动作，包括工具解析、参数检查、路由和权限判断。动作发生以后，它还要更新状态，决定怎样保存轨迹、压缩上下文、重试、回滚或终止。终端、代码目录、浏览器和数据库则是 Agent 实际作用的环境。

按这个定义，Agent Harness 是模型参数之外的一套可执行程序。它负责组织观测、动作、控制流和状态，也负责判断结果能否被接受。再换成日常说法，它管模型能看到什么、能够做什么，多步执行怎样继续，以及哪些信息能留到下一步或下一次会话。

把这套职责写得稍微形式化一些，可以将第 $k$ 代 Harness 的持久设计快照记作 $\eta_k$，它包含纳入版本控制或晋升流程的源码、配置、memory policy 和长期 artifact。当前执行中随步骤变化的 memory 内容、checkpoint 和重试计数另记为运行时状态 $r_t$。普通评测会重置 $r$，持续任务也可以在同一 $\eta_k$ 下把它带到下一项任务。某份状态只有被保存、审查并晋升，才进入 $\eta_{k+1}$。四组核心函数可以合写成 $H_\eta=(C_\eta,P_\eta,U_\eta,S_\eta)$。

其中，$C_\eta$ 构造模型上下文，$P_\eta$ 把模型输出解析成候选动作并做权限或格式检查，$U_\eta$ 根据环境返回更新运行时状态，$S_\eta$ 判断本轮应该继续、成功、失败，还是等待外部确认。令 $x$ 为任务，$w_t$ 为外部环境状态，$\tau_{<t}$ 为本步开始前的轨迹，$\bar\tau_{\le t}$ 为加入 $d_t$ 之前已经写入记录的本步上下文、输出、动作、观察和状态。一次执行可以写成

$$
\begin{aligned}
c_t &= C_\eta(x,o_t,r_t,\tau_{<t}) \\
z_t &\sim M_\theta(\cdot\mid c_t) \\
a_t &= P_\eta(z_t,r_t) \\
(w_{t+1},o_{t+1}) &\sim \mathcal{W}(\cdot\mid w_t,a_t) \\
r_{t+1} &= U_\eta(r_t,z_t,a_t,o_{t+1}) \\
d_t &= S_\eta(x,r_{t+1},\bar\tau_{\le t})
\end{aligned}
$$

这里特意把环境记作 $\mathcal{W}$，把评测系统留给后文的 $\mathcal Q$，避免同一个字母承担两种职责。$d_t$ 也没有被简化成模型的一句“完成了”。它可以依赖 target Harness 可见的测试结果、文件是否真的存在、编译日志、运行时 validator 或人工审批。后文的隐藏 benchmark scorer $V$ 属于评测侧，不应作为 $S_\eta$ 的输入，以免泄漏最终评分信号。SemaPLC 一类工作后来重新强调外部验证，追到最小执行循环里，位置就在这一项。

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

Codex 和 Claude Code 通常横跨 L1、L2，并带有大量 L3 能力。论文里的 target harness 常集中在 L1 和少量 L2，论文新提出的方法则经常位于 L4。完整产品更适合写成下面这个组合。

$$
Agent\ Product=Model+Behavioral\ Harness+Runtime+Product\ Shell
$$

这里的等号只表示责任组成，不表示四个可以直接相加的数值。

日常讨论把完整产品叫作 Harness，原因也不难理解。模型相同的情况下，用户能直接感受到的很多差异，正是周围这套程序造成的。

可以沿着一次普通的代码修复看看这五层怎样接在一起。L1 决定 Agent 读到哪些仓库说明、历史消息和工具 schema，也规定它怎样编辑文件、运行测试。模型发出命令后，L2 创建进程、隔离工作目录、保存输出，并在中断以后恢复 session。命令需要联网或越过当前权限时，L3 将审批请求交给客户端，再把决定同步回运行中的任务。测试结果进入轨迹以后，L4 才能比较候选修改、检查回归并决定是否晋升新版本。L0 的模型一直参与决策，周围四层却分别决定它得到什么信息、能够把决定落实到哪里，以及系统凭什么相信任务已经完成。

## 工业 Harness 先要把任务可靠地跑完

OpenAI 在 2026 年 8 月发布的 [Codex 平台介绍](https://learn.chatgpt.com/blog/codex-as-a-platform) 里，把 Harness 直接描述为模型周围的执行系统。它要维持上下文，调用工具，暴露进度，处理失败，在必要时请求人工批准，并把工作带到后续回合。Codex 的 app-server 又把 thread、turn、事件流和审批请求做成可接入的客户端协议。

同一篇文章也保留了宿主应用的责任。Codex app-server 提供 agent loop 与沙箱执行，接入方仍要掌管产品界面和业务上下文，并决定应用自有工具、用户同意边界与事实记录落在哪里。嵌入一套成熟的 Harness 以后，推理和执行流程可以复用，业务上的最终裁决权仍留在宿主系统。这是工业边界里很关键的一刀，Harness 负责让 Agent 行动，产品负责说明这次行动在具体业务里是否有权发生。

这里已经能看见工业 Harness 的两种口径。窄口径指协调用户、模型和工具的 agent loop。宽口径还会包含 thread 的创建、恢复、分叉与持久化，配置和认证，沙箱中的工具执行，MCP、skills、审批，以及多个客户端之间的状态同步。

LangChain 的两篇官方文章把这种浮动表现得更直接。[The Anatomy of an Agent Harness](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness) 采用很宽的分析口径，把模型之外的 prompts、tools、filesystem、sandbox、orchestration 和 middleware 都算进 Harness。随后讨论生产架构的 [The Runtime Behind Production Deep Agents](https://www.langchain.com/blog/runtime-behind-production-deep-agents) 又把边界收窄，将 prompts、tools、skills 与 model-tool loop 归入 Harness，把 durable execution、checkpoint、长期存储、多租户和可观测性放进下方的 runtime。两种划法服务于不同问题。前一篇在解释 Agent 由哪些部分组成，后一篇在确定生产模块由谁拥有。连同一团队都会按概念说明或部署架构重新切边界，阅读任何 Harness 材料时，最好先问作者正在定义整个系统，还是某个可独立维护的模块。

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

学术论文面对的是另一种约束。研究者要固定尽可能多的条件，再观察某项修改是否带来变化。环境、模型和预算经常被固定，只留下 prompt、工具、memory、workflow、action validator 或 verifier 作为 editable surface。

很多今天被归入 Harness 的研究，原来使用别的名称。SWE-agent 在 2024 年谈 Agent-Computer Interface，研究文件编辑、代码目录导航和测试接口怎样改变 Agent 表现。[ADAS](https://arxiv.org/abs/2408.08435) 把 Agent 写成代码，让 meta-agent 自动发明 prompt、工具使用和 workflow。[AFlow](https://arxiv.org/abs/2410.10762) 把 workflow 写成代码图，再用 Monte Carlo Tree Search 搜索。scaffold、workflow、agent architecture、ACI、context engineering 和 tool orchestration，后来逐渐汇到 Harness 这个词下面。

这个汇合也让 Harness 形成了一条很长的尺寸连续谱。最小的一端可能只有 system prompt 或 tool schema，往外可以加入 action validator、context policy 和 memory policy，再往外是完整 agent loop。加入 sandbox、session、协议与多客户端交互以后，它已经接近产品 runtime。名称本身无法告诉我们作者改了多大一块。读论文时更可靠的入口是 editable surface，先看哪些文件和组件允许变化，再看其余条件怎样固定。

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

## 2026 年，原本固定的部分开始进入优化范围

为便于比较不同研究，本文统一使用下面这套分析记号。它们并非这些论文共同使用的标准记号。

理解 2026 年的工作，可以先摆出四个主要对象。$M_{\theta_k}$ 表示第 $k$ 代基础模型，$H_{\eta_k}$ 表示执行任务的 target harness，$O_{\phi_k}$ 表示读取证据并提出 Harness 修改的 optimizer，$\mathcal Q$ 表示隔离运行、任务调度、记录和预算控制所组成的 evaluation harness。$\mathcal Q$ 内部还要区分 verifier 或 scorer $V$，以及控制晋升和回滚的规则 $\Gamma$。

下标也承担不同含义。$t$ 是一次 rollout 内的交互步，$k$ 是持久改进的代次，$i$ 表示任务，$s$ 表示随机种子或重复 rollout，$j$ 表示 Harness 候选。共同的执行底座可以写成

$$
\tau_{k,i,s}
=
\operatorname{Run}_{\mathcal Q}
\left(M_{\theta_k},H_{\eta_k},x_i,\mathcal W;\xi_{k,i,s},b_{k,i,s}^{\mathrm{run}}\right)
$$

$\xi_{k,i,s}$ 收拢模型采样和环境随机性，$b_{k,i,s}^{\mathrm{run}}$ 是这一条轨迹的预算。$B_k$ 留给整代总预算，所有运行、反馈、门禁和训练消耗都要从中支出。

在这层之上，论文会选择不同的外环。

$$
\begin{aligned}
\eta_{k+1} &= \operatorname{Update}_H(\eta_k;O_{\phi_k},\mathcal T_k,\mathcal Q,V,\Gamma) \\
\phi_{k+1} &= \operatorname{Train}_O(\phi_k,\mathcal Z_k^O) \\
\theta_{k+1} &= \operatorname{Train}_M(\theta_k,\mathcal Z_k^M)
\end{aligned}
$$

三行分别表示改 Harness、训练 Harness optimizer 和更新模型。第一行的 $\operatorname{Update}_H$ 是候选提议、隔离评测和版本晋升的简写，因而显式读取 $O_{\phi_k}$ 与 $\mathcal Q$。它们是可以单独出现或组合的研究路径，不是一代系统必然依次执行的三道工序。Meta-Harness 主要走第一行，Harness-R1 进入第二行，ClawGym II 主要走第三行。Co-Harness 才把第一行产生的新轨迹送进第三行，形成明确的双环关系。

从评测角度看，一条轨迹属于模型和 Harness 的联合分布。可以把有序配置记作 $\mathcal A_{\theta,\eta}\equiv(M_\theta,H_\eta)$，相应轨迹服从受 evaluation harness 与运行预算约束的 $p_{\theta,\eta}^{\mathcal Q,b}(\tau\mid x,\mathcal W)$。模型权重相同，$\eta$ 改变以后，上下文、动作空间、状态保存与停止条件都会变化，轨迹分布也随之变化。Harness-Bench 后来主张把能力报告到 model-harness configuration 这一粒度，形式上指的就是 $\mathcal A_{\theta,\eta}$ 这一整个配置，而非只写一个模型名字。

工业系统也很少只优化单一分数。可以把表现写成一个指标向量。

$$
\begin{aligned}
\mathbf m(x,\tau)=V(x,\tau)
&=\big(V_{\mathrm{task}}(x,\tau),-\mathrm{Cost}(\tau),-\mathrm{Latency}(\tau),\\
&\qquad \mathrm{Safety}(x,\tau),\mathrm{Reliability}(x,\tau)\big) \\
\mathbf J_{\mathcal Q}(\theta,\eta;\mathcal D,\mathcal W,V,B)
&=\mathbb E_{\substack{x\sim\mathcal D\\
\tau\sim p_{\theta,\eta}^{\mathcal Q,B}(\cdot\mid x,\mathcal W)}}[\mathbf m(x,\tau)]
\end{aligned}
$$

这里的随机性还包含模型采样和环境种子，$B$ 限定推理与反馈预算。论文常从这个向量里选一两个维度作为主要结果，产品需要在约束下寻找可以发布的配置。Meta-Harness 直接使用 Pareto frontier 处理准确率与上下文成本，也说明 Harness 搜索天然可能是多目标问题。

外层循环还要把候选和当前版本分开。令 $\mathcal L_k$ 保存历史代码、轨迹和评测结果，$\mathcal D_{\mathrm{search}}$ 产生修改证据，$\mathcal D_{\mathrm{gate}}$ 反复承担回归门禁，一次 Harness 更新可以写成

$$
\begin{aligned}
\mathcal T_k &= \{\tau_{k,i,s}\mid x_i\in\mathcal D_{\mathrm{search}}\}_{i,s},
\qquad \sum_{i,s}b_{k,i,s}^{\mathrm{run}}\le B_k^{\mathrm{trace}} \\
\delta_{k,j} &\sim O_{\phi_k}(\cdot\mid \eta_k,\mathcal L_k,\mathcal T_k) \\
\widetilde\eta_{k,j} &= \operatorname{Apply}(\eta_k,\delta_{k,j}) \\
\widehat{\mathbf m}_{k,0} &= \operatorname{Eval}_{\mathcal Q}(M_{\theta_k},H_{\eta_k},\mathcal D_{\mathrm{gate}},\mathcal W,V;b_{k,0}^{\mathrm{gate}}) \\
\widehat{\mathbf m}_{k,j} &= \operatorname{Eval}_{\mathcal Q}(M_{\theta_k},H_{\widetilde\eta_{k,j}},\mathcal D_{\mathrm{gate}},\mathcal W,V;b_{k,j}^{\mathrm{gate}}) \\
\eta_{k+1} &= \operatorname{Promote}_\Gamma(\eta_k,\widehat{\mathbf m}_{k,0},\{\widetilde\eta_{k,j},\widehat{\mathbf m}_{k,j}\}_j)
\end{aligned}
$$

当前版本和候选使用同一模型、环境与 gate 任务，重复运行采用配对种子和匹配的单配置预算，当前版本与各候选的门禁预算加总后不能越过 $B_k^{\mathrm{gate}}$。这组记号把 meta-harness 和 optimizer 分开了。$O_\phi$ 负责提议，$\mathcal Q$ 负责运行与保存证据，$V$ 产生任务指标，$\Gamma$ 比较候选和当前版本，才决定新版本是否生效。VeRO 更接近容纳这套过程的 outer 或 evaluation harness，Shor 评测 optimizer 能否找对修改优先级，它们都不等于被训练或被搜索的 $O_\phi$。

![模型、Harness、Optimizer 与 Evaluator 的改进回路。实线表示执行和候选晋升，回流表示训练模型或训练 Harness Engineer，虚线外框里的任务分布、奖励协议与人工审批在很多实验中仍保持固定。](/images/blog/agent-harness-boundary/four-object-loop.svg)

沿着被更新的对象，2026 年的工作可以先分成五类。

| 研究问题 | 主要被研究或测量的对象 | 仍需单独观察的对象 | 代表工作 |
| --- | --- | --- | --- |
| Harness 设计与搜索 | $H_\eta$ | 固定模型、评测协议和任务分布 | AutoHarness、Meta-Harness、AHE |
| Optimizer 评测与训练 | $O_\phi$ 的诊断或编辑能力 | target harness 与 evaluation harness | VeRO、Shor、Harness-R1 |
| 模型怎样使用 Harness | $M_\theta$ 对外部状态和 artifact 的采用 | Harness 是否真的被激活 | Harness Updating、EvoHarness-RL |
| 模型与 Harness 联合适应 | $(\theta,\eta)$ 的更新关系 | 外层目标和更新算法 | SIA、Co-Harness、Continual Harness |
| 评测、安全与发布约束 | $\mathcal Q$、$V$、$\Gamma$ | optimizer 与 grader 的独立性 | Harness-Bench、Evo-Bench、HarnessSafe |

人工设计 Harness、自动修改 Harness、训练专门的修改者、通过 Harness 产生训练轨迹、让模型适应变化的 Harness，这几步构成了 2026 年研究范围扩张的主线。论文标题可能相似，每一步的学习关系并不相同。

这四个对象比按月份列论文更有用。VeRO 和 Shor 服务于 optimizer 的评测，却不等于 optimizer 本身。SIA 和 Co-Harness 把模型与 Harness 放入同一长期更新过程。TaoLive 同时包含两条彼此独立的路径，一条由开发者审查后晋升 Harness 修改，另一条用 Harness-Aware Training 训练模型适应变化的 Harness 分布。ClawGym II 则通过固定的黑盒 Harness 训练模型。若把这些关系都称为联合自动演化，很多关键差别会消失。

2026 年 7 月和 8 月的大量工作仍是刚发布的 arXiv 预印本。下面出现的实验数字都来自论文作者报告。VeRO 已被作者列为 ICML 2026 接收，其余新结果大多还缺少独立复现。

## 固定的 Harness 程序成为可编辑变量

年初的 BioAgent Bench，以及 Terminal-Bench 这一类评测工作里，Harness 主要还是测试执行器、sandbox、validator 和日志系统，研究对象是被测 Agent。[VeRO](https://arxiv.org/abs/2602.22480) 随后把问题改成怎样评测 Agent 优化另一个 Agent。它的完整标题是 A Harness for Agents to Optimize Agents。VeRO 没有提出某个固定的最强 optimizer，而是给 Agent 优化建立外层实验条件。版本化快照、预算控制、结构化轨迹、下游结果和 target-agent benchmark，让 coding agent 修改另一个随机 Agent 程序这件事可以被重复比较。VeRO 把确定性代码和随机模型调用混合在一起的对象纳入软件优化实验，也让 target、optimizer 与 evaluation harness 的区别清楚起来。

[AutoHarness](https://arxiv.org/abs/2603.03329) 展示的是 editable surface 的另一端。Gemini-2.5-Flash 自动合成代码 Harness，作者报告它消除了 145 个 TextArena 游戏中的非法动作。进一步让模型生成完整 code policy 后，决策阶段甚至不需要 LLM。这个结果把 Harness 与 policy 的边界直接推到眼前。位于模型和环境之间的 action filter 很容易被视作 Harness，一份完全替代模型决策的代码则更接近 policy。

可以把这条连续谱拆成三个位置。第一种程序只过滤非法动作，模型仍决定下一步做什么。第二种程序根据环境状态生成合法候选，再由模型选择或解释，决策权已经在两侧分担。第三种程序直接产出完整动作序列，模型退出实际决策阶段。程序都位于模型与环境之间，功能归属却已经变化。代码量和“智能程度”都无法单独划界，谁在产生任务策略、谁只负责约束与执行，才决定它更接近 policy 还是 Harness。

同一个研究方向因而会出现很窄和很宽的 Harness。action filter 的研究价值在于动作面能否被可靠约束，完整 runtime 的研究价值还包括状态、恢复和工具生命周期。尺度不同并不构成高低关系，实验问题本来就不同。

[Meta-Harness](https://arxiv.org/abs/2603.28052) 把整个 Harness 代码空间交给 proposer。它可以通过文件系统查看候选源码、分数、历史轨迹和失败信息，再提出新版本。这里的信息没有被压成一句 textual feedback，优化器能够像代码工程师一样检查完整实现和执行证据。作者在线分类、数学推理和 TerminalBench-2 上报告改进；检索增强数学推理实验里，一个发现的 Harness 还能迁移到五个 held-out model。Harness optimization 由自动调 prompt 向 repository-level software engineering 迈了一步。

文件系统在这里不只是存档方式，它改变了优化器能够提出哪类判断。一次评测最多可能产生约一千万 token，无法全部塞进 proposer 的当前上下文。proposer 会用搜索和文件读取主动选择证据，比较二十多个旧候选，追查某次状态更新怎样在许多步以后导致失败。论文的消融也显示，只给分数或再加一份摘要，效果远低于允许查看原始轨迹的完整接口。对 Harness 这种长时程程序，过早压缩反馈会把信用分配所需的因果线索一起压掉。

Meta-Harness 的外层过程仍然很朴素。它保存候选群体和 Pareto frontier，让 proposer 自己选择参考哪个历史版本，再用 search set 评估新代码。最终 test set 不提供给 proposer。这个设计把搜索启发式压到最低，同时把很大的判断权交给 coding agent。代价也清楚，候选 Harness 可以很短，围绕它积累的文件、轨迹和评测成本却很大。

[Natural-Language Agent Harnesses](https://arxiv.org/abs/2603.25723) 处理可移植性。它把高层控制逻辑外化为结构化自然语言工件，写清 contracts、roles、stage structure、state semantics、failure taxonomy，以及 permission、retry 和 stop rule，再由共享的 Intelligent Harness Runtime 执行。测试、lint、scraping 和 verification 继续交给确定性脚本。论文主动把可编辑的 pattern layer 与 runtime 分开，也说明 Harness 和 runtime 的界线往往是实验设计做出的选择。

这种表示法解决的是比较问题。若两套系统把相同策略分别藏在 Python controller、tool adapter 和默认配置里，研究者很难判断差异来自策略还是实现。NLAH 把 contracts、roles、adapters、状态语义和失败处理显式化，底层 runtime 只负责按共同协议执行。自然语言层因此成为可移动、可审查的实验对象，lint、抓取和验证仍由确定性代码承担。它没有消除 Harness 与 runtime 的边界争议，只是把边界写进了系统接口。

[Agentic Harness Engineering](https://arxiv.org/abs/2604.25850) 进一步强调可观测性。组件种类很多，轨迹可能达到数百万 token，修改和结果之间又缺少可靠归因。AHE 因此给每个可编辑组件明确、可回滚的文件表示，把长轨迹整理成能逐层查看的证据，并要求每次修改先声明预期效果，等下一轮结果回来再核对。作者报告十轮后 Terminal-Bench 2 pass@1 从 69.7% 升到 77.0%，冻结后的 Harness 在跨模型测试中也得到增益。消融里，主要收益来自 tools、middleware 和 long-term memory，单独替换 system prompt 反而下降。

AHE 所说的 component observability，首先解决修改对象不清的问题。system prompt、tool description、tool implementation、middleware、skill、sub-agent configuration 和 long-term memory 都有明确文件表示。一次逻辑修改对应一份可查看的 diff，效果不好时也能在同一粒度回滚。很多 prompt-only 方法避开了代码耦合，代价是大量真实失败面从未进入搜索空间。

experience observability 处理轨迹规模。原始运行记录先整理成分层证据，evolver 可以从失败类别往下钻到单项任务，再继续看具体消息和工具结果。这个过程没有把所有经验压成一段“请加强检查”的文字。证据保留到能够定位行为，模型只在需要时继续展开。

decision observability 让每次修改都带上一份可以核验的预测。evolver 说明自己要修哪类失败、预期哪些任务受益，也要记录可能的回归。下一轮结果回来以后，系统检查先前判断，再决定保留或撤销文件级修改。论文把这种做法称作可证伪的修改合约。它仍有明显缺口，作者对回归预测的分析显示，系统解释修复理由的能力强于预见哪些任务会被新规则伤害。自动修改已经进入真实程序结构，可靠的 regression foresight 仍然落在更外层。

这一组工作共同扩大了 Harness 的研究对象。研究者开始处理完整代码、组件定位、历史证据和真实运行机制，Harness 逐渐脱离“一份更长的 system prompt”这种窄理解。

## 模型和 Harness 的组合进入能力测量

[Harness-Bench](https://arxiv.org/abs/2605.27922) 用 106 个离线沙箱任务和 5,194 条轨迹，在共同任务、预算和评测协议下比较不同 model-harness configuration，同时保留各 Harness 原本的运行行为。完成率、过程质量、成本和失败方式都会随组合变化。论文据此主张，Agent capability 应报告到模型和 Harness 配置这一粒度。

这类比较要同时保留共同条件和产品差异。初始工作区、任务预算、超时与 evaluator 保持一致，各 Harness 原生的 prompt、工具接口、状态管理和恢复行为则继续存在。若把后面这些差异全部抹平，比较对象也就失去了 Harness 特征。论文将 Codex 单独列作 model-bound coding agent，原因也在这里。它无法像可配置 Harness 那样被放进同一组后端模型矩阵，只能作为实用参照。

在固定模型、任务、环境、verifier 和预算的前提下，一次 Harness effect 就是 $\eta_a$ 与 $\eta_b$ 两种配置的指标差。比较条件不能省。模型 $\theta$、任务分布 $\mathcal D$ 和预算 $B$ 一变，差值也可能换方向。leaderboard 只公布模型名和最终分数，会把 Harness 引起的差异错误地归给模型。

一篇立场论文 [Stop Comparing LLM Agents Without Disclosing the Harness](https://arxiv.org/abs/2605.23950) 把这个判断推得更远。作者称之为 Binding Constraint Thesis，认为在一部分长时程任务里，Harness 带来的方差可能高过替换模型，甚至会改变模型排名。这个结论目前来自 position paper 和有限控制实验，适合用来要求 leaderboard 披露 context construction、tool interaction、orchestration 和 verification，尚不足以推广到所有 Agent 任务。

[Harness Updating Is Not Harness Benefit](https://arxiv.org/abs/2605.30621) 又把自演化能力拆成两件事。harness-updating 指模型能否根据轨迹产生有用的持久修改，harness-benefit 指执行任务的 Agent 能否激活、理解并遵循这些修改。作者发现，不同能力层级模型产生的更新效果相当接近，Qwen3.5-9B 生成的更新可以接近 Claude Opus 4.6。任务 Agent 从 Harness 中获得的收益与模型强度没有单调关系。弱模型可能找不到相关 artifact，也可能找到了却执行不好。

把过程再拆细，任务 Agent 要先判断当前问题是否需要某项 skill 或 memory，随后正确读取其中规则，执行期间还要持续遵循。任何一道门没有通过，保存下来的 Harness 知识都不会出现在最后结果里。这个区别与普通文档质量很像。文档写得准确，只能说明信息存在；系统能否在合适时机找到它并据此行动，还取决于读取与执行协议。

realized benefit 则比较任务模型使用修改前后 Harness 的实际指标。$H'$ 的文字或代码质量无法单独决定这个差值。任务模型、检索入口、调用条件和长程遵循共同参与。更新者很强而执行者较弱时，系统可能不断写出好 artifact，却很少实际使用。这个结果也给模型训练指出了一个独立目标，Agent 需要学习 Harness invocation 和 adoption，不能只训练任务答案。

这给工业系统一个很实在的提醒。昂贵模型未必需要放在 evolver 位置，任务模型却要学会 Harness invocation、skill selection 和长程指令遵循。文件写得再好，模型不读、不选或不照着做，它就没有兑现为实际能力。

## 单一 Harness 遇到持续任务流

[Continual Harness](https://arxiv.org/abs/2605.09998) 把问题放进不重置的长期环境。Agent 在同一次持续运行中修改 prompt、sub-agents、skills 和 memory，并从过去轨迹继续适应。它还给出 model-harness co-learning 路径。Harness state 在一次持续运行内部更新，迭代之间则由 process reward model 给轨迹窗口评分，frontier teacher 重标低奖励片段，再用 soft SFT 更新开放模型权重。

不重置改变了 Harness 的时间尺度。传统 benchmark 为每道题恢复干净环境，旧经验最多通过一份预先写好的 prompt 进入。持续任务流会让成功方法、错误判断和过期规则一起留下。memory 越积越多，检索可能变慢，旧策略还会和新任务冲突。Harness 在这里已经接近一份会随运行改变的状态程序，评价也要观察它长期是否退化。

[Adaptive Auto-Harness](https://arxiv.org/abs/2606.01770) 则指出，一份 Harness 在开放任务流中不断累加，可能先变好，随后因历史过长、任务异质和分布变化而退化。它维护 harness tree，用 solve-time routing 为当前任务选择分支，信号不足时再允许人工 steering。这个设计更接近条件化的 Harness 选择，统一静态模板不再承担所有任务。

它使用 stateful multi-agent evolver 维护这棵树。新经验不必一律合并进唯一主干，可以进入适合某类任务的分支。执行时的 router 根据当前问题选择路径，遇到证据不足或新分布时再请求人工 steering。这样做承认了一个现实。一份针对仓库修复积累的强纪律，未必适合开放网页搜索；为长数学推理准备的 memory，也可能拖慢短工具任务。

因此，长期 Harness optimization 更接近条件选择问题。系统要学习当前任务应该调用哪一份 Harness，何时创建新分支，哪些旧经验已经失效。单纯把所有成功提示追加进同一个文件，早期可能有效，运行久了很容易变成 dense accumulation。

## 额外搜索预算也进入比较

自动 Harness Evolution 的正面结果很多，2026 年 7 月的 [重新评估研究](https://arxiv.org/abs/2607.12227) 给这批结果加了一组必要的对照。

既有方法会在 public benchmark task 上反复读取反馈、修改 Harness，最后又用同一批任务报告成绩。这个过程本身已经花了额外推理和反馈预算。若 baseline 只跑一次，所谓增益可能同时包含结构改进、更多搜索和 benchmark adaptation。

先把最终增益按三种可能来源检查，会更容易看清问题。

$$
Observed\ Gain
\approx
Better\ Harness
+Additional\ Search
+Benchmark\ Adaptation
$$

这里的加号只是一份因果核对清单，三项会互相作用，不能从最终分数里直接做代数分解。新的工具规则可能让多次采样更有效，反复接触 benchmark 又会影响 optimizer 选择哪种规则。要识别结构改进，只能靠控制组逐步缩小其他解释。

预算本身也应写成向量。

$$
B=
(N_{rollout},N_{call},N_{token},N_{verifier},N_{feedback},T_{wall},C_{money})
$$

两个方法都运行十轮，并不表示预算相同。一轮可能只生成一个候选，也可能为几十项任务反复采样、调用 verifier，再让 proposer 阅读数百万 token 轨迹。公平比较至少要统一起始模型与 Harness、任务划分、环境版本、反馈可见性和最终测试预算，同时报告预算上限与实际消耗。

数据划分也有三种不同职责。$\mathcal D_{\mathrm{search}}$ 的轨迹会暴露给 optimizer，$\mathcal D_{\mathrm{gate}}$ 可以不暴露轨迹，却会反复决定候选是否晋升，独立的 $\mathcal D_{\mathrm{test}}$ 在搜索和晋升结束以前都不能参与决定。这个区分会直接影响“held-out”一词的分量。Self-Harness 每轮都用所谓 held-out split 做回归门禁，在本文的记号里它属于 $\mathcal D_{\mathrm{gate}}$，不能当作一次完全未触碰的最终测试。

论文将 feedback 与 inference budget 配平，再加入并行采样、顺序精炼等简单 test-time scaling baseline，并把演化任务与 held-out task 分开。实验实例化了一种 AHE 式 Harness Evolution，并关闭 explore agent，范围并未覆盖所有自动演化算法。作者在 Terminal-Bench 2.1、GPT-5.4 和 Claude Opus 4.6 上发现，这套自动 Harness Evolution 没有稳定胜过简单扩展。迁移到 held-out task 时，一个模型提高 1.2 个百分点，另一个没有提高，平均只有 0.6 个百分点。

这个结果没有削弱 Harness 本身的作用。它限制了另一项更强的主张。当前自动 Evolution 方法还没有稳定证明，它们能在匹配预算下发现跨任务通用的结构改进。

后续方法开始主动处理搜索塌缩和过拟合。[HarnessBank](https://arxiv.org/abs/2607.13683) 保留处在不同语义坐标的高性能候选，再做重组、筛选和 gated verification。论文按百分号报告七个 benchmark 上 5.1% 到 15.4% 的 Pass@1 增益，跨模型测试里没有出现可直接移植的统一赢家。

[HarnessCompass](https://arxiv.org/abs/2608.01918) 只允许 task-agnostic 修改，除轨迹外还询问 Agent 自己怎样使用 Harness，并先分组件优化，再合并结果。作者把 SWE-bench Verified 分成 50 个 evolution sample 和 450 个 held-out task。GPT-5.4 在前一组由 54.0% 提高到 66.0%，在后一组由 51.6% 提高到 60.4%，500 个任务的总体结果由 51.8% 提高到 61.0%。它发布于 8 月初，和其他新预印本一样，仍需独立复现。

这些方法显示搜索策略也在变化。早期循环容易围绕当前最高分候选继续修改，结果会收缩到很窄的局部区域。HarnessBank 保留语义上不同的高分版本，HarnessCompass 限制 task-specific edit，又把任务 Agent 对 Harness 使用情况的反馈纳入证据。候选多样性、修改范围、artifact 是否被采用和独立泛化检查，开始和生成 patch 本身一样重要。

## 诊断和定位成为独立研究对象

现实 Harness 的代码规模也进入研究。[Harness Handbook](https://arxiv.org/abs/2607.13285) 在两个开源 Harness 上检查行为定位，指出一个高层行为可能散落在多个目录、middleware、tool adapter 和很少执行的路径中。它用静态分析和 LLM 生成 behavior-centric representation，再通过 progressive disclosure 帮 Agent 从行为描述逐层定位到源码。改 Harness 的困难因此多了一步，修改者先要找到共同实现目标行为的代码位置。

以“修改工具审批行为”这样的高层要求为例，实现代码可能同时落在权限 policy、发起审批的 middleware、tool adapter、客户端事件协议和异常恢复分支。只改最显眼的 prompt，模型会学到应该请求批准，runtime 仍可能在另一条路径直接执行。只改某个 adapter，又可能漏掉由 shell 或 MCP 进入的同类动作。大型 Harness 的行为属于分布式程序行为，定位时要找共同实现一项责任的代码集合。

Harness Handbook 先建立行为到代码的表示，再让 Agent 按需展开。第一层告诉它行为涉及哪些子系统，后面逐渐暴露文件、符号和少见路径。这样既避免把整个仓库一次塞进上下文，也减少只读入口文件后贸然修改的概率。产品 Harness 向学术搜索空间扩张以后，repository navigation 本身成了 optimizer 的能力组成。

[Model or Harness](https://arxiv.org/abs/2607.28802) 研究 failure localization。论文把 41 类失败映射到模型、Harness、工具、memory、用户、环境和 grader 之间的交互边，再判断修复应落在模型后训练、Harness、工具、环境或 benchmark 哪一侧。作者报告最强自动 judge 对人工类别达到 $\kappa=0.76$。

repair assignment 决定了后续工程方向。模型稳定缺少某种推理能力，反复给 system prompt 加提醒很难解决，可能需要 post-training。工具 schema 含糊或返回值错误，修 Harness 提示也只能绕开接口缺陷。环境依赖已经坏掉，Agent 的失败不该计作策略问题。grader 若把正确工件判错，围绕它演化只会教会系统适应评测漏洞。

| 主要责任位置 | 更合适的修复对象 | 误诊后的典型结果 |
| --- | --- | --- |
| 模型能力 | model post-training 或更换模型 | Harness 规则不断加厚，困难任务仍不会做 |
| Harness 行为 | prompt、memory、middleware、控制流或验证器 | 只换模型，原有运行错误继续出现 |
| 工具接口 | schema、实现、错误语义与权限边界 | 模型被迫猜参数或把工具故障当任务失败 |
| 环境与依赖 | workspace、服务、数据和执行条件 | optimizer 针对偶发环境噪声写入永久规则 |
| benchmark 与 grader | 任务规范、测试和评分器 | 系统学会迎合错误信号 |

[Shor](https://arxiv.org/abs/2605.22505) 则用 182 个经人工确认的场景直接测 optimizer 的组件优先级判断。任务先不要求它写出整份新 Harness，只让它给 prompt、tool、memory 和 workflow 排序，判断哪一项最该改。这个工作仍标为 Work in Progress。作者报告 OpenHands-CLI 配 DeepSeek-V4-Pro 的最高 Acc@1 约为 0.305，Claude Code 配 Sonnet 4.6 的最高平均 NDCG 约为 0.793，也没有一个 model-harness 配置在所有领域领先。把正确组件直接告诉 optimizer 后，修复成功率明显上升。

这组实验把“会不会改”与“知不知道先改哪里”拆开了。coding agent 已经能写出语法正确的 patch，优先级判断却会把预算花在影响很小的组件上。可用的 Harness optimizer 需要先读懂失败证据，判断责任位置，再决定本轮值得动哪一项。最终 Agent 分数把这几步压成一个数，很难知道瓶颈究竟在诊断还是生成。

[Evo-Bench](https://arxiv.org/abs/2608.09096) 又试图把模型本身的 Harness evolution 能力从最终 Agent 分数里拆出来。它先用辅助任务演化寻找确实对 Harness 修改敏感的任务，再做 sensitivity-aware split，并覆盖 Search、Office 和 General 三类环境。作者在九个模型上报告最高 16.6 个百分点的提升，同时发现 Search 类任务更容易，依赖特定 workflow 的 Office 任务更难，演化还经常较早饱和。

只报“修改前 60，修改后 70”已经很难说明系统学会了什么。基础任务能力、失败诊断、Harness 编辑、Harness 采用和 held-out 泛化，至少应分开观察。

这些结果把当前短板指向同一个位置。很多 coding agent 已经会写 patch，难点集中在 diagnosis、localization、修改优先级和验证。下面的流程拆分只用于本文的比较，尚未成为该领域的标准定义。

$$
Diagnosis+Localization+Patch\ Generation+Validation
$$

只研究第三项，很容易把一次偶然有效的 patch 当成系统已经学会改进。

## Harness 优化器和模型本身也进入训练范围

到了 8 月，研究对象继续向优化器和模型侧扩展。

[Harness-R1](https://arxiv.org/abs/2608.02276) 训练一个专门编辑 executable runtime harness 的 9B engineer。它先做 cold-start SFT，再用 online GRPO 学习。输入是一批 target-agent 的失败轨迹，输出是通过验证的可执行 patch，冻结的 target agent 用新 Harness 重跑，实际成功率成为 engineer 的 reward。作者报告 vanilla Qwen3.5-9B 的平均成功率从 44.3% 提高到 53.6%，在 target 已经微调的设置里又从 59.2% 提高到 64.2%。这里学习的是 $O_\phi$。每个训练设置里的 target 与 reward protocol 保持固定，target 一旦更换，论文会重新训练与它对应的 engineer。

它收集的数据可以概括为当前 Harness、失败证据、候选 patch 和 rerun 后的实际指标变化，再用这些 failure-patch-rerun 样本更新 $\phi$。

静态检查只能筛掉不能运行或越过接口的修改，patch 是否有用要看冻结 target 在环境中的新轨迹。在线 RL 因而把 credit 从“代码看起来合理”传回“目标任务确实更常成功”。第二组 59.2% 到 64.2% 的数字来自直接 SFT 后的 target，论文又为它训练了 target-specific engineer。优化器也带有 target 配置条件，不能自然假定一位 engineer 适合所有模型与 runtime。

[EvoHarness-RL](https://arxiv.org/abs/2608.05446) 没有修改 runtime 源码。它训练 Agent 怎样构造和使用外部状态，把状态分成 Belief、Progress 和 Experience。supervised harness fine-tuning 先教会模型动作空间，cost-aware GRPO 再学习何时读取、更新和压缩这些状态。作者在 ALFWorld 上报告 Qwen3-8B 达到 96.9% success。

三类状态分别回答当前环境大致是什么、任务推进到了哪里、过去哪些经验值得复用。模型在环境动作之外还可以选择 track、commit、recall 和 note。调用 Harness 也会消耗交互预算，训练目标因此包含成功、效率、动作多样性和重复惩罚。它学到的重点是使用外部状态的时机，外部状态接口和 runtime 源码仍然固定。

论文还提出两个有意思的观察。harness evolution 指外部状态在执行中逐渐被整理成更有用的任务表示。harness annealing 指训练把一部分频繁使用的外部操作内化进模型，Agent 后来只在必要时访问 Harness。外部流程和模型参数之间并没有永远固定的分工。

[ClawGym II](https://arxiv.org/abs/2608.16798) 直接把工业 Harness 作为黑盒训练环境。它在模型调用边界放置 serving proxy，捕获复杂 Harness 发起的多轮调用，再恢复成 prefix tree，用适配后的 PPO 或 GRPO 训练。一个模型还可以通过多种异构 Harness 共同训练。作者报告 Qwen3-30A3B 经 OpenClaw 和 Claude Code 训练后，在 ClawGym-Bench 上分别增加 9.98 和 14.81 个 Pass@1 百分点，并在 200 到 400 个优化步骤中保持稳定。

这条路线没有改写 Claude Code。它把 Claude Code 从被比较的产品转成轨迹生成环境，解决了学术界很难复制完整工业 runtime 的问题。研究者可以在模型边界采集训练信号，而不必重做会话、权限、沙箱和各种产品协议。

serving proxy 位于 Harness 发起模型调用的边界，能观察一项任务中多轮调用怎样分叉，再把它们恢复成 prefix tree。训练算法据此计算 Harness 内部多次模型决策的回报。对研究者而言，Claude Code 的 session、工具和控制流保持黑盒；对被训练模型而言，这些机制已经决定它会遇到什么状态和反馈。工业产品由此成为训练数据生成过程的一部分。

mix-harness training 又把同一模型放进多种外部协议。这个设置有机会减少模型对某一套工具名和 prompt 模板的依赖，也会引入新的分布问题。不同 Harness 的动作语义、上下文结构和恢复方式并不一致，训练系统要判断哪些经验能够共享。

[SIA](https://arxiv.org/abs/2605.27276) 和 [Co-Harness](https://arxiv.org/abs/2607.22688) 把 Harness 与模型权重纳入同一个优化过程。SIA 的 Feedback-Agent 根据最近轨迹决定下一轮改 scaffold 还是改模型参数，两类更新在长期循环里共同出现。作者在法律分类、GPU kernel 优化和单细胞 RNA 去噪上报告相对只改 scaffold 的收益。Co-Harness 让 HarnessCritic 分析失败，修改 prompts、tools、skills、middleware 或 memory，再用改进后的 Harness 生成高质量轨迹，把这些轨迹蒸馏回模型。论文还记录了一次超过 200 小时的 autonomous case study，其中系统经历崩溃恢复、推理效率改进和 ensemble strategy 的发现。

Co-Harness 的一轮可以分成四步。HarnessCritic 先读失败轨迹，把问题归到 prompt ambiguity、tool schema、缺少 skill 或 middleware mismatch 等 Harness 原因。它随后提出局部 diff，候选只有在目标失败得到改善且 held-out behavior 没有回退时才被接受。改好的 Harness 再生成高质量轨迹，模型最后从这些轨迹中训练。用本文记号可以写成

$$
\begin{aligned}
\eta_{k+1} &= \operatorname{Repair}_H(\eta_k;O_{\phi_k},\mathcal T_k,\mathcal Q,V,\Gamma) \\
\mathcal Z_{k+1}^M &= \operatorname{Select}_V\!\left(\operatorname{Run}_{\mathcal Q}(M_{\theta_k},H_{\eta_{k+1}},\mathcal D_{\mathrm{train}},\mathcal W;B_k^{\mathrm{data}})\right) \\
\theta_{k+1} &= \operatorname{Train}_M(\theta_k,\mathcal Z_{k+1}^M;B_k^M)
\end{aligned}
$$

这里把 HarnessCritic 记作 $O_{\phi_k}$，$\operatorname{Repair}_H$ 封装了诊断、候选评测与晋升。$B_k^{\mathrm{data}}$ 支付训练轨迹的生成，$B_k^M$ 约束真正的模型更新，两项都计入整代预算。模型训练只读取经过 $V$ 筛选的轨迹。

固定 Harness 的 post-training 实际上固定了训练数据的生成环境。tool schema 写错，好的轨迹根本不会出现。重试规则太短，模型只会看到任务过早终止。Harness 先变好以后，训练数据的支持集也会变化，模型才有机会学习原先到不了的行为。

联合更新带来的归因更困难。Harness 决定训练数据怎样产生，模型更新又会改变下一轮最合适的 Harness。两者同时变化时，训练分布会漂移，某项增益来自哪一侧也更难判断。

SIA 每轮在两种更新里做选择，Co-Harness 按先改 Harness 再训练模型的顺序交替推进。两者都保留固定的外层目标与更新协议。若一次实验同时改变 $\theta$ 和 $\eta$，只看最终分数无法得知哪一侧贡献了变化，还可能漏掉交互项。更可靠的实验需要保留只更新模型、只更新 Harness 和按同样预算联合更新的对照，并跟踪每轮数据分布。

[TaoLive](https://arxiv.org/abs/2608.15763) 处理业务中的 harness shift。直播业务里的 skills、hooks、system prompts 和 tool schemas 会频繁变化。论文先给出一条固定权重的 Harness Evolution 路径。AI 负责聚类失败、诊断和提出修改，开发者确认方案、运行评测，再决定晋升、返修或停止。这条路径带有人类门禁，论文没有把它描述成端到端自主联合演化。

频繁晋升新 Harness 又会制造模型侧问题。小模型若只在固定配置上微调，可能记住名称和模板，换一套 Harness 就失效。论文用 task-preserving augmentation 改写 skills、schema、prompt structure 和 interaction constraint，再依次做 SFT、on-policy distillation 和 agentic RL。团队在四组共 4,500 多个样本的生产信息驱动评测和一张 H20 上的受控完整 Agent replay 中报告结果，固定 Harness SFT 让 IFEval 下降 7.7 分。这些结果来自团队技术报告，还不能视作经过独立验证的线上业务效果。TaoLive 的研究重点是让可独立更新的 Harness 与能适应 Harness 变化的模型在同一生产 runtime 中配合，两条更新路径的责任仍然分开。

[EvolveNet](https://arxiv.org/abs/2608.04968) 面对数据不能集中到一个 optimizer 的场景。共享 Harness 被发到各个本地部署，每个部署根据私有 workload 修改它，只上传程序 patch，中央再做 scope-typed、evidence-guided aggregation。程序 patch 无法像梯度那样直接平均，系统还要处理修改作用域冲突、行为不兼容、证据强弱、组合与回归。作者在五类任务里报告共享 Harness 都得到改善。这是一种接近企业真实部署的分布式 Harness 学习问题，上传 patch 本身并不构成隐私证明，改动仍可能携带本地信息。

梯度的坐标预先由模型参数确定，两个站点的数值更新可以按规则聚合。程序 patch 会新建工具、删除规则或改变控制流，两份修改即使落在不同文件，也可能在行为上冲突。中央聚合器必须读懂作用域，比较各自证据，再测试组合后的版本。上传内容由轨迹变成 patch，减少了原始数据集中传输，patch 仍可能泄露本地结构或业务规则，隐私需要另一套证明与防护。

## 安全和确定性程序重新划定边界

安全研究也开始按 Harness 生命周期组织问题。[HarnessSafe](https://arxiv.org/abs/2608.06984) 关注 memory、skills、tools 和 shared artifacts 等持久载体。攻击内容可以在早期 session 进入系统，经过持久化以后，在后续正常请求里重新激活。它提供 328 个可执行案例和七类载体，用轨迹证据判断攻击进入、持久化、跨边界、触发和阻断的位置。单一 attack success rate 很难表达这条传播链，结果也强烈依赖具体 model-harness configuration。

这类风险的时间跨度会超过一次回复。恶意内容可以先从工具结果或共享 artifact 进入，当前任务只把它写入 memory 或 skill，并没有立刻执行危险动作。后来的正常请求检索到这段持久内容，模型把它当作旧经验继续遵循，风险才进入动作阶段。若评测只观察第一段 session 的最终回复，这条链会被判成没有攻击成功。

因此，安全评测要记录内容在哪里进入，是否真的被保存，随后跨过了哪道会话或权限边界，又由什么正常条件重新触发。阻断点也可能位于任何一段。输入过滤可以拦截进入，持久化策略可以拒绝保存，retrieval policy 可以隔离不可信内容，tool policy 还能在动作执行前再次检查。Harness 安全由这条传播路径共同决定。

[Safety Harness Evolution](https://arxiv.org/abs/2608.09885) 把安全 Harness 拆成 System Prompt、Rule Bank、Safety Memory 和 Tool Policy。失败轨迹先做责任归因，再局部更新对应 artifact，候选要经过 safety-utility validation。作者报告 ASR 降至静态 SafeHarness 的约 1/3.1，benign utility 也有提高，并在 held-out AgentHarm 和其他模型上迁移。

拆成多种 artifact 的意义在于责任可以局部修改。普遍原则进入 Rule Bank，具体失败经验可以写进 Safety Memory，动作权限留给 Tool Policy。若所有内容都追加到 system prompt，规则会互相遮蔽，回滚时也很难知道删哪一段。安全修改仍要同时检查 utility，过强的拒绝和工具封锁会让正常任务一起失效。

[HarnessRisk](https://arxiv.org/abs/2608.17597) 把风险分布到 Harness Configuration、Capability Extension、Runtime Operation、State Persistence、Action Control 和 Incident Recovery 六个阶段。它含 128 个沙箱案例，在三个 Harness、六个模型和 14 个配置上的 attack success rate 从 12.6% 到 80.9%。Harness Configuration 是最脆弱的阶段之一，模型能说出风险也不代表它最终会采取安全动作。

| 生命周期位置 | 主要风险 | 更靠外的控制手段 |
| --- | --- | --- |
| Harness Configuration | 初始规则、权限和默认值配置错误 | 配置审查、最小权限与版本绑定 |
| Capability Extension | 新工具、skill 或 MCP 扩大动作面 | 来源验证、schema 检查与能力审批 |
| Runtime Operation | 多步执行中被诱导或误用工具 | sandbox、参数约束与实时策略 |
| State Persistence | memory 与共享 artifact 保存不可信内容 | 来源标记、隔离、过期和清理规则 |
| Action Control | 模型理解风险后仍执行危险动作 | 确定性 policy、人工批准与外部 verifier |
| Incident Recovery | 出错后重试、回滚或取证失败 | 持久日志、reconcile、吊销与恢复演练 |

这张表也说明边界扩张不会自动带来更多模型裁量。模型可以建议怎样配置工具，最终权限仍可由外部 policy 决定。模型能够解释某个动作危险，runtime 仍要在执行点强制检查。越接近真实副作用，确定性程序承担的责任通常越重。

这些工作把权限、安全和审计放回完整执行过程。安全不能只靠最终回复的一次分类，也不能只写进越来越长的 system prompt。不同责任需要落进不同 artifact，由外部程序测试、回滚和约束。

8 月 19 日出现的两项工作又把视线带回确定性接口。[SemaPLC](https://arxiv.org/abs/2608.18565) 面向工业 PLC 编程，Agent 不能根据自己的判断宣布完成。specification、compilation 和 live runtime behavior 都要由外部日志确认。作者发现，静态检查中接近的方法，在实时执行轨迹上会拉开明显差距。

三重验证分别挡住不同错误。specification 检查产物是否满足题意，compilation 确认程序至少能由工具链接受，live runtime behavior 再观察它在真实动态系统里怎样运行。模型自评只能作为线索，不能替代这三类环境证据。目标 Harness 的 $S_\eta$ 因此需要读取运行时可访问的确定性 validator 输出，不能让模型自由解释停止条件。

[CTIFoundry](https://arxiv.org/abs/2608.18613) 没有增加复杂 planner。它把 CVE、CWE、CAPEC 和 ATT&CK 构成 typed ontology graph，再通过七个 typed tools 和三项 procedural skills 暴露给一份固定 Harness。作者报告只替换 action surface，小模型也能超过使用扁平检索数据的旗舰模型，Claude 模型上的工具调用量还大约减半。

typed action surface 把一部分推理提前写进接口。实体类型、关系和允许的查询路径由程序明确，模型不必每次从扁平文本里重新猜结构。这样做会减少开放式自由度，却也缩小无效动作与歧义空间。它与 SemaPLC 指向同一件事，Harness 改进有时来自更强的外部结构和验证，控制流交给模型的部分反而更少。

这两项工作纠正了一个容易出现的倾向。Harness 变好，并不总要增加更多由模型决定的控制流。结构清楚的环境接口、带类型的动作面和不可由模型自行解释绕过的外部验证，经常更加有效。

## 递归程度取决于哪些改进关系闭合

把可编辑系统状态和仍在外部的更新过程记成

$$
\begin{aligned}
\Sigma_k &= (\theta_k,\eta_k,\phi_k,\mathcal Q_k,V_k,\Gamma_k,\mathcal L_k) \\
\Sigma_{k+1} &= \mathfrak R(\Sigma_k;\mathrm{Evidence}_k,B_k)
\end{aligned}
$$

第一行依次包含模型、Harness 持久设计、optimizer、evaluation harness、评分器、晋升规则和历史 archive。$\mathrm{Evidence}_k$ 汇总本代轨迹、指标与历史记录，第二行的固定算子 $\mathfrak R$ 是仍在这些对象之外的更新机制。运行很多轮只说明同一 $\mathfrak R$ 反复作用于系统。修改关系上的递归还要满足两个条件。第 $k+1$ 代实际承担第 $k+2$ 代的修改，改进后的能力也要帮助它在新任务上产生更好的后续修改。若每一轮仍由同一套固定外部 optimizer 和 evaluator 完成，target 连续变强，后续改进仍由外部机制完成。

操作上，可以把每一代系统放到固定的外部元评测里，让它在未见过的 target 与改进任务上工作，再比较单位成本能带来多少后续提升。这里的固定至少包括不随被评代次改变的 $\mathcal Q^\star$、$V^\star$、$\mathcal D^\star$ 和 $B^\star$。这个量只是一种单代改进效率代理，不能直接当作 RSI 证明。强 RSI 还需要看到改进能力跨代可靠提高，同时安全、旧能力和成本约束没有失控。固定 benchmark 上多跑几轮，无法提供这类证据。

| 层次 | 本轮发生的变化 | 下一轮由谁改 | 仍然固定的部分 | 合适的称呼 |
| --- | --- | --- | --- | --- |
| Episode reflection 或 retry | 当前轨迹被重写 | 同一运行逻辑 | 模型、Harness 与改进规则 | 推理时重试 |
| 持久 memory 或 skill | 后续任务读到新状态 | 固定写入与检索机制 | 核心改进协议 | 持续适应 |
| 外部 optimizer 修改 target harness | $\eta_k$ 更新 | 外部 meta-agent | 模型、optimizer、evaluator | 自动化 Agent 设计 |
| Self-Harness | 自身 operating harness 更新 | 同一基础模型以 proposer 角色继续 | 权重、评测器和接受规则 | 有界自修改 |
| SICA 与 DGM | Agent codebase 或 Harness 源码更新 | 改进版本继续参与后续修改 | 基础模型与外层 archive 机制 | 一阶自指改进 |
| HSI | Harness 与 evolver strategy 更新 | meta-evolver | frozen backbone 与 outer anchor | 层级递归改进 |
| SIA 与 Co-Harness | Harness 和模型进入同一长期过程 | 固定外层算法安排更新 | 目标函数与评测协议 | 联合适应 |
| 强 RSI 的证据目标 | 改进者、学习过程和评测能力也持续提高 | 后继系统 | 只保留不可省的外部约束 | 开放式递归改进 |

episode 内 reflection 和 retry 只改变当前尝试。把经验写进 memory 或 skill 会影响后续任务，改进机制本身仍保持原样。外部 meta-agent 修改 target harness 已经属于 automated agent design，修改者与被修改者仍是两套系统。

[SICA](https://arxiv.org/abs/2504.15228) 让 coding agent 修改自己的 Python codebase，再由改进版本继续承担后续任务和自修改。[Darwin Gödel Machine](https://arxiv.org/abs/2505.22954) 维护 Agent archive，让候选修改自己的 Harness 代码。它们具有更强的自指关系，基础模型、archive maintenance、parent selection 和评测仍由固定外层机制掌管。DGM 论文估算一次 SWE-bench 演化运行约需两周和 2.2 万美元，部分演化出的 workflow 还会用另一种 foundation model 评估并选择多次尝试中的候选。这套递归关系伴随着很高的搜索成本。

[STOP](https://arxiv.org/abs/2310.02304) 更早让 LM 驱动的代码 improver 改进自身。作者明确说明，语言模型本身没有变化，因此这还不构成完整 Recursive Self-Improvement。这项限定直到今天仍然有用。

[Self-Harness](https://arxiv.org/abs/2606.09498) 让同一基础模型分析自己的轨迹，并修改未来运行所用的 operating harness。循环由 weakness mining、harness proposal 和 proposal validation 组成，只接受通过回归门禁的最小改动。作者在 3 个模型乘以 Terminal-Bench 2.0、SWE-bench Verified、AppWorld 这 3 个 benchmark 的 9 种组合里报告提升，其中 Qwen3.5-35B-A3B 在 AppWorld 上的总体相对增益达到 132%。这里的 held-out 需要准确理解。proposer 看不到回归集轨迹，候选是否晋升却每轮都由这组分数决定，因此它能说明修改没有只改善 proposer 直接读取的任务，不能充当一次完全未触碰的最终泛化测试。benchmark、editable surface、reward、evaluator、接受规则和模型权重都保持固定，所以这仍属于有界的 recursive harness improvement。

它的 weakness mining 先根据 verifier 证据聚类失败，尽量把表面结果与可复用的行为原因分开。proposal 阶段要求候选彼此不同，每一份改动又尽量小，并写明目标失败面和可能回归。门禁要求 search 与 gate 两组都不能下降，并且至少一组得到改善。这个规则很保守，也让 $\mathcal D_{\mathrm{gate}}$ 参与了每一轮版本选择。轨迹没有暴露给 proposer 和数据完全没有参与优化，属于两种强度不同的隔离。

[Recursive Agent Harnesses](https://arxiv.org/abs/2606.13643) 里的 recursive 指另一件事。父 Agent 生成并运行程序，并行调用具备文件系统、代码执行和规划能力的完整 subagent harness，再汇总结果。作者在固定 GPT-5 backbone 的长上下文实验中报告高于 Codex baseline 的结果。RAH 研究 Harness 调用 Harness 的执行结构递归，Self-Harness 研究 Harness 怎样修改未来 Harness，属于修改关系递归。这两个概念不能混用。

[Hierarchical Self-Improvement](https://arxiv.org/abs/2608.08466) 让一个冻结模型分别充当 task agent、harness evolver 和 meta-evolver。meta-evolver 可以修改 evolver 的 strategy code，外层 anchor 仍然固定。论文还明确观察到 feedback fidelity 和 backbone capability 的上界。在超过基础模型能力的 NLE 任务上，Harness evolution 没有带来改善。

Harness-R1 在每个训练设置内学习与固定 target 对应的 Harness optimizer，reward protocol 也保持固定。SIA 与 Co-Harness 更新模型和 Harness，外层更新算法和目标函数固定。ClawGym II 通过固定 Harness 更新模型。TaoLive 由开发者审查的流程更新 Harness，再单独训练模型适应 Harness 分布，晋升规则和训练流程仍由外部提供。RAH 则属于执行结构递归，与这些自修改关系分开。

这里有一个容易让概念失去区分度的做法。若把 target、外部 optimizer、evaluation harness 和人类全部称为同一个系统，AutoML 和常见 CI 优化循环也能被叫作 system-level self-improvement。更严格的判断会追问，改进后的 Agent 是否成为下一轮的改进者。

截至 2026 年 8 月 20 日，公开研究已经展示多层、有界、参数与非参数混合的系统改进。强意义的 RSI 还缺几块证据。

| 仍缺的证据 | 需要观察什么 | 当前系统常见的固定外层 |
| --- | --- | --- |
| 后继改进权 | 改进版本是否真的接管下一轮提议与选择 | 原始 proposer 或固定 meta-agent |
| 评测完整性 | evaluator 能否独立、稳健并抵抗 reward hacking | 固定 grader 与人工设定规则 |
| 开放任务迁移 | 改进能否离开反复接触的 benchmark | public task 与回归集 |
| 改进效率增长 | 单位计算换来的新能力是否随代次提高 | 预设搜索预算和采样策略 |
| 持续安全 | 新能力出现时成本、旧能力与安全是否保持 | 外部权限、审查和停止机制 |
| 联合信用分配 | 模型、Harness、optimizer 和 evaluator 同时变化时，怎样判断谁带来增益 | 人工设计的消融与发布门禁 |

这些条件互相关联。Evaluator 一旦能够被修改，系统也可能学会抬高自己的分数。任务分布一直固定，改进效率上升可能只是在更快地适应同一批题。模型与 Harness 一起变化，后继系统看起来更强，仍要排除训练数据和额外预算带来的解释。强 RSI 需要的证据因此远高于“循环已经自动跑了很多轮”。

Self-Harness、HSI、Harness-R1 和 Co-Harness 分别覆盖了其中一部分改进关系。现有公开系统还没有把全部关系接通，也没有证明每一代都会更擅长产生下一代改进。

## 工业界与学术界正在相遇，完整产品仍然更宽

2026 年的论文已经碰到许多工业问题。研究对象包含工具、middleware、memory 和可执行 runtime，也开始处理大型代码定位、私有 workload、实时业务、持久状态与生命周期安全。ClawGym II 甚至直接借 Claude Code 这类黑盒产品训练模型。

工业端也在进入 L4。OpenAI 的 [Codex 公开用例](https://learn.chatgpt.com/use-cases) 已经把困难任务写成带评分的改进循环，也支持让 Codex 构建 eval。放到 Agent improvement 里，可编辑对象会包含 instructions、tools、routing、输出要求和 validation checks，traces、feedback 与 eval 随后形成下一版修改要求，再由 coding agent 实施和复验。

Anthropic 的长任务工作也经历了结构变化。早期方案用 initializer 拆任务，coding agent 每次推进一项，再用跨 session artifact 交接。后来的方案加入 planner、generator 和 evaluator，使用结构化任务与交接材料；模型换成 Opus 4.5 后，原先为 Sonnet 4.5 准备的 context reset 又被删掉。工业团队也在观察失败、修改 Harness 和重新验证，只是还要把版本发布、真实用户和故障责任一起算进去。

多数论文公开的 editable surface 仍集中在 prompts、skills、memories、tools、middleware、workflow、validators 和少量 runtime code。完整产品还要承担 durable session、多客户端同步、authentication、tool approval UX、sandbox lifecycle、断线恢复、并发隔离、协议兼容、telemetry、canary、回滚、配额和成本控制。

因此，2026 年的学术 Harness 已经从行为层切片扩展到部分真实 runtime，完整产品平台仍有大量责任没有进入搜索空间。ClawGym II 的黑盒路径提供了一个实用折中。研究者无须复刻 Claude Code 的每一层工程责任，也能研究真实 Harness 产生的训练轨迹。

两边由此靠近同一套改进过程。系统先执行任务，记录失败和环境结果，再定位原因、修改模型外部程序，随后验证和发布。工业团队要让它长期、安全、低成本地服务真实用户。学术研究需要控制变量，证明某种优化机制确实有效。

若按研究对象回看这两年，边界移动的顺序已经很清楚。最初进入搜索的是 Harness 程序 $\eta$，随后是提出修改的 $O_\phi$。研究者接着训练模型怎样读取和采用 Harness，又让 Harness 产生经过验证的模型训练轨迹。模型与 Harness 后来被放进同一长期更新过程，安全研究则把配置、持久状态、动作控制和事故恢复一起纳入评测。每次范围扩张都会留下新的固定外层。修改者进入训练以后，reward protocol 仍由人设计；模型与 Harness 一起更新以后，evaluator 和发布门禁仍要保持可靠。

## 看下一篇 Harness 论文时，我会先问这些问题

先看 editable surface。论文究竟只改 prompt，还是会碰工具、memory、middleware、控制流、verifier、runtime 或整个代码目录。名称相同，搜索空间可能差几个数量级。

接着找提出修改的人。当前任务 Agent、同一基础模型的另一次调用、更强外部模型和人类工程师，对“自我改进”的含义完全不同。若新版本没有负责下一轮改进，自指关系仍然没有成立。

Evaluator 应该和 optimizer 分开。搜索用过哪些 public task，最终报告是否仍用同一批数据，held-out task 和 regression suite 是否保持独立，这些信息比 Self-Evolving 之类命名更有判断力。

预算也要配平。Harness Evolution 读取了多少失败轨迹，生成了多少候选，额外调用了多少模型，都应该和 parallel sampling、sequential refinement 等简单方法放在同一 feedback 和 inference budget 下比较。

最后看迁移。修改能否跨任务、模型和版本成立，成本、延迟、可靠性和安全怎样变化，原有能力有没有回退。只在一组搜索任务上分数上涨，很难说明得到了一条可复用的 Harness 设计原则。

把现有证据放在一起看，下面这些判断可以同时成立。多项受控配置显示，Harness 能显著改变 Agent 表现，现有自动 Harness Evolution 的通用性仍缺稳定证据。在 AHE、AutoHarness 等实验设置中，主要收益来自工具、memory、middleware、动作接口和外部验证，单纯扩写 prompt 没有得到同等支持。当前证据也没有支持一份跨模型、任务和预算通用的最优 Harness，条件一变，原来的设计就可能变成负担。

接下来的突破大概会出现在一条更完整的链上。系统要先诊断失败，找到行为对应的代码位置，做局部且可回滚的修改，再用匹配预算、跨任务和安全回归去验证。模型也要学会使用变化中的 Harness，并从 Harness 产生的已验证轨迹里继续训练。

Agent Harness 已经由固定工程配置进入学习系统。公开研究目前能支持的是有界的、多层系统改进。强 Recursive Self-Improvement 还在更远的位置。

## 建议阅读顺序

想建立最短主线，可以依次读 [VeRO](https://arxiv.org/abs/2602.22480)、[AutoHarness](https://arxiv.org/abs/2603.03329)、[Meta-Harness](https://arxiv.org/abs/2603.28052)、[AHE](https://arxiv.org/abs/2604.25850)、[Harness-Bench](https://arxiv.org/abs/2605.27922)、[Harness Updating Is Not Harness Benefit](https://arxiv.org/abs/2605.30621)、[Self-Harness](https://arxiv.org/abs/2606.09498)、[Rethinking the Evaluation of Harness Evolution](https://arxiv.org/abs/2607.12227)、[Harness-R1](https://arxiv.org/abs/2608.02276) 和 [ClawGym II](https://arxiv.org/abs/2608.16798)。

继续追训练与递归关系，可以接着读 [SIA](https://arxiv.org/abs/2605.27276)、[Co-Harness](https://arxiv.org/abs/2607.22688)、[EvoHarness-RL](https://arxiv.org/abs/2608.05446)、[HSI](https://arxiv.org/abs/2608.08466) 和 [TaoLive](https://arxiv.org/abs/2608.15763)。关注工业安全时，[HarnessSafe](https://arxiv.org/abs/2608.06984)、[SHE](https://arxiv.org/abs/2608.09885) 和 [HarnessRisk](https://arxiv.org/abs/2608.17597) 更适合作为一组阅读。

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
