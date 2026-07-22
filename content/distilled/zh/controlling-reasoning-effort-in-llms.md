---
title: "控制 LLM 的推理强度(Reasoning Effort)"
date: "2026-07-18"
description: "Sebastian Raschka 系统梳理推理模型的「推理强度」控制:从 think tokens、推理模式开关,到 GPT-5.6、DeepSeek V4、Nemotron 3 Ultra、Kimi K2.5、GLM-5、Qwen3、Inkling 七种开源旗舰模型的不同实现配方。"
tags: ["LLM", "推理模型", "RL", "后训练"]
source:
  name: "Sebastian Raschka's AI Magazine"
  url: "https://magazine.sebastianraschka.com/p/controlling-reasoning-effort-in-llms"
  author: "Sebastian Raschka"
---

> 本文转载自 [Sebastian Raschka's AI Magazine](https://magazine.sebastianraschka.com/),原文 [Controlling Reasoning Effort in LLMs](https://magazine.sebastianraschka.com/p/controlling-reasoning-effort-in-llms),作者 Sebastian Raschka,首发于 2026-07-18。此处为中文翻译,仅供学习交流。

自 OpenAI 发布 o1 以来快两年了,正是这个模型把「LLM 推理模型」的理念推广开来。大约四个月后 DeepSeek-R1 跟进,并公开了用可验证奖励强化学习(RLVR)训练这类推理模型的配方细节。

上周,OpenAI 发布了 GPT-5.6 模型家族,包含三种尺寸,每种尺寸都有大约五到六档推理强度(reasoning effort)设置。

![图 1:不同推理强度设置下的 GPT 5.6 Sol 模型。(Ultra 的基准分数目前尚未公布,但应该与 Max 大致相当——它使用相近的强度档位,只是用四个 sub-agent 来加速执行。)](/images/distilled/controlling-reasoning-effort/01.png)

所以是的,推理模型已经站稳了脚跟,成为现代模型发布的标配。

过去我写过推理模型的方法论([理解推理型 LLM](https://magazine.sebastianraschka.com/p/understanding-reasoning-llms)),也梳理过相关研究论文([LLM 推理的强化学习现状](https://magazine.sebastianraschka.com/p/the-state-of-llm-reasoning-model-training)和[LLM 推理模型的推理时计算现状](https://magazine.sebastianraschka.com/p/state-of-llm-reasoning-and-inference-scaling))。我甚至还写了一本 440 页的新书,讲如何从零开发推理模型——[Build A Reasoning Model (From Scratch)](https://sebastianraschka.com/books/#build-a-reasoning-model-from-scratch)。

![图 2:我的新书 [Build A Reasoning Model (From Scratch)](https://sebastianraschka.com/books/#build-a-reasoning-model-from-scratch),全彩印刷!](/images/distilled/controlling-reasoning-effort/02.png)

这些资料关注的都是「如何把传统 LLM 变成推理模型」。而在这篇文章里,我想聚焦的是:**如何开发一个拥有多档推理强度模式的推理模型**,就像本文开头那张图展示的那样。

别担心,本文可以独立阅读;当然,上面那些资料也会是有趣且有用的补充。

## 1. 推理模型简释

谈到几乎任何机器学习或 AI 技术、子领域时,总有一个教训:我们通常不该按字面意思去理解技术名词。比如,机器学习和 AI 中的(人工)神经网络,实际上并不像人脑那样的生物神经网络一样工作。

同理,谈「推理模型」时,我们也不该指望这些模型真的像人类一样推理。在 AI 与 LLM 研究的语境里,「推理模型」指的是会输出一段**中间推理轨迹**(reasoning trace)的模型——它像一段中间回答,把问题或任务一步一步推导过来。

举个例子最容易说明。

![图 3:传统 LLM 的回答(左)与推理模型的回答(右)对比。](/images/distilled/controlling-reasoning-effort/03.png)

## 2. 训练扩展与推理扩展概览

提升(推理)任务表现本质上只有两条路:**训练扩展**(training scaling)和**推理扩展**(inference scaling)。

![图 4:训练扩展与推理扩展是提升 LLM 及推理模型解题能力的两种途径。图改绘自 [Learning to reason with LLMs](https://openai.com/index/learning-to-reason-with-llms/)](/images/distilled/controlling-reasoning-effort/04.png)

先简单说说训练。

### 2.1 训练推理模型

一言以蔽之,[DeepSeek-R1](https://arxiv.org/abs/2501.12948) 提出用可验证奖励强化学习(RLVR)把 LLM 训练成推理模型。RLVR 是一种面向「可验证数据域」提供奖励信号(`0=错误`,`1=正确`)的技术。这里的可验证数据域指数学(可以用 SymPy 或 WolframAlpha 之类的符号计算工具检查结果)和代码(可以用编译器、单元测试或 LeetCode 这类平台验证正确性)。

![图 5:RLVR 训练中的准确性奖励与格式奖励。](/images/distilled/controlling-reasoning-effort/05.png)

值得注意的是,推理轨迹本身并没有被用于训练或更新模型。DeepSeek-R1 论文提到他们确实尝试过把这段中间回答的信息用于训练,但报告说对训练没有帮助,最终没有采用。(是否以及如何通过过程奖励模型(PRM)把中间推理轨迹纳入训练信号,仍是一个活跃的研究方向。)

![图 6:RLVR 中忽略中间推理轨迹,只有最终答案和响应格式决定奖励。](/images/distilled/controlling-reasoning-effort/06.png)

### 2.2 「顿悟时刻」

总之,如图 7 所示,只靠输出奖励来训练,就足以让模型学会如何推理问题——它会学着写出中间解释、回溯并自我纠正。模型意识到自己犯了错并自我纠正的这些时刻,被称为「顿悟时刻」(Aha moments)。

![图 7:一个顿悟时刻的例子:推理模型注意到中间推理中的错误,并在产出最终答案之前修正它。](/images/distilled/controlling-reasoning-effort/07.png)

顺带一提,虽然 DeepSeek-R1 无疑是更出圈的那篇论文——正是它点燃了围绕 RLVR 和推理模型开发的热情——但同一天(2025 年 1 月 22 日)arXiv 上其实还发了另一篇 [Kimi K1.5](https://arxiv.org/abs/2501.12599)。而且 RLVR 这个术语两个月前就在 [Tülu 3: Pushing Frontiers in Open Language Model Post-Training](https://arxiv.org/abs/2411.15124) 中被提出了。

DeepSeek R1 之所以最终更受欢迎,一个原因是它证明了推理行为可以用**纯强化学习**实现。

![图 8:DeepSeek-R1-Zero 直接把 RLVR 施加在预训练基座上,不经过监督微调。](/images/distilled/controlling-reasoning-effort/08.png)

比如,Tülu 3 和 Kimi K1.5 都是在监督微调(SFT)模型之上再做强化学习。DeepSeek-R1 本身也是从 DeepSeek-V3 基座的 SFT 检查点出发训练的,但它包含一个用纯 RLVR 训练的变体 DeepSeek-R1-Zero。R1-Zero 比 R1 弱,但它证明了 RLVR 足以教会模型生成并使用推理轨迹。

需要说明的是,R1-Zero 更多是概念验证;完整的 DeepSeek-R1 推理模型训练流水线通常是多阶段的,也更复杂一些。

![图 9:更详细的推理模型训练流水线,图中是各个 DeepSeek-R1 模型。更多细节见我的另一篇文章:[理解推理型 LLM](https://magazine.sebastianraschka.com/p/understanding-reasoning-llms)](/images/distilled/controlling-reasoning-effort/09.png)

顺便说一句,今天的大多数 LLM 实际上就是推理模型——它们都以类似 DeepSeek-R1 的方式、用某种形式的 RLVR 训练而来。

### 2.3 推理扩展简述

除了通过训练提升推理行为,另一个提升模型表现的杠杆是**推理时计算扩展**(inference compute scaling)。简言之,就是在模型训练完成之后、使用它的过程中投入更多算力,以换取更好的答案。

这本身就是一个大话题,想全面了解可以读我的《LLM 推理模型的推理时计算现状》一文。这里只挑最关键的背景信息。

第一,用 RLVR 训练模型本身就已经隐含了一种推理扩展:推理模型在推理阶段通常比传统 LLM 输出更多 token,这意味着我们在推理时花了更多算力。

第二,我们可以通过推理强度档位进一步调节输出长度——这是后文的重点。

第三,还有很多其他推理扩展技术。流行的一种是自洽性(self-consistency),通常以多数投票的形式实现:多次询问模型,用多数票选出最终答案。

![图 10:自洽性示例——一种流行的推理扩展技术。](/images/distilled/controlling-reasoning-effort/11.png)

它既可用于传统 LLM,也可用于推理模型,而且可以按需叠加在推理训练之上。一个很好的例子是 DeepSeekMath-V2:研究者在(数学特化的)推理模型之上叠加了极端的推理扩展,在高难度数学奥赛题上拿到了 SOTA。

![图 11:两种推理扩展(自洽性与自我精炼)联用提升数学表现。图改绘自 [DeepSeekMath-V2: Towards Self-Verifiable Mathematical Reasoning](https://arxiv.org/abs/2511.22570)](/images/distilled/controlling-reasoning-effort/12.png)

其他技术的概览,还是推荐看我的《LLM 推理模型的推理时计算现状》。

## 3. Think tokens

你可能在前面「顿悟时刻」的图里见过 `<think></think>` 这对 token。我把对应的图也放在下面,省得你往回翻。

![图 12:推理模型中常见的格式 token。](/images/distilled/controlling-reasoning-effort/14.png)

就推理能力而言,`<think>` 和 `</think>` 标签只是「装饰」。它们不会让模型学会推理,也不是取得好推理性能的必要条件——完全不用这些分隔符训练同一个模型,大概率也能达到相近的基准成绩。

这对标签/token 的主要作用,是标记推理轨迹的起止位置,让训练流水线或用户界面能把它和最终答案区分开,并可以选择对用户隐藏(ChatGPT、Codex 这类 UI 通常就是这么做的)。

要点在于:`<think>` token 并没有赋予模型「思考」或更好推理的能力。不用它们训练同样的模型,基准表现也会差不多。`<think>` 和 `</think>` 这两个具体字符串本身也没有任何特别之处,换一对分隔符同样能胜任。

实现上,通常是在 RLVR 阶段加入格式奖励:不只按答案正确性给奖励,还对使用 `<think>` token 给予额外奖励,从而鼓励模型使用它们。

以 DeepSeek-R1 为例,总奖励计算为

`R_total = R_accuracy + R_format`

其中格式奖励是一个简单的规则检查,鼓励模型把推理放在

`<think>`

推理轨迹

`</think>`

里面。

## 4. 推理模式的开关

第一代推理模型是「专职」推理模型——比如有 DeepSeek-V3 基座模型,另有独立的 DeepSeek-R1 推理模型。

不管 prompt 是什么,R1 一般都会输出非常冗长的回答、消耗大量 token,哪怕是最简单的问题,而且它内建不了关闭推理模式的选项。

![图 13:即使面对最简单的 prompt,推理模型也非常啰嗦。](/images/distilled/controlling-reasoning-effort/15.png)

后来的模型,如 Qwen3 等,开始尝试混合方案:同一个模型既能表现得像普通的指令微调模型,也能按需切换成推理模型。

> 注:有的模型开发者称之为「思考模式」(thinking mode),有的称之为「推理模式」(reasoning mode),两者指同一种行为。

Qwen3 通过 tokenizer 的 `enable_thinking=True` 或 `enable_thinking=False` 来控制。在底层,`enable_thinking=False` 本质上是在 assistant 回答的开头塞入一个空的 `<think></think>` 区段,从而关掉 Qwen3 的推理(「思考」)模式。

![图 14:Qwen3 0.6B 推理模型在 `thinking=False` 与 `thinking=True` 下的响应。(左图中空的 `<think></think>` 标签被界面隐藏了,因为它们属于改写后的输入 prompt,而不是生成的答案。)](/images/distilled/controlling-reasoning-effort/16.png)

训练上怎么实现,才能让模型在推理时支持这种切换(如上图)?

简言之,按 [Qwen3 技术报告](https://arxiv.org/abs/2505.09388),这种开关行为主要通过监督微调(SFT)引入,随后在旗舰大模型的通用 RL 阶段进一步强化。

具体来说,在模型先经过长思维链 SFT 和推理 RL 训出初始推理模型之后,他们加了一个「思考模式融合」(Thinking Mode Fusion)阶段。在这个额外的 SFT 阶段,模型会同时见到 thinking 和 non-thinking 样本:

- `/think: <think>{推理}</think>{答案}`
- `/no_think: <think></think>{答案}`

thinking 是默认行为,所以 `/think` 也可以省略。随后的通用 RL 阶段会进一步强化这种模式与格式遵循。

`/think` 和 `/no_think` 标记相当于「软开关」。而前面提到的 `enable_thinking=False`——在 False 时强制填入空 `<think></think>`——则相当于「硬开关」。

![图 15:Qwen3 训练流水线中的「思考模式融合」,实现推理模式开关。](/images/distilled/controlling-reasoning-effort/17.png)

换句话说,tokenizer 并不会把 `/no_think` 加进 query,而是直接在 assistant 回答的开头填入空 `<think></think>` 区段;模型只看到最终的 token 序列,直接接着写答案。

总而言之,这种开关本质上是 GPT-5.6 等模型的推理强度档位的简化版,这正是下一节的内容。

## 5. 「推理强度」设置的工作原理

这一节简要梳理各家推理强度开关可能的实现方式——自 GPT 5 引入以来,今天几乎每家旗舰模型都有类似设计。

本文开头我展示过 Codex GPT 5.6 界面中的多档推理「强度」设置。

![图 16:GPT-5.6 提供六档推理强度,从 Light 到 Ultra。](/images/distilled/controlling-reasoning-effort/18.png)

接下来的小节先讲这些设置可能如何实现,然后再过一遍这个方向上更有趣的几篇研究论文。

### 5.1 推理强度与回答的长度及质量

OpenAI 没有公开其强度设置的具体实现,但有一些线索可供合理推测。

比如,通过他们去年开源的 gpt-oss 模型(我在[从 GPT-2 到 gpt-oss:架构演进分析](https://magazine.sebastianraschka.com/p/from-gpt-2-to-gpt-oss-analyzing-the)里写过),我们知道 OpenAI 允许通过系统提示词(system prompt)切换推理强度——在每个 prompt 前加上 "Reasoning effort: low/medium/high"。

![图 17:gpt-oss 的 chat 模板把选定的推理强度插进系统消息,再把 prompt 发给同一个模型。](/images/distilled/controlling-reasoning-effort/19.png)

不出所料,推理强度直接影响回答长度和准确率,如下图所示。

![图 18:不同推理强度下 gpt-oss 模型的回答长度与质量(标注图,来自[模型卡](https://cdn.openai.com/pdf/419b6906-9da6-406c-a19d-1bb078ac7637/oai_gpt-oss_model_card.pdf))](/images/distilled/controlling-reasoning-effort/20.png)

可以推测,GPT 5 系列(包括最近的 GPT 5.6)用的也是类似方案。

另外请注意上图中不同档位对回答长度的缩放:强度档位似乎与 token 用量直接相关,而 token 用量又似乎与准确率相关。理论上也许能做出比 "high" 更高的档位,但我猜性能会在某处饱和。这种饱和在 GPT 5.6 Sol 上看得更清楚——它也说明,继续加大推理预算到某个点之后会变得不划算。

![图 19:推理强度同时推高 API 成本和 coding agent 表现,在 GPT-5.6 最高档位出现收益递减。图基于 Artificial Analysis Coding Agent Index v1.1。](/images/distilled/controlling-reasoning-effort/21.png)

另一个很新的数据点,也能说明推理强度、token 用量和基准表现之间的关系:Thinking Machine Labs 本周开源的 [Inkling](https://sebastianraschka.com/blog/2026/inkling-architecture-benchmark-notes.html)。

![图 20:提高 Inkling 的强度值,生成 token 数和基准成绩总体随之上升,但在高强度处收益递减或波动。图来自 [Inkling 发布博客](https://thinkingmachines.ai/news/introducing-inkling/)。](/images/distilled/controlling-reasoning-effort/22.png)

如本节所述,推理时只需通过系统提示词就能控制推理强度(ChatGPT 界面大概就是把菜单选项映射到系统提示词)。但这对任意模型并不通用——它要求训练流水线做相应改造,这正是下一节的内容。

### 5.2 强度档位的可能实现

无论 GPT 5.6 还是开源的 gpt-oss,训练细节都没有公开。但通常的做法是:在后训练阶段,把强度标签放进 prompt 里。

一般有两种实现路线。

**其一**,在 RLVR 过程中实现:对不同的系统提示词施加不同的长度惩罚。比如 "Reasoning effort: low" 时施加高长度惩罚,"Reasoning effort: high" 时施加温和惩罚或不惩罚。

**其二**,在 RLVR 之后用监督微调(SFT)让模型遵循不同的强度指令。

比如,在 RLVR 主阶段之后的 SFT 中,训练集中的 prompt 会配上展示目标推理量的参考答案(这些答案可以由人写、由另一个模型生成,或生成后筛选)。

![图 21:强度条件化的 RLVR 与 SFT 示意。(这是一种可能的实现,并非对 OpenAI 训练流水线的确认描述。)](/images/distilled/controlling-reasoning-effort/23.png)

在 SFT 阶段,模型直接从训练样本中学习强度标签与目标推理长度之间的关联。基于 RL 的实现则会把强度标签和预算感知奖励放进 RLVR 阶段。两者也可以结合——我猜测 gpt-oss 和 GPT 5.6 都是这么做的(注意,GPT 5.6 的强度设置很可能只是针对用户 query 改变系统提示词而已)。

### 5.3 Inkling 案例研究

刚发布的 Inkling 技术报告给出了一个小而具体的强度训练例子。

![图 22:Inkling 在 0.2 到 0.99 之间扫连续的强度值;强度越高,回答通常越长、基准分数越高。](/images/distilled/controlling-reasoning-effort/24.png)

在大规模 RL 阶段,他们对每个样本做了两件事:

1. 在系统消息中指定期望的强度值。
2. 调整每个生成 token 的成本。

概念上,奖励大致形如:正确性奖励减去 *λ(e)* 乘以 token 数——其中 *e* 是请求的强度值,*λ(e)* 控制 token 惩罚力度。

- 低强度:每 token 成本更高,鼓励更短的推理轨迹。
- 高强度:每 token 成本更低,允许模型花更多 token。

推理时,Inkling 收到诸如 "Thinking effort level: 0.8" 的系统消息,并据此调整 token 用量。Inkling 与 gpt-oss、GPT-5.6 的区别在于:它的强度标签是 0 到 1 之间的连续数值,而不是 low/medium/high 这样的序数标签。

这意味着 Inkling 的强度条件化主要落在推理 RL 阶段,而不只是后期的 SFT 阶段。

不过,他们没有披露确切的奖励公式、token 成本系数,也没有说明强度条件化是否也进入了 SFT 阶段。

### 5.4 关于推理扩展与训练扩展的简短说明

在进入各家论文之前,我想把本节和前面「2.3 推理扩展简述」一节联系起来。

前面我把扩展分为训练计算扩展和推理时计算扩展。GPT-5.6 的界面正好可以直观展示两者的区别,如下图所示。

左边,选择 Luna、Terra 或 Sol,换的是模型本身——粗略类比,这对应训练计算扩展:它们是分别训练出来的不同模型。在训练配方和数据规模固定时,更大的模型需要更多训练算力,通常每个生成 token 的推理算力也更高。

右边,模型保持不变,只改推理强度——这是推理时扩展:权重不变,但允许模型花更少或更多的 token 来作答。

![图 23:模型选择与推理强度两个菜单,对应两条不同的扩展轴。选 Luna、Terra、Sol 是换模型,改推理强度则是对固定模型调整推理时计算。](/images/distilled/controlling-reasoning-effort/25.png)

一个小的术语提醒:在菜单里选另一个模型,严格说并不是「在那一刻做训练扩展」——训练早已完成。更准确的理解是:模型菜单是在「按不同训练规模产出的模型」之间做选择。

下面的 Artificial Analysis 结果展示了这两条轴在实践中如何相互作用。每条蓝色曲线对应一个模型(Luna、Terra 或 Sol)。沿一条曲线移动(提高推理强度)是推理扩展;从一条曲线跳到另一条,则对应模型扩展——这里把它作为训练扩展的实用近似。

不出所料,两种方式都能提升基准分数,但也都会抬高成本。更有趣的是,曲线之间有重叠:比如,小模型开高强度,有时能追平大模型开低强度的分数。

![图 24:GPT-5.6 家族在 Artificial Analysis Coding Agent Index 上的训练扩展与推理扩展。沿每条模型曲线移动对应提高推理强度,跨 Luna、Terra、Sol 曲线对应更换模型。](/images/distilled/controlling-reasoning-effort/26.png)

顺带一提,这张图的横轴是 API 成本而不是原始算力。API 成本是实用的度量,但它还取决于供应商定价和生成 token 数;而且这些曲线的具体形状也因基准而异。

所以,模型大小和推理强度是两个独立的旋钮:可以用更大的模型、可以提高推理强度、也可以两者结合。最优组合取决于你对准确率、成本和延迟的权衡。

读到这里,你对推理强度模式的工作原理和实现方式应该已经有了相当扎实的理解。如果时间紧,在这里停笔也很好;如果想看看最近开源旗舰模型的一些实现细节,请继续读!

## 6. 番外:旗舰开源 LLM 实现推理强度的不同方式

**[除非你对这些额外细节感兴趣,否则本节可以跳过]**

第 5 节介绍了训练推理强度控制的两种可能路线:强度条件化 SFT,以及带不同 token 成本的强化学习。我本来还想介绍一些实现推理预算的其他研究方案,但通读之后发现,它们大多更像概念验证,实践中效果如何并不好说。

所以我把重心换了一下,改讲那些**最先进、最有代表性的开源(旗舰)LLM 实际使用的配方**——至少这些方法有在实践中行之有效的证据。

一共有六个例子:DeepSeek V4、Nemotron 3 Ultra、Kimi K2.5、GLM-5、Qwen3 和 Inkling。它们披露细节的详尽程度不一,但各自贡献了一种有用的变体。(那些只在界面里露出强度设置、却不解释该行为如何训练的模型,不在本文讨论之列。)

### 6.1 DeepSeek V4:分别训练强度专才

先看 [DeepSeek V4 技术报告](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/resolve/main/DeepSeek_V4.pdf?download%3Dtrue),其中描述了三种模式:

- **Non-think**:直接回答,不带推理轨迹。
- **Think High**:经典做法,模型把推理轨迹放在 `<think>` 和 `</think>` 标签之间,与本文开头(第 2 节)讨论的 DeepSeek R1 相同。
- **Think Max**:同上,但额外加一条特殊系统指令(下面细说)。

Think Max 的附加系统指令以「Reasoning Effort: Absolute maximum with no shortcuts permitted.」(推理强度:绝对最大,不允许走捷径)开头。

![图 25:DeepSeek V4 的推理强度控制概览,来自 [DeepSeek V4 文档](https://api-docs.deepseek.com/guides/thinking_mode/)。](/images/distilled/controlling-reasoning-effort/27.png)

乍一听,这像个简单的提示词工程技巧,但这个 prompt 背后其实是**不同的训练配置**:每种模式使用各自的上下文窗口和长度惩罚(报告没有披露长度惩罚的具体实现)。Think Max 比 Think High 拿到更长的上下文窗口和更小的长度惩罚,从而有更多空间继续推理。

所以,这条系统指令选择的是后训练中已经塑造好的行为;把同样的指令加给一个任意模型,不会有同样的效果。

![图 26:DeepSeek V4 在报告的不同部分分别描述了三种强度模式和更大的教师池。教师池包含十多个领域专才,但报告没有披露这些教师如何映射到 Non-think、Think High 和 Think Max。](/images/distilled/controlling-reasoning-effort/28.png)

遗憾的是,公开报告(其他部分写得相当详细)没有把推理模式与领域专才的描述充分打通,无法据此还原具体的教师指派。

不过报告明确提到:最终这个支持多档推理强度的模型,是通过 **on-policy 蒸馏**从这些教师模型蒸馏而来的。

总结一下 DeepSeek V4 的做法:在后训练阶段分别培养三个推理专才——从基座出发,先 SFT,再用 GRPO 做 RLVR;每种模式的 RL 配置不同,各自的上下文窗口和长度惩罚不同,Think Max 额外配一条特殊系统指令。然后,连同领域专才在内,把这些不同模式的专才蒸馏进一个统一的检查点,支持全部三档强度。

### 6.2 Nemotron 3 Ultra:习得模式 + 硬性预算

[Nemotron 3 Ultra 技术报告](https://research.nvidia.com/labs/nemotron/files/NVIDIA-Nemotron-3-Ultra-Technical-Report.pdf)描述了三个设置:reasoning-off、regular 和 medium-effort,与上一节的 DeepSeek V4 类似。medium-effort 是比 regular 更便宜的推理模式。NVIDIA 在 SFT 阶段引入该模式——使用 GPT-OSS-120B 在其中等强度模式下生成的样本——随后在 RLVR 中进一步优化:约 2.5% 的 RLVR prompt 使用 medium-effort(对应按长度调整奖励)。

#### 6.2.1 推理时使用 Nemotron 推理预算

推理时,三种模式都通过 [chat 模板](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4/blob/main/chat_template.jinja)选择。

![图 27:通过 chat 模板选择 Nemotron 3 Ultra 的推理设置(示例来自[官方模型卡](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b/modelcard))。](/images/distilled/controlling-reasoning-effort/29.png)

1) **Regular** 是默认项,使用 `enable_thinking=True`,assistant 回答以 `<think>` 开标签起始。

2) **Medium-effort** 使用 `enable_thinking=True` 搭配 `medium_effort=True`,后者还会向最新的用户消息追加 `{reasoning effort: efficient}`。

顺带一提,让事情更复杂一点:regular 和 medium-effort 模式还可以再叠加一个独立的推理时**推理预算**(reasoning budget)。这个预算充当外部停止机制:在其开源实现中,chat 客户端会要求模型在选定的 token 上限附近结束推理轨迹;如果模型还没有输出 `</think>`,客户端会直接关闭推理块,继续生成最终答案。也就是说,**习得的强度模式决定模型「怎么花」推理 token,而预算约束推理轨迹「能花多久」**。两者可以按需搭配更紧或更松的预算,在成本与准确率之间取舍。

3) **Reasoning-off** 使用 `enable_thinking=False`,预填一个空的 `<think></think>` 块(与第 4 节 Qwen3 的做法类似),模型直接进入最终回答。可见这些都是 chat 模板层面的控制,而不是系统提示词。

#### 6.2.2 Nemotron 的预算感知训练

上述推理控制背后有两个相关的 SFT 组件。第一个用 GPT-OSS-120B 的轨迹引入 medium-effort 行为,如前所述;第二个则为**硬性推理预算**做准备。

构造训练数据的方法是:取常规的推理轨迹,在随机选取的 token 预算处截断,保留原始最终答案;插入的 `</think>` token 在 SFT loss 中被掩码。这样,模型就能见到「推理块被外部关闭后,必须从未完成的推理轨迹直接跳到答案」的样本。

medium-effort 训练随后延续到 RLVR 阶段:约 2.5% 的 RL prompt 在数学、STEM 和编程任务中使用 medium-effort 设置。报告指出,该模式还可以通过奖励超参校准——按长度调整奖励,从而在成本-质量权衡上提供额外控制。

![图 28:Nemotron 3 Ultra 通过教师生成的 SFT 数据、随机预算截断和 RLVR 中的少量 medium-effort 子集引入中等强度。](/images/distilled/controlling-reasoning-effort/30.png)

### 6.3 Kimi K2.5:预算与无预算 RL 交替进行

[Kimi K2.5 技术报告](https://arxiv.org/abs/2602.02276)讨论了一种名为 Token Efficient RL 的训练方法,用于降低推理开销。(本周虽然发布了 K3,但 K3 的推理强度方法尚未公开,可能与 K2.5 类似或相关。)

#### 6.3.1 Kimi 的 Toggle 方法

报告指出,固定的 token 预算会让推理模型过拟合到短解答:模型确实更简洁(更快、更便宜),但可能失去从更多推理时计算中获益的能力,表现反而变差。

![图 29:Toggle 方法让 Kimi K2.5 在保持整体基准表现相近的同时大幅提升 token 效率。标注图,来自 https://arxiv.org/abs/2602.02276](/images/distilled/controlling-reasoning-effort/31.png)

Kimi K2.5 的方法叫 **Toggle**,每隔固定训练步数,在两个 RL 阶段之间交替:

1. **预算阶段**:鼓励正确解答控制在按问题估计的 token 预算内。
2. **无约束阶段**:恢复常规的最大生成长度,让模型仍然能从长解答中学习。

每个问题的预算,取 RLVR 中正确 rollout 的回答长度的某个分位数来估计;而且只有当该问题的平均准确率超过阈值后才启用预算约束——避免在模型还未能可靠解题时就强迫它缩短推理。

![图 30:Toggle 方法两阶段概览。](/images/distilled/controlling-reasoning-effort/32.png)

报告在 K2 Thinking 上评估了 Toggle:生成 token 减少约 25–30%,基准表现几乎不变。这种行为还能从数学、编程 RL 任务迁移到 GPQA 和 MMLU-Pro。

Toggle 给出了一个具体的旗舰模型配方:在保留测试时扩展能力的前提下,训出更省 token 的推理策略。

#### 6.3.2 Toggle 在推理时带来了什么

Toggle 完全发生在 RL 训练阶段。两个交替阶段更新的是同一个策略(LLM),最终(统一的)检查点上并没有「预算/无预算」的选择器。推理时,模型默认就在 thinking 模式下运行。

不过有意思的是,Kimi K2.5 本身在一些 API(如 vLLM、SGLang)里另外暴露了 thinking 和 instant 两种模式的二元开关:thinking 默认开启;instant 则通过官方 API 的 `thinking: {"type": "disabled"}` 或 serving 时的 `chat_template_kwargs={"thinking": False}` 关闭推理轨迹。但这些设置与 Toggle 无关。

此外,官方报告并没有为 instant 模式提供专门的训练配方。不过,K2.5 的 SFT 数据同时来自早期的 K2(直接回答,无长推理)和 K2 Thinking(产生长推理轨迹)两个模型——这与上面 Nemotron 3 的做法类似,统一检查点因此同时见过两种回答格式。推理时由 chat 模板选择:thinking 模式预填一个开口 `<think>` 标签,instant 模式预填一个空 `<think></think>` 块。同样遗憾的是,报告没有披露确切的数据配比,也没说明是否使用过额外的分模式 RL。

更新的 Kimi K3 则提供了更直接的推理时强度接口。[目前的 Kimi Code 文档](https://www.kimi.com/code/docs/en/kimi-code/models.html)列出了 low、high、max 三档(默认 max),通过 `reasoning_effort` 参数传入。但 Moonshot 还没有解释这三档在训练上是如何产生的;其[发布博客](https://www.kimi.com/blog/kimi-k3)说这些细节会在未来的 K3 技术报告中公布,我会持续关注。

### 6.4 GLM-5:通过 SFT 引入轮次级与交错思考

[GLM-5 技术报告](https://arxiv.org/abs/2602.15763)把 GLM-4.5 引入的二元 thinking 开关扩展到了多轮与工具调用场景。它描述了三种相关行为(而不是三个强度档位):

- **交错思考(Interleaved thinking)**:在每次回答和工具调用之前插入一段推理块。
- **保留思考(Preserved thinking)**:跨轮保留之前的推理块,供模型后续复用。
- **轮次级思考(Turn-level thinking)**:对话中的每个请求可单独启用或禁用推理。

推理时,轮次级思考才是真正的开关。在 [Z.ai API](https://docs.z.ai/guides/capabilities/thinking-mode) 中,thinking 默认开启,单个请求可用 `thinking: {"type": "disabled"}` 关闭。托管实现未公开,但开源的 [GLM-5 chat 模板](https://huggingface.co/zai-org/GLM-5/blob/main/chat_template.jinja)展示了自托管(Transformers、vLLM、SGLang)时的等价机制:开启时 assistant 回答以 `<|assistant|><think>` 起始,关闭时以 `<|assistant|></think>` 起始——后者立即关闭推理块,生成直接进入最终答案。

报告称,这些行为是在多任务 SFT 中连同更新后的 chat 模板一起引入的。

SFT 之后,GLM-5 依次经过推理 RL、agentic RL 和通用 RL;最后一步 on-policy 蒸馏以前面各阶段的检查点为教师,帮助最终模型恢复在串行 RL 阶段中可能退化的能力。

![图 31:GLM-5 训练流水线。](/images/distilled/controlling-reasoning-effort/33.png)

### 6.5 Qwen3:模式融合 + 推理时截断

Qwen3 在第 4 节已经讲过,这里只总结与本节对比相关的部分。按 [Qwen3 技术报告](https://arxiv.org/abs/2505.09388),其后训练流水线有四个阶段:长思维链 SFT、推理 RL、思考模式融合(Thinking Mode Fusion)和通用 RL。

思考模式融合是强度开关的关键阶段:模型在 SFT 中同时学习 thinking 与 non-thinking 样本——`/think` 样本包含推理轨迹,`/no_think` 样本以空 `<think></think>` 块开头并配一个简短回答。随后的通用 RL 阶段强化两种行为的指令与格式遵循。

Qwen3 还支持硬性思考预算:到达请求的阈值时,推理区段被中止,插入一条「停止思考」指令后,模型继续生成最终答案。报告称这种「部分推理」行为并没有专门训练,而是在思考模式融合之后自发涌现的。

所以 Qwen3 的方案是:一个习得的开关 + 一个推理时预算。与 DeepSeek V4 和 Nemotron 的配方类似,但更简单。

### 6.6 Inkling:以连续强度值做 RL 条件化

Inkling 在 5.3 节已经讲过。简言之,其[技术报告](https://thinkingmachines.ai/news/introducing-inkling/)提到他们使用连续强度条件化(0.0 到 1.0 之间的值),而不是固定的强度标签。

在相对较小的初始 SFT 之后,Inkling 的后训练主要来自异步 RL,rollout 超过 3000 万条。期望强度写在系统消息里,RL 期间的 token 长度惩罚按该值调整:如前所述,token 成本越高回答越短,token 成本越低,模型推理空间越大。

### 6.7 已知配方总览

下表汇总了六份技术报告实际披露的内容。

![图 32:六个带推理强度设置的开源模型,其已披露训练机制与推理控制的对比。](/images/distilled/controlling-reasoning-effort/34.png)

纵观这六个开源模型,可以看出一个共同框架。**第一**,通过 SFT 和 chat 模板引入强度模式控制:Qwen3 显式混合 thinking 与 non-thinking 样本,GLM-5 则加入了交错、保留和轮次级思考模式。

**第二**,模式条件化的 RL 阶段:上下文窗口和长度惩罚随请求的强度变化。DeepSeek V4、Nemotron 3 Ultra 和 Inkling 都采用这种方式。

**第三**,提升显式预算下的鲁棒性:Nemotron 用随机截断的轨迹训练,Qwen3 能从被强制中止的推理区段继续作答,Kimi 则在预算与无预算 RL 之间交替。这些方法都有助于在可用推理长度变化、甚至被截断时保住答案质量。

## 7. 总结

本文列举的开源模型,通过多种不同机制实现推理强度:相似的标签背后,可能是分别训练的专才、混合 SFT 数据、模式条件化奖励、硬性 token 预算,或这些方法的组合。

很难说哪种方法最好。这些模型的基座检查点、训练数据、后训练算力、评测基准和部署目标都不同,报告里也省略了太多做受控比较所需的细节。(而且也许根本不存在放之四海皆准的方案——对交互式助手有效的方法,可能并不适合长时间运行的 coding agent。)

圣杯当然是**自动强度选择**。之前 GPT 5 的 Auto 模式就尝试过,但这个问题很难,最终的实现可能失败的成分多于成功,所以它后来从界面上被移除了(至少我已经找不到它)。

**在不久的将来,我认为推理强度仍会是一个显式的模型输入,最常见的载体是系统提示词;但 LLM 外围的 agent 封装/harness,或内部的路由器,可能会越来越多地根据任务状态和可用资源自动推断合适的模式与预算(当然,始终允许用户手动覆盖)。**

我仍然期待强度选择变得更自动:就像 GPT 5 的 auto 模式设想的那样,一个便宜的模型或路由器根据请求、工具状态、剩余时间或 token 预算来选择模式,同时保留用户覆盖的通道——当你想优化延迟、成本或极限性能时,覆盖仍然有用。

我知道这篇文章不短,话题也不算最抢眼。但鉴于围绕 LLM、推理模型和 agent 的讨论这么多,推理强度这个角度此前还鲜有人系统梳理,希望这份综述是独特且有用的!

## 延伸阅读

如果你想要亲手实现推理模型背后的核心训练方法,我的 [Build a Reasoning Model (From Scratch)](https://sebastianraschka.com/books/#build-a-reasoning-model-from-scratch) 一书会带代码一步步走完可验证奖励强化学习与推理时扩展。

本文关注的是「训好的推理模型如何支持多档强度」,而这本书则退一步,讲「如何先把传统 LLM 变成推理模型」。它是 [Build a Large Language Model (From Scratch)](https://sebastianraschka.com/books/#build-a-large-language-model-from-scratch) 的续作,正好从那本书结束的地方开始。
