---
title: "DeepSeek Harness 到底开源了什么"
date: "2026-08-14"
description: "DeepSeek Harness 用 Cordis 组织整套 Agent 运行时。本文从插件生命周期与事件日志入手，解释 Code Mode 和沙箱边界，并判断这个开发者预览版适合谁使用。"
tags:
  - DeepSeek
  - Agent
  - Harness
  - Cordis
  - 开源
---

8 月 13 日晚，DeepSeek 发布了 Harness v0.1 Developer Preview。到第二天凌晨，官方仓库已经超过 3.5 万 stars。一家模型公司怎样搭建自己的 Agent 运行时，如今有了一份可以直接运行的答案。

DeepSeek Harness 同时交付了一款本地 Web 编码 Agent 和一套面向开发者的运行时。模型负责提出下一步动作，Harness 决定模型能看到哪段历史、拿到什么工具。工具调用还要经过权限检查，结果随后写进可以恢复的会话。

这套系统最有分量的地方集中在插件生命周期与会话事件流。Native 工具和 Code Mode 也走同一条执行协议。公开材料已经足够解释这些设计怎样工作，暂时还没有一组 Harness benchmark 能回答另一个问题，即它能否让同一个模型完成更多任务。

## 从本地 Web 到四种预设

运行 `npx @deepseek-ai/dsh web`，浏览器会在 `127.0.0.1:3080` 打开本地界面。用户在这里选择工作区和模型，也能查看每一步执行轨迹。新会话还要选择一种 Agent preset。

本文以提交 `47f943859bef60e4160492346772ded9b24f765a` 为代码快照，版本与讨论状态截至 2026 年 8 月 14 日。搜索结果里还有一个更早的同名仓库，它做的是 DeepSeek 协议适配。本文所说的项目只指 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)。

官方把这次发布称为 v0.1，实际发行物仍处在 RC 阶段。代码快照里的版本是 `0.1.0-rc.5`，npm 的 `latest` 已经指向 `0.1.0-rc.6`。仓库没有 tag，也没有 GitHub Release。稳定版还没到。README 明确提醒兼容性破坏一定会发生，今天为 rc.6 写的插件，下一版未必还能直接加载。

Web 界面提供四种 Agent preset。它们共用宿主侧的会话、模型和权限服务，各自改变工具怎样呈现给模型。

| 预设 | 模型拿到的能力 | 当前用途和限制 |
|---|---|---|
| Standard | 文件、Shell、Skill、计划、子代理、工作流和网页搜索 | Web 新会话的默认选择 |
| Code | Standard 的能力通过一个 TypeScript SDK 呈现 | 减少模型往返，执行安全性仍由原工具协议负责 |
| Minimal | 持久 Bash 与 `str_replace_editor` | 面向基准测试，不装上下文压缩 |
| Creator | Standard 加运行时检查和临时插件工具 | 内部 preset id 为 `cordis`，权限按 Shell 同级看待 |

## 一切皆插件怎样落到代码里

DeepSeek 把模型接入和 Agent Loop 放进一棵 Cordis 插件树，工具注册表也使用同一套装载协议。会话存储、沙箱与 Web UI 都能从配置里替换。产品能力不需要在 Agent Loop 中增加专用分支，新的实现只要接入既有服务与事件协议。

系统仍然有固定约束。插件必须遵守服务接口和会话格式，Cordis 运行时本身也不能拿掉。一切皆插件描述的是产品能力怎样组合，并不意味着系统没有核心协议。

启动时，配置会沿着下面几层叠加。

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

后面的层按行覆盖前面的层。`dsh --profile web --dump-config` 会打印机器最终装载的插件树，比单独查看默认 YAML 更能说明一次运行究竟启用了什么。

Codex 和 Claude Code 的子代理 provider 已经写进标准配置，默认处于关闭状态。多供应商 `pi-ai` 适配器也已装载，初始配置没有路由。MCP 客户端实现了 stdio 和 HTTP，开箱时没有启用任何服务器。代码里的能力边界因此比功能清单更细，存在实现不等于默认可用。

