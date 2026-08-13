---
title: "DeepSeek Harness 到底开源了什么"
date: "2026-08-14"
description: "从官方发布页、1.2 万次提交、四套运行预设、Agent Loop 和会话日志一路读到 88 页 Cordis 论文，再核对发布首日的安全复现与用户反馈。DeepSeek Harness 展示了一套很完整的 Agent 运行时设计，也把开发者预览版的缺口原样带到了公众面前。"
tags:
  - DeepSeek
  - Agent
  - Harness
  - Cordis
  - 开源
---

昨晚看到 DeepSeek Harness 发布时，我先搜错了项目。

搜索结果前排有一个同名仓库，做的是 DeepSeek 协议适配，已经存在几个月。DeepSeek 这次公开的项目在 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)。这件小事很能说明发布首日的信息环境。传言、旧项目和根据招聘信息写成的预告混在一起，单看搜索摘要，很容易把几代东西拼成一个故事。

我随后拉下官方仓库，把阅读点固定在提交 `47f943859bef60e4160492346772ded9b24f765a`。我沿着默认配置找到 Agent Loop、工具调度、JSONL 会话存储、Code Mode 和本地沙箱，又读了官方链接的 88 页 Cordis 预印本。最后再回到 GitHub Discussions、Hacker News 和 Reddit，看已经有人跑出了什么，又撞上了什么。

读完以后，DeepSeek Harness 在我这里有了一个比较清楚的位置。它是一套面向 Harness 开发者的 Agent 运行时，同时附带一个可直接使用的本地 Web 产品。它最有分量的部分是插件生命周期、可重建的会话事件流，以及工具执行前后的统一协议。至于它能否让同一个模型写出更好的代码，公开材料现在还答不了。

## 先把发布版本说准

DeepSeek 在 8 月 13 日晚宣布 v0.1 Developer Preview，代码按 MIT 许可证开放。这里的 v0.1 是发布名称，发行物仍处在 RC 阶段。

我检查时，GitHub `master` 里的版本是 `0.1.0-rc.5`，npm 的 `latest` 已经指向 `0.1.0-rc.6`。仓库没有 tag，也没有 GitHub Release。官方 README 用大写字母提醒兼容性破坏一定会发生。这些细节看着琐碎，安装插件或保存会话格式时却很要命。今天写给 rc.6 的插件，下一版未必还能直接加载。

仓库在发布当天创建，GitHub 页面却显示 12,293 次提交。这个数字至少说明公开日期和开发起点相隔很远。项目很可能从内部代码库整体迁出，官方没有解释迁移过程，我也不把这个推测写成内幕。源码规模能直接数出来。当前工作区有 248 个 `package.json`，`packages` 下以 `@deepseek-ai/dsh` 命名的模块有 219 个，TypeScript 源文件约 2,400 个。这是一套已经长了很久的大型系统。

## Harness 在这里管什么

模型负责根据当前输入选择下一步。Harness 决定模型会看到哪些历史和工具，也负责把工具调用送进权限检查。执行结果怎样落盘、会话怎样恢复，同样归它管。

DeepSeek 把这些工作放进一棵 Cordis 插件树。模型适配器是插件，工具注册表和 Agent Loop 也走同一套装载协议。会话存储、沙箱与 Web UI 都能从配置里替换。官方架构文档把这句话写得很重，产品层没有一块必须修改的特权内核。

系统依然有固定约束。插件要遵守服务接口、事件类型和会话格式，Cordis 运行时本身也必须存在。所谓一切皆插件，准确含义是产品能力通过统一的组合接口接入，开发者可以替换某个实现，无需去 Agent Loop 里加一条产品专用分支。

一次启动会把多个配置层叠起来。

```text
base bundle
    ↓
web 或 headless bundle
    ↓
profile patch
    ↓
用户目录 patch
    ↓
命令行 patch
```

