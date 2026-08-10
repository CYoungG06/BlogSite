---
title: "GCodey:自己造一个克制的 Agent Harness"
date: "2026-08-11"
description: "我们开源的轻量本地 Agent Harness:交互会话与一次性任务共用同一个持久内核,事件溯源(events.jsonl 唯一状态源)、durable inbox、八个意图工具、真实 usage 驱动的上下文整理、direct/--safe 双执行边界。这篇讲清楚它的设计哲学——克制,以及为此删掉的一整页旧设计。"
tags:
  - Agent
  - Harness
  - LLM
  - 工程实践
  - 开源
---

之前我们在「蒸馏」栏目读过两篇 harness 工程的文章:[Lil' Log 的 Harness Engineering](/zh/distilled/harness-engineering-self-improvement/) 和 [Alex Zhang 的 compositional generalizers](/zh/distilled/lm-harness-compositional-generalizers/)。读别人的读多了,手痒,于是自己写了一个——[GCodey](https://github.com/CYoungG06/Gcodey),一个轻量的本地 Agent Harness,Go 实现,约 6 万行,Apache-2.0 开源,目前 alpha。

一句话定位:**交互会话与一次性任务共用同一个持久内核;Harness 负责能力边界、工具执行、事件持久化、上下文整理和恢复,不替 Agent 规定固定的规划、验证或交付流水线。**

这篇讲它的设计。最能说明问题的不是它有什么,而是它**没有**什么。

## 设计哲学:克制

GCodey 的 Runtime 只做六类事情:

- 维护持久会话和消息顺序
- 管理上下文窗口与压缩
- 提供当前获准使用的工具
- 执行用户已经选择的宿主或沙盒边界
- 保存恢复所需的外部事实
- 在无法证明安全时停止

规划、执行、检查、修复——这些是 **Agent 的工作过程**,不是 Harness 的流水线阶段。没有 Planner、没有 Reviewer、没有 Evidence Bundle、没有 `task.finish` 协议。Agent 在已批准的边界内保留充分自由:自己决定要不要规划、读哪些文件、跑不跑测试、什么时候问用户。

约束这条哲学的是一个判断标准——任何新概念(角色、阶段、协议字段、专用流程)想进内核,先回答五个问题:

1. 它是否直接保护一个明确的安全边界
2. 它是否保存恢复所需且无法重新观察的事实
3. 它是否服务多种任务和产出
4. 缺少它时,现有实体是否确实无法表达需求
5. 它能否留在工具、界面或扩展层,而不进入内核

前三条都给不出具体依据,默认不加。只服务某个 benchmark 或评分方式的机制,永远不能进产品内核。

首个公开版本前,我们删掉了一整页旧设计:general/code profile、Execution Contract、固定的规划-执行-验证-修复阶段、Evidence Bundle、`task.finish`、Semantic Reviewer 与 Verify Agent、`needs_human` 会话阶段、为旧 benchmark 保留的专用分支……**删减清单是最诚实的设计宣言**——它说明你真正相信什么。

## 内核:事件溯源

`events.jsonl` 是会话的唯一状态源(当前 event schema v7),没有 `snapshot.json`,没有 Runtime state cache,没有 Agent 工作流 checkpoint。提交一个事件的顺序是:

1. 纯 reducer 验证事件,计算下一状态与派生 intent
2. 完整事件 append 到 JSONL 并 `fsync`
3. **持久化成功后**才替换内存状态
4. 通知只读投影,再执行派生 intent

恢复就是从头流式重放:一份 1.59 MB、674 个事件的真实 Session,完整 replay 约 0.08 秒。TUI 只是持久事件的投影——流式文本增量作为进程内临时 overlay 提前显示,`model_output_committed` 才落盘;失败或中断不会把半截输出当成历史。

会话对外只有五种状态:

```text
idle -> running <-> waiting_user
          |
          +-> interrupted -> running
          |
          +-> failed
```

工具执行、上下文整理、workspace change 应用都是「运行中的操作」,不是新的会话阶段。`failed` 的含义也很克制:Runtime 无法证明安全继续,而不是模型产物一定错了。

![GCodey 内核架构:TUI 是事件投影;durable inbox 先落盘;Harness 内 reducer 验证事件、fsync 后才换内存;工具经能力策略路由到宿主或沙盒。](/images/blog/gcodey/harness-kernel.svg)

## durable inbox 与回合边界

用户消息先写内容库,再追加 `user_message_enqueued` 事件;构造下一次模型请求时,`user_messages_consumed` 才移动一个精确的 FIFO 前缀。模型或工具运行期间,新消息保持排队——它不会修改已经发出的模型请求,也不打断正在执行的副作用。

排队消息什么时候生效,取决于它到达时副作用进行到哪一步:

- 准备执行工具、但 `tool_started` **尚未持久化**:调度器放弃这批还没开始的调用,用更新后的消息重造下一轮请求;
- `tool_started` 之后:消息只能等这个调用完成。Runtime 不取消并重放结果不确定的工具。

这两条规则把「用户插话」的语义定义得非常干净:只有在还没有产生副作用承诺时,才允许改变航向。

## 八个意图工具

确认工作区后,direct 和 safe 模式向模型公开同一套八个工具:

- `read`、`list`、`glob`、`grep`
- `write`、`edit`
- `shell`、`process`

模型不选择宿主或沙盒 backend,不传文件 revision,也不手工发布工具输出——文件锁、边界检查、原子写入、哈希、变更预览、输出归档和沙盒证明,全是 Runtime 的内部责任。`edit` 用精确的 `old_text/new_text` 表达意图:拿文件锁、在当前内容里验证唯一匹配、生成有界 diff 预览、提交窗口再次检查、原子替换。大工具输出自动存成不可变 blob,模型上下文只收到有界预览和 `sha256:` 引用。

能力检查直接由当前持久 capability 对具体 effect 计算,拒绝只是一个普通工具结果——不产生逐工具审批事件,模型也不会从错误码反推出内部生命周期。

## 上下文整理:真实 usage 驱动

新会话默认 262,144 tokens 的主动整理线(不是远端模型的硬容量声明)。关键的选择是**用 API 返回的真实 `usage.input_tokens` 决定何时整理**,只有首轮或 usage 缺失时才退回字符估算——而不是像很多 harness 一样全程拍脑袋估。

自动整理和 `/compact` 手动整理走同一条路径:同一个 Main Agent 在无工具调用的请求里返回一份有界纯文本摘要,Runtime 校验边界后用 `context_epoch_started` 把摘要与覆盖序号、源 frame hash 绑定,开启新的 context epoch。没有独立的 Compactor Agent,不保存模型的隐式推理;用户目标、已批准能力、运行状态这些不可伪造的事实由 Runtime 单独投影,不要求模型填结构化记忆对象。

会话没有累计 token、模型回合、工具调用或运行时长的预算上限——单次操作仍有防失控边界,但不会随会话寿命逐步耗尽。

## direct 与 --safe:两种诚实的边界

默认 `direct + host`:文件修改立即作用于确认过的工作区,`shell` 经 `/bin/sh -lc` 在宿主运行。它的写入是**标准编辑器语义**——文件锁、提交前校验、同目录临时文件、原子重命名、`fsync`。文档里明说:这不是针对任意外部写入者的线性化 CAS,检查与重命名之间有极窄的竞争窗口;`shell` 也不是隔离边界,命令能以当前用户身份访问网络和其他路径。需要严格保护时,用 `--safe`。

`--safe` 创建私有工作副本(拒绝 symlink/hard link/跨设备/特殊文件,排除 `.git` 与 `.env*`),命令跑在原生沙盒里——macOS Seatbelt、Linux bubblewrap——网络关闭,敏感路径屏蔽。**沙盒创建或失效时明确停止,绝不静默回退到宿主执行**。副本的变更由用户审阅后通过 workspace change 写回:journal、内容寻址备份、协作锁、漂移校验,崩溃恢复只在事实可证明时补记,否则进 `failed`。

沙盒能力证明(attestation)只如实记录实际生效的边界:文件写边界、网络、输出上限是 hard;CPU/内存/磁盘 quota 目前就是 unsupported;macOS 的 descendant lifecycle 和 Host IPC 标为 soft。不夸大,不装作是容器。

## 性能工程:消灭持续热源

Harness 自身的开销被压到了很低的水平(Apple M2,Go 1.26.5,本地多次测量):

| 场景 | 优化前 | 当前 |
|---|---:|---:|
| 512 个 timeline item,tick + frame | 80–150 ms/op,81.9 MB/op | 0.54–0.59 ms/op,0.74 MB/op |
| direct host 跑 `/usr/bin/true` | 301–494 ms/op | 1.48–2.40 ms/op |
| 1.59 MB / 674 事件完整 replay | — | 约 0.08 s |

两个最疼的优化值得一提。direct host 的 `shell` 曾经每次调用都复制、同步并校验约 13 MiB 的 GCodey 自身再启动——改成普通进程组监督后直接快了两个数量级;TUI 空闲时不再有动画 ticker 每 25 ms 唤醒,终端输入改成 cancellation pipe 驱动的阻塞 poll。

更难得的是停止条件写得很清楚:空闲无周期工作、长历史流式显示维持低个位数单核占用、命令包装成本远低于工具进程本身——**继续优化需要引入新的复杂状态或削弱正确性时,就停**。

## 上手

```sh
# Go 1.25.12+
go install github.com/CYoungG06/Gcodey/cmd/gcodey@latest

export DEEPSEEK_API_KEY='your-key'   # 默认模型 deepseek-v4-flash
cd /path/to/project
gcodey                               # 交互会话
gcodey --safe                        # 私有副本 + 原生沙盒
gcodey --task '检查这个项目最明显的坏味道并跑相关测试'
gcodey resume                        # 恢复会话
gcodey sessions                      # 查看/删除历史会话
```

也可以从 [Releases](https://github.com/CYoungG06/Gcodey/releases) 下二进制(附 `SHA256SUMS`;alpha 的 macOS 包还没签名,Gatekeeper 提示属正常)。

## 现状与非目标

alpha 阶段,有些事明确还不做或没做:多工作区、运行中切换 direct/safe、活跃工具调用中的即时 steering、容器/远程沙盒、Windows、自动 Session GC。评测纪律也写了出来:benchmark 只测量行为,不能反过来决定产品的工具、状态机或输入输出;只服务评分方式的机制不进内核。

如果你也对「harness 应该有多厚」这个问题有体感——欢迎来 [GitHub](https://github.com/CYoungG06/Gcodey) 看看,issue 和 PR 都开着。