## Cordis 让插件能够完整卸载

一个 provider 被热替换时，仍然持有它的 consumer 必须先停下来。旧监听器若没有清掉，下一次事件会执行两份逻辑。旧服务引用继续留在内存里，新的 provider 即使已经装载，调用方仍可能摸到过期对象。

Cordis 要求每项注册都带着清理办法。`ctx.effect()` 执行安装逻辑，并接收它返回的 disposer。插件卸载时，disposer 按注册顺序的逆序启动，多个异步 disposer 可能并发执行。`ctx.on()`、子插件装载和服务注册已经包进这个机制，插件作者管理连接或 watcher 时才需要手写 effect。

```ts
ctx.effect(() => {
  const watcher = watch(path, onChange)
  return () => watcher.close()
})
```

依赖也会持续检查。一个插件通过 `inject` 声明自己需要 `tools` 服务。provider 尚未出现时，它停在 pending。旧 provision 开始恢复时，依赖它的 consumer 会先失活并完成清理。新 provider 到位，依赖重新解析，consumer 随后装载。顺序来自当前服务关系，不靠 YAML 的书写位置。

Cordis 论文把前一种能力称为时间可组合性，后一种称为空间可组合性。论文中的 effect 是一项状态变换，同时附带恢复函数。运行时保存恢复函数，卸载时再调用。良构状态能够在这种转移中保持，恢复后的状态也可以与先前状态保持可观察等价。

这些结论依赖很强的条件。插件作者必须提供正确的恢复函数，相关 effect 还要相互独立或可以交换。依赖图不能成环，执行过程也必须有界。

运行时不会验证 disposer 是否真的撤销了原操作。已经发出的网络请求收不回来，绕开 Context 修改的全局状态也不在定理覆盖范围内。论文里的等价指可观察结果等价，不代表外部世界逐字节相同。

论文用 Koishi 的长期运行作为案例。这个生态已有四千多个插件，能说明 Cordis 经受过大型插件系统的使用。案例代码使用 Cordis v3，论文主体讨论 v4，自演化 Harness 仍被列在后续验证中。这篇论文解释了 DeepSeek Harness 为什么这样管理插件，没有替整个 Agent 系统提供正确性或安全性证明。

## 一次 Agent 运行怎样被重建

插件树记录一次运行由哪些部件组成，会话日志记录这些部件做过什么。

DeepSeek Harness 的 `Session` 是仅追加的类型化事件流。模型历史没有另存一份可变消息数组，`deriveMessages()` 从事件流的当前 surface 投影出下一次请求。用户消息、最终 assistant 消息和工具结果会进入 surface。流式 chunk 与回合边界继续留在原始日志里，请求元数据也会保留。

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

`request/header` 保存模型参数、渲染后的 system prompt 和工具 schema。`request/context` 保存 provider 与 model，窗口容量也记在这里。运行时还会检查本次请求能否从日志重建，官方把这条约束概括成 model-visible means logged。

Trajectory 视图、恢复和会话分叉读取同一条事件流，重放也不用另一套状态。调试因此可以追到模型收到的工具 schema，也能看到 provider 返回的 reasoning chunk，而不只剩一张聊天记录。

仅追加没有阻止上下文整理。工具结果超过 8,192 个字符以后，裁剪器会追加替换事件，保留开头 4,096 个字符和结尾 1,024 个字符。原事件仍在日志里，模型看到的 surface 改用短版本。请求接近模型窗口的八成时，压缩器先尝试这类无模型裁剪。压力仍在，它再总结旧区间，并保留约一成六的近期上下文。

持久化默认使用 JSONL。模型请求和有副作用的顶层工具之前会触发耐久检查点。进程若在工具调用后、结果落盘前崩溃，恢复逻辑不会假装工具从未执行。它补上一条 `TOOL_OUTCOME_UNKNOWN`，让模型先核验外部世界。这里守住的是可解释恢复，外部副作用仍然没有 exactly-once 保证。

## Code Mode 把多步调用交给程序