后面的层按行覆盖前面的层。`dsh --profile web --dump-config` 能打印机器最终装载的整棵树。这个命令比读默认 YAML 更重要，因为用户配置、模型设置和额外插件都可能改变实际运行形态。

Web 端提供四个 Agent preset。它们共享宿主侧的会话、模型和权限服务，各自决定一个会话会拿到哪些工具和提示。

| 预设 | 模型拿到的能力 | 当前用途和限制 |
|---|---|---|
| Standard | 文件、Shell、Skill、计划、子代理、工作流和网页搜索 | Web 新会话的默认选择 |
| Code | Standard 的能力通过一个 TypeScript SDK 呈现 | 减少模型往返，执行安全性仍由原工具协议负责 |
| Minimal | 持久 Bash 与 `str_replace_editor` | 面向基准测试，不装上下文压缩 |
| Cordis | Standard 加运行时检查和临时插件工具 | 供 Harness 开发，权限按 Shell 同级看待 |

Codex 和 Claude Code 的子代理 provider 也在标准配置文件里，不过默认行是关闭的。多供应商 `pi-ai` 适配器已经装载，初始配置没有任何路由。MCP 客户端有 stdio 和 HTTP 实现，默认同样没有启用服务器。代码存在和开箱即用是两件事，读这种大配置时必须逐行确认 `disabled` 与默认值。

## Cordis 怎样让插件可以撤回

普通插件系统很擅长加载，卸载通常麻烦得多。一个插件注册了事件监听器，又开了定时器。它后来被热替换，旧监听器若还在，下一次事件就会执行两份逻辑。它提供的服务若先消失，依赖者手里还可能留着旧引用。

Cordis 要求每项注册都带着清理办法。`ctx.effect()` 执行一段安装逻辑，并接收它返回的 disposer。插件卸载时，disposer 按相反顺序执行。`ctx.on()`、子插件装载和服务注册已经包进这个机制，插件作者管理连接或 watcher 时才需要手写 effect。

```ts
ctx.effect(() => {
  const watcher = watch(path, onChange)
  return () => watcher.close()
})
```

依赖也会持续检查。一个插件通过 `inject` 声明自己需要 `tools` 服务。provider 尚未出现时，它停在 pending。provider 热替换时，Cordis 先让依赖者退出，等清理结束后再撤掉旧 provider。新 provider 到位，依赖者重新装载。加载顺序由当前服务关系决定，不靠 YAML 的书写顺序碰运气。

这就是论文所说的时间可组合性和空间可组合性。前者处理一项贡献怎样撤回，后者处理组件在运行期间怎样跟随依赖变化。论文把一个 effect 写成下面这个形式。

```text
EΓ = Γ -> Γ × (Γ -> Γ)
```

一次变换除了给出新状态，还给出一个能回到旧状态的逆操作。运行时把这些逆操作累积起来，卸载时再执行。论文随后把依赖表、provider 身份和 Fiber 生命周期放进同一套操作语义，证明良构状态在转移后仍然良构。满足组件 effect 相互独立、依赖图无环和执行有界等条件时，系统会到达安静状态，不同合法调度得到的最终状态在论文定义的观察范围内等价。

证明有明确的边界。运行时只负责保存并调用 disposer，它不会验证 disposer 真的撤销了原操作。插件已经发出的网络请求也收不回来。组件绕开 Context 改动的全局状态，不在定理覆盖范围内。依赖成环时，相关 Fiber 会一直 inactive。论文把自演化 Agent Harness 列为后续验证方向，当前案例研究讲的是拥有四千多个社区插件的 Koishi，而且 Koishi 使用的是 Cordis v3，论文描述的主体是 v4。

因此，Cordis 论文能解释 Harness 的插件装卸为何这样设计，也能为一组受约束的状态转移给出证明。它没有证明 DeepSeek Harness 整体正确，更没有证明 Agent 会安全地改写自己。

## 会话日志承担了什么

插件树解决运行时由哪些部件组成，会话日志解决一次 Agent 工作怎样被记住。

DeepSeek Harness 的 `Session` 是仅追加的类型化事件流。模型历史没有另存一份可变消息数组，`deriveMessages()` 从事件流的当前 surface 投影出下一次请求。用户消息、最终 assistant 消息和工具结果会进入 surface。流式 chunk、回合边界和请求元数据继续留在原始日志里，供界面、统计和恢复使用。

一个普通回合大致这样走。

```text
turn/start
  -> 领取用户消息
  -> 组装 system prompt 与工具 schema
  -> step/start
  -> user/message
  -> request/header + request/context
  -> llm/stream
  -> assistant/chunk ...
  -> assistant/message
  -> tool/call ...
  -> tool/result ...
  -> step/end
turn/end
```

`request/header` 保存模型调用参数、渲染后的 system prompt 和工具 schema。`request/context` 保存 provider、model 与窗口容量。运行时还会检查本次请求能否从日志重建。官方把这条约束概括成 model-visible means logged。

这个设计带来一个很实在的好处。Trajectory 视图、恢复、分叉和重放读取的是同一条事件流，界面不会维护另一套猜出来的 Agent 状态。它也让调试细到模型收到的工具 schema 和 provider 返回的 reasoning chunk，而不只是一张聊天记录。

仅追加也没有阻止上下文整理。工具结果超过默认阈值后，裁剪器会追加一个替换事件，保留开头 4,096 个字符和结尾 1,024 个字符。原事件仍在日志里，模型看到的 surface 改用短版本。请求接近模型窗口的八成时，压缩器先尝试这类无模型裁剪。压力还在，它再总结旧区间，并保留约一成六的近期上下文。原始轨迹和模型下一轮看到的历史由此分开。

持久化默认使用 JSONL。模型请求和有副作用的顶层工具之前会触发耐久检查点。进程若在工具调用后、结果落盘前崩溃，恢复逻辑不会假装那个工具没执行。它补上一条 `TOOL_OUTCOME_UNKNOWN`，要求模型先核验外部世界。这里守住的是可解释恢复，外部副作用仍然没有 exactly-once 保证。

## Code Mode 省掉的是模型往返

PTC Code Mode 是发布讨论里最容易被说大的功能。它与 Standard 共用工具集合和 Agent Loop，区别出现在工具怎样呈现给模型。

Native 模式把每个工具分别放进请求。Code Mode 根据当前工具表生成 TypeScript SDK，模型直接调用的外层工具只剩 `run_code`。模型可以写一段异步程序，连续读取文件、处理返回值，再根据条件调用下一个工具。中间变量留在 worker 内，不会每一步都变成一段模型上下文。

```ts
const matches = await tools.grep({ pattern: "TODO", path: "src" })
if (matches.length > 0) {
  const file = await tools.read({ path: matches[0].path })
  return file
}
return "clean"
```

每个 SDK 副调用仍然走原生工具的完整管线。参数校验、权限策略和人工审批都没有被 `run_code` 绕过。工具明确声明并发安全时，执行 body 可以重叠，默认上限为十。独占工具会形成屏障，准备阶段与结果提交仍按程序发起顺序处理。

执行环境每次新建一个 Node worker thread，环境变量为空。默认限制包括 60 秒计算时间、600 秒墙钟和 512 MB old generation，外层输出上限为 64 MiB。一次运行结束后，JavaScript 状态不保留。工具已经造成的文件或网络影响不会随外层程序失败而回滚。

这套机制很可能减少长工具链的请求次数，也能避免大块中间 JSON 反复送给模型。仓库目前没有给出延迟、token 或任务成功率对照，`BENCHMARK.md` 全文只有三行运行说明。Code Mode 会省多少，哪些任务会因模型写错控制流而更差，都要等同模型、同任务和同预算的测试。

## DeepSeek 模型接入做了专门处理