Standard 模式把每个工具分别放进模型请求。Code Mode 根据当前工具表生成 TypeScript SDK，模型直接调用的外层工具只剩 `run_code`。模型可以在一段异步程序里连续读取文件，根据返回值决定下一步。中间变量留在 worker 内，不必每一步都写回模型上下文。

```ts
const { matches } = await tools.grep({ pattern: "TODO", path: "src" })
if (matches.length > 0) {
  const file = await tools.read({ file_path: matches[0].path })
  return file
}
return "clean"
```

每个 SDK 副调用仍然走原生工具的完整管线。参数校验和权限策略照常执行，需要人工审批时也不会被 `run_code` 绕过。工具明确声明并发安全以后，执行 body 才能重叠，默认上限为十。独占工具会形成屏障，准备阶段与结果提交仍按程序发起顺序处理。

执行环境每次新建一个 Node worker thread，环境变量为空。默认计算时间为 60 秒，墙钟上限是 600 秒。old generation 限制为 512 MB，外层输出最多 64 MiB。一次运行结束后，JavaScript 状态不保留，工具已经造成的文件或网络影响也不会回滚。

这种安排能减少长工具链的模型请求次数，也能让大块中间 JSON 留在 worker 内。仓库没有给出延迟、token 或任务成功率对照，`BENCHMARK.md` 全文只有三行运行说明。Code Mode 省多少，仍要用同一个模型和同一批任务来测。

## 它和 DeepSeek V3.2、V4 有什么关系

默认路由使用 `deepseek-official/deepseek-v4-flash`。官方适配器直接处理流式 Chat Completions，也识别 `reasoning_content`。带工具调用的 assistant 回合会把 reasoning 送回后续请求，普通回合不带回这部分历史。缓存命中 token 会单独记进 usage。

V3.2 报告专门讨论过工具协议。把工具交互伪装成 user message 的框架无法得到 thinking-retention 机制的收益，报告建议这类架构使用标准 tool calling，或者切到 non-thinking mode。开源适配器使用标准 tool role，并在工具回合间带回 reasoning。两者在协议上能够对应，这仍不足以证明实现从论文直接派生。

V4 报告披露的内部代码评测框架只提供 Bash 和文件编辑工具，最多运行 500 步，使用 512K 上下文。开源项目的 Minimal preset 同样强调持久 Bash 与 `str_replace_editor`，设计方向很接近。V4 报告没有出现 DeepSeek Harness 这个名字，也没有提供开源提交。论文里的 SWE 与 Terminal Bench 成绩属于模型和未公开内部框架，不能算到今天发布的仓库头上。证据到这里为止。

适配器还有两处实际限制。原生 DeepSeek 路径目前只接文本，图片会被拒绝。每次请求都会把稳定匿名用户 ID 发给配置的 base URL，有 session 时还会带准确的 session ID。base URL 指向第三方网关以后，这些 header 也会送到该网关。

## 安全边界停在哪里

新会话默认使用 `workspace-write`，需要审批时选择 ask。Standard、Code 与 Creator 的文件工具经过宿主文件沙箱。Linux 进程优先由 bubblewrap 执行，后备方案是 Landlock。macOS 使用 Seatbelt，Windows 使用受限 token 与 ACL。没有可用 runner 时，默认路径会失败，不会悄悄回到无隔离执行。

Minimal 有一处重要例外。它的持久 Bash 仍然遵守沙箱策略，`str_replace_editor` 却使用裸 `fs-local`，只接受绝对路径，也没有工作区 containment。编辑器能够修改当前进程账号有权访问的任意路径。这个 preset 应当运行在基准测试已有的容器或 VM 里。

这层保护很窄，主要管理文件效果。官方 CLI 文档明确写着，读取、网络访问和进程可见性没有被限制。Code Mode 的 worker 只提供 containment。Creator mode 会运行模型写出的 JavaScript，host realm helper 仍可能通向 Node 能力，官方要求把它按 Bash 权限看待。处理不可信代码时，整个 Harness 还要放进专用 VM 或容器。