默认路由是 `deepseek-official` 与 `deepseek-v4-flash`。官方适配器直接处理流式 Chat Completions，能识别 DeepSeek 的 `reasoning_content`。带工具调用的 assistant 回合会把 reasoning 送回后续请求，普通回合不带回这部分历史。缓存命中 token 会单独记进 usage。

这些细节与 DeepSeek 近两代模型报告里的 Agent 训练方式相符。V3.2 报告明确区分 tool role 和 user role，也讨论了推理内容在工具回合间怎样保留。V4 报告中的内部代码评测框架只提供 Bash 和文件编辑工具，最多 500 步，使用 512K 上下文。它和开源项目的 Minimal preset 很接近。

接近仍只是设计线索。V4 报告没有写 DeepSeek Harness 这个名字，也没有给出开源提交。论文里的 SWE 和 Terminal Bench 数字属于模型在内部框架上的结果，不能挂到今天发布的仓库名下。DeepSeek Harness 自己也没有公开四种 preset 的消融实验。

适配器还有几处容易忽略的行为。原生 DeepSeek 路径目前只接文本，图片会被拒绝。每次请求都会把稳定匿名用户 ID 发给配置的 base URL，有 session 时还会带准确的 session ID。把 base URL 改成第三方网关，这些 header 也会发给该网关。

## 安全边界要按代码理解

新会话默认使用 `workspace-write`，需要审批时选择 ask。Linux 进程执行优先用 bubblewrap，后备是 Landlock。macOS 使用 Seatbelt，Windows 使用受限 token 与 ACL。没有可用 runner 时，默认路径会失败，不会悄悄回到无隔离执行。

这个沙箱管理的是文件效果。官方 CLI 文档明确写着，读取、网络访问和进程可见性没有被限制。Code Mode 的 worker 也只提供 containment，文档没有把它称为安全边界。Cordis 创造模式运行模型写出的 JavaScript，host realm helper 仍可能通向 Node 能力，官方要求把这项权限按 Bash 对待。Minimal preset 又在自己的 realm 里装了本地文件系统，适合放在基准测试已有的外层容器中使用。

官网安全说明的态度很坦白。处理不可信代码时，官方建议再套专用 VM 或容器，并保留人工确认。网页、依赖、MCP server 和 Skill 都可能携带提示注入。能装卸插件与能安全执行不可信插件之间，还隔着一层操作系统边界。

发布首日已经出现一份需要认真对待的第三方安全报告。[Discussion 159](https://github.com/deepseek-ai/deepseek-harness/discussions/159) 锁定的正是本文检查的提交。报告者让一个受 `workspace-write` 限制的后台进程在工作区内持续交换目录项，诱导宿主文件服务在检查路径以后写到工作区外。他给出的 provider 级测试五次全部命中，完整模型工具路径三次全部命中。报告只验证了越界覆盖，没有声称已经完成远程代码执行。本文截稿时讨论区还没有维护者回复，我也没有独立执行这份 PoC。它是一份步骤完整、带对照实验的外部报告，修复状态仍未知。

隐私也要拆开看。默认会话写在本机，遥测模式是 `DISABLED`。用户显式启用 `FULL` 后，基础配置会把投影后的会话事件发往遥测端点，而且没有内置脱敏规则。消息正文、工具参数与结果、工作路径都可能进入记录。正常的模型调用和网页搜索本来就会向各自 provider 传数据。这里的本地优先指默认存储和遥测选择，使用网络模型时仍有外发流量。

## 发布首日的人已经撞到了哪里

社区里最有价值的反馈不在转发帖，而在带版本、环境和复现步骤的 Discussions。

[Discussion 131](https://github.com/deepseek-ai/deepseek-harness/discussions/131) 的报告者在 Windows 11、Node 24 和 rc.6 上使用 PTC。一次任务派生出约 56 个子代理，服务进程升到约 2.2 GB，单核跑满二十分钟，Web UI 随后失去响应。代码有默认深度限制，没有全局子代理总量和并发宽度预算。这和 Reddit 上“界面、Code Mode 很好用，子代理错误很多”的首日体验能互相对上，仍然只算早期个案。

[Discussion 380](https://github.com/deepseek-ai/deepseek-harness/discussions/380) 记录了作者开发第一个插件时遇到的六个坑，其中包括 bundle 声明遗漏后安装成功却不生效，以及 preset persona 遮住全局 persona。另一位 Windows 10 用户在 [Discussion 197](https://github.com/deepseek-ai/deepseek-harness/discussions/197) 给出了原生依赖崩溃的最小复现。这些报告说明插件系统已经能让外部开发者动手，也说明错误信息、平台兼容和升级约定仍在开发者预览期。

正面反馈同样有具体内容。有人把本地 Qwen 通过 llama.cpp 接进 dsh，跑了一个小型 Python 项目。也有人认可 Trajectory 视图，随后报告构建体积和空闲内存偏大。这里没有统一任务和资源记录，我不会把几条顺利体验换算成性能结论。

发布热度倒是毫无疑问。我在 8 月 14 日凌晨抓取 GitHub API 时，仓库已经超过 3.5 万 stars，Hacker News 主帖也已接近两百条评论。热度说明大家等一套官方 Harness 等了很久，成熟度仍要看后续修复、版本承诺和可复现实验。

## 我怎样评价这次开源

DeepSeek 公开了一份内容很足的 Agent 系统样本。最值得读的代码集中在三处。Cordis 把装载和卸载写成同一份协议，会话事件流让模型请求能够重建，工具执行则把 Native 与 Code Mode 放在共同的策略管线里。三处都处理了失败和恢复，没有停在接口图上。

这套选择也带来很高的复杂度。两百多个包、Host 与 Agent 两个组合平面、scope 和 isolate 的解析规则，会让插件作者付出明显的学习成本。Cordis 论文给了这些机制一套严密语言，工程收益还缺少对照。Koishi 的长期使用能说明它可以支撑大型插件系统，无法替 DeepSeek Harness 回答资源开销和 Agent 成功率。

如果目标是研究 Harness，今天就值得把仓库拉下来。Agent Loop、append-only surface replacement、Code Mode 的子调用协议，以及 Cordis 对 provider 撤出的处理，都比二手介绍有价值得多。

如果目标是把它接进日常生产仓库，我会先固定 npm 与插件版本，把整个进程放进 VM 或容器。然后关掉不需要的网络和遥测，给子代理设外部资源上限。最后再用自己的任务集比较 Standard、Code 与 Minimal。安全报告有结论、会话迁移策略出现、官方给出可复现 benchmark 以后，团队才有足够依据扩大使用范围。

DeepSeek Harness 现在已经展示了它想解决的问题，也把未解决的部分留在同一个公开仓库里。接下来最能改变我判断的，不会是 star 再涨多少。我要看 Discussion 159 怎样修，插件 ABI 怎样稳定，以及四种 preset 在同模型条件下究竟差多少。

## 主要来源

- [DeepSeek Harness 官方页面](https://www.deepseek.com/harness/)
- [DeepSeek 官方发布公告](https://x.com/deepseek_ai/status/2087887408440164663)
- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [官方架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [Cordis 时空可组合性预印本](https://github.com/cordiverse/paper)
- [DeepSeek V4 技术报告](https://arxiv.org/abs/2606.19348)
- [DeepSeek V3.2 技术报告](https://arxiv.org/abs/2512.02556)
- [官方数据处理说明](https://www.deepseek.com/harness/data-processing/)
- [官方安全说明](https://www.deepseek.com/harness/privacy/)
- [文件边界竞态报告](https://github.com/deepseek-ai/deepseek-harness/discussions/159)
- [子代理资源失控报告](https://github.com/deepseek-ai/deepseek-harness/discussions/131)
- [插件开发实录](https://github.com/deepseek-ai/deepseek-harness/discussions/380)
- [发布首日 Hacker News 讨论](https://news.ycombinator.com/item?id=49285244)