网页和依赖可能携带提示注入，MCP server 与 Skill 也处在同一风险面上。官网建议保留人工确认。这里的插件可组合性解决装载和清理，没有承担不可信代码隔离。

发布首日出现的 [Discussion 159](https://github.com/deepseek-ai/deepseek-harness/discussions/159) 给这条边界加了一个具体案例。报告者让受 `workspace-write` 限制的后台进程持续交换工作区目录项，诱导宿主文件服务在路径检查以后写到工作区外。provider 级测试五次全部命中，完整模型工具路径三次全部命中。报告证明了越界覆盖，没有证明远程代码执行。该结果来自第三方 PoC，本文未作独立复现，截稿时也没有维护者回应。

子代理资源是另一种边界。[Discussion 131](https://github.com/deepseek-ai/deepseek-harness/discussions/131) 的报告者在 Windows 11、Node 24 和 rc.6 上运行 PTC，一次任务派生出约 56 个子代理。服务进程升到约 2.2 GB，单核持续跑满，Web UI 随后失去响应。代码限制了默认递归深度，还没有全局数量与并发宽度预算。深度限制挡不住横向扩张。

隐私设置也要单独看。默认会话保存在本机，遥测模式是 `DISABLED`。用户启用 `FULL` 后，基础配置会把投影后的会话事件发往遥测端点，没有内置脱敏规则。消息正文与工具结果可能进入记录，工作路径和工具参数也在范围内。正常的模型请求和网页搜索本来就会向 provider 传数据，本地优先不等于没有网络流量。

## 为什么它仍是开发者预览

RC 版本错位只是最显眼的一处。默认 JSONL 会话格式仍标为 v0，仓库没有给出稳定的迁移承诺。插件 ABI 同样可能随着下一版改变。两百多个模块给了开发者很大的替换空间，也让兼容性测试变得更重。

[Discussion 380](https://github.com/deepseek-ai/deepseek-harness/discussions/380) 记录了首个插件开发过程中遇到的六个问题。bundle 声明遗漏以后，插件会显示安装成功却没有生效，preset persona 还可能遮住全局 persona。Windows 10 用户在 [Discussion 197](https://github.com/deepseek-ai/deepseek-harness/discussions/197) 提交了原生依赖崩溃的最小复现。错误信息和平台兼容仍在补课，插件作者需要准备跟着 RC 版本一起改。

## 谁适合现在使用

做 Agent runtime、插件系统或 Harness 研究的人，现在就值得读这份代码。Agent Loop 和 append-only surface replacement 提供了完整实现，Cordis 对 provider 撤出的处理也很少见。试用时应固定 commit 与插件版本，让每次结果可以复现。

个人开发者可以在 VM 或容器里接入自己的模型，用真实任务比较 Standard、Code 与 Minimal。网络和遥测只开需要的部分，子代理再加一道外部资源上限。这样得到的结论会比发布首日的零散体验可靠。

团队若准备接进生产仓库，至少要等文件竞态得到官方复现、修复和回归测试。插件 ABI 与会话迁移策略也要稳定下来。随后还需要一组同模型、同任务和同预算的 preset 对照，确认复杂度换来了什么。

## 主要来源

- [DeepSeek Harness 官方页面](https://www.deepseek.com/harness/)
- [DeepSeek 官方发布公告](https://x.com/deepseek_ai/status/2087887408440164663)
- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a)
- [固定版本的架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md)
- [Cordis 时空可组合性预印本](https://github.com/cordiverse/paper)
- [DeepSeek V4 技术报告](https://arxiv.org/abs/2606.19348)
- [DeepSeek V3.2 技术报告](https://arxiv.org/abs/2512.02556)
- [官方数据处理说明](https://www.deepseek.com/harness/data-processing/)
- [官方安全说明](https://www.deepseek.com/harness/privacy/)
- [文件边界竞态报告](https://github.com/deepseek-ai/deepseek-harness/discussions/159)
- [子代理资源失控报告](https://github.com/deepseek-ai/deepseek-harness/discussions/131)
- [插件开发实录](https://github.com/deepseek-ai/deepseek-harness/discussions/380)
