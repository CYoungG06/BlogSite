---
title: "GCodey，一个克制的本地 Agent Harness"
date: "2026-08-11"
description: "我们开源的轻量本地 Agent Harness。交互会话与一次性任务共用同一个持久内核，事件溯源，八个意图工具，真实 usage 驱动的上下文整理，direct 与 --safe 两种执行边界。这篇把设计思路和代码里的取舍讲细。"
tags:
  - Agent
  - Harness
  - LLM
  - 工程实践
  - 开源
---

之前我们在「蒸馏」栏目读过两篇 harness 工程的文章，[Lil' Log 的 Harness Engineering](/zh/distilled/harness-engineering-self-improvement/) 和 [Alex Zhang 的 compositional generalizers](/zh/distilled/lm-harness-compositional-generalizers/)。读别人的读多了，手痒，就自己写了一个。[GCodey](https://github.com/CYoungG06/Gcodey)，轻量的本地 Agent Harness,Go 实现，约六万行，Apache-2.0 开源，目前 alpha。

这篇文章是设计拆解。为了写它，我又把代码通读了一遍，有几处发现和我原先的记忆对不上，后面会讲到。GCodey 最用力的地方，是它删掉了什么。

一句话定位，**交互会话与一次性任务共用同一个持久内核。Harness 负责能力边界、工具执行、事件持久化、上下文整理和恢复，规划、验证、交付的工作方式由 Agent 自己决定。**

## 克制是设计出来的

GCodey 的 Runtime 只做六类事情。

- 维护持久会话和消息顺序
- 管理上下文窗口与压缩
- 提供当前获准使用的工具
- 执行用户已经选择的宿主或沙盒边界
- 保存恢复所需的外部事实
- 在无法证明安全时停止

规划、执行、检查、修复，全部留给 Agent。没有 Planner，没有 Reviewer，没有固定流水线。Agent 在已批准的边界内自己决定要不要规划、读哪些文件、跑不跑测试。

约束这条哲学的是一个判断标准。任何新概念想进内核，先回答五个问题。

1. 它是否直接保护一个明确的安全边界
2. 它是否保存恢复所需且无法重新观察的事实
3. 它是否服务多种任务和产出
4. 缺少它时，现有实体是否确实无法表达需求
5. 它能否留在工具、界面或扩展层，而不进入内核

前三条都给不出具体依据，默认不加。只服务某个 benchmark 或评分方式的机制，永远不能进产品内核。

首个公开版本之前，这个项目其实长过另一副样子。它有 general/code 两套 profile，有 Execution Contract 和 Contract Draft，有固定的规划、执行、验证、修复四阶段，有 Evidence Bundle，有 `task.finish`，有 Semantic Reviewer 和 Verify Agent，有一个笼统的 `needs_human` 会话阶段，还有为旧 benchmark 保留的专用分支。公开前这些全部删掉了，连测试数据都没留。删起来比写起来疼，但删完以后，每个剩下的实体都能答出那五个问题。一份删减清单比任何新增功能都更能说明，这个项目到底相信什么。

## 事件溯源的内核

`events.jsonl` 是会话的唯一状态源，当前 schema v7，一共 26 种事件类型。没有 snapshot，没有 Runtime state cache，没有 Agent 工作流 checkpoint。提交一个事件的顺序是，reducer 先验证事件并计算下一状态，完整事件追加进 JSONL 并 `fsync`，持久化成功后才替换内存状态，最后通知只读投影、执行派生动作。

这里要先修正我们自己写糊的一处。设计文档把事件的完整性说成哈希链，这次读代码，发现实现是另一回事。每条事件的 checksum 是把整个信封(去掉 checksum 字段)做 SHA-256，属于单条记录的自校验。链式完整性由另外三件事合成，扫描时强制 sequence 从 1 连续递增，全程同一个 session id，全文件单一 schema 版本。真正的哈希链在另外两处，能力变更的 request、decision、activation 三个事件用 SHA-256 互相绑定，context epoch 的 binding 是单调哈希链。设计文档写错或者写糊的地方，代码里都记账。

reducer 和 harness 之间的合约小得出乎意料，只有五种 intent。`call_model`、`prepare_tool`、`execute_tool`、`reconcile_tool`、`commit_context_epoch`，定义文件一共 25 行。reducer 是纯函数，零 I/O，收到事件先 Clone 一份状态深拷贝再改副本，harness 拿到的 `Step` 里装着新状态和这五种指令。

崩溃恢复的规则也全部落在事件上。进程死在流式中途，恢复时先补一条带新 run id 的 `run_resumed`，再显式给悬空的 attempt 补一条 `model_attempt_failed`，标记可重试，然后走持久化的延迟重试。延迟本身也写成事实进事件，jitter 由 `sha256(attemptID)` 确定性推出，重放不重算。工具侧更谨慎，`tool_started` 悬空的调用走 reconcile 四态，succeeded 补回执，retryable 排重试，conflict 进 failed，说不清的标 uncertain 然后进 failed。绝不盲目重跑一条结果不确定的副作用。

文件尾部那条没写完的 JSONL 记录(Ctrl+C 或断电留下的 torn tail)有专门的修复命令。它先做整文件 SHA-256 加 stat 复核，和检查时的 token 一致才截断，截完 fsync 文件再 fsync 目录。不修就不让打开，宁可卡住也不猜。

恢复有多快。一份 1.59 MB、674 个事件的真实 Session，完整重放约 0.08 秒。

TUI 也只是持久事件的投影。流式文本增量作为进程内临时 overlay 提前显示，`model_output_committed` 落盘才算数，失败或中断不会把半截输出当成历史。

会话对外只有五种状态。

```text
idle -> running <-> waiting_user
          |
          +-> interrupted -> running
          |
          +-> failed
```

工具执行、上下文整理、workspace change 应用都是运行中的操作，不构成新的会话阶段。`failed` 的含义同样克制，Runtime 无法证明安全继续，跟模型产物写得对不对无关。

![GCodey 内核架构。TUI 是事件投影;durable inbox 先落盘;Harness 内 reducer 验证事件、fsync 后才换内存;工具经能力策略路由到宿主或沙盒。](/images/blog/gcodey/harness-kernel.svg)

## 消息排队与回合边界

用户消息先写内容库，再落 `user_message_enqueued` 事件。这个顺序有讲究，durable 消息不能指向一个还没写进 CAS 的对象。模型或工具运行期间，新消息照常入队持久化，它不修改已经发出的模型请求，也不打断正在执行的副作用。

投递是另一个事件。`user_messages_consumed` 只能在安静边界发生(没有进行中的模型调用、工具调用和整理)，而且携带的 id 列表必须是 pending 队列的精确前缀。harness 只在构造模型请求之前消费一次，一次吃掉全部 pending。

排队消息什么时候生效，看它到达时副作用进行到哪一步。代码里这道界线有个专门的名字，fence。

- 工具调用已提议、`tool_started` 还没落盘，新消息到达，reducer 直接返回 `ErrPendingUserMessageFence`。这批还没开始的调用以 `superseded_by_user_message` 拒绝，作为普通工具回执喂回给模型，然后带着新消息重造下一轮请求。reducer 的注释点破了为什么这安全，durable state 能证明这个操作还没跨过 ToolStarted。
- `tool_started` 之后到达的消息，只能等这个调用结算完。此时用户 Ctrl+C 再恢复，未开始的调用被批量以 `interrupted_before_start` 结算，已开始的走 reconcile。

一句话，新输入永远优先于尚未产生副作用承诺的工作。

## 八个意图工具，和一次写入的完整旅程

确认工作区后，direct 和 safe 模式向模型公开同一套八个工具。`read`、`list`、`glob`、`grep`、`write`、`edit`、`shell`、`process`。模型不选 backend，不传 revision，不手工发布输出。

所有工具走同一条四阶段协议，Prepare、授权检查、Bind、Execute，崩溃后还有 Reconcile。Prepare 是纯词法校验，不碰文件系统。路径存在性、类型、symlink 状态都属于授权后才能观察的信息，授权前去探测它们等于开一条侧信道。这种地方最能看出一个 harness 的边界感。

能力检查也是同一种纪律。它由当前持久 capability 直接对具体 effect 计算，拒绝只是一个普通工具结果，不产生逐工具审批事件，模型也没法从错误码反推出内部生命周期。

`edit` 一次调用最多 128 个编辑，每个 `old_text` 在当前内容里必须唯一匹配，所有编辑解析自同一份快照，排序后查重叠。文件锁按单个相对路径加，channel 当令牌，引用计数归零就删表项，模型疯狂写路径也撑不爆锁表。

预览是真实的 unified diff，自实现的 Myers，编辑距离封顶 512，超出退化成公共前后缀加中段整体替换，封住最坏内存。变更合计超过 8 MiB、十万行，或者 diff 产物超过 4 MiB，预览退化成哈希摘要，前后各一行 SHA-256、字节数、行数。预览大小永远不会反过来阻止合法修改。

写入的原子替换值得完整走一遍，因为它是这个 codebase 的缩影。

1. 打开父目录用 descriptor 钉住，校验 device 与根一致。
2. 已存在的文件优先 clonefile 克隆原 inode,xattr 和属主随克隆到位;复制 xattr 时跳过 `com.apple.provenance`，内核会给新 inode 重写它，所以摘要里只记它存在，不记值。
3. 字节全部写完，先 fsync 临时文件，再验一次候选的身份、权限、属主和元数据摘要。写字节可能清掉 Linux file capabilities，所以要复验。
4. rename 之前最后再读一次目标，内容哈希仍等于 before 才放行。
5. rename 用 `RENAME_EXCL`，完事 fsync 父目录。
6. 提交后再快照一次，要求内容等于 after、inode 等于临时文件的 inode、mode 和 xattr 摘要全部匹配。

临时文件名里刻意不含完整 basename，只放它哈希的前 8 位加随机数，免得 255 字节的文件名撑爆 `NAME_MAX`。

崩溃恢复不需要 WAL，内容哈希就是恢复事实。目标等于 after，视为已成功;等于 before，可以安全重试;都不是，报冲突。临时文件被未知内容占用时，宁可不动它。

大工具输出走内容寻址。模型上下文里只放 16 KiB 的有界预览和 `sha256:` 引用，完整内容先归档再截断，这个顺序不能反，反了上下文里就会留着一份无法寻回的文本。模型想回看，`read` 直接接受 `sha256:` 路径，按行分页。

## 上下文整理，由真实 usage 驱动

新会话默认 262,144 tokens 的主动整理线，它是我们给自己定的纪律，不是远端模型的容量声明。触发判定看 API 返回的真实 `usage.input_tokens`，首轮或者 usage 缺失才退回估算。估算器有两个，DeepSeek 官方 endpoint 用逐 rune 计费(ASCII 0.3、汉字 0.6、其余符号 1.0，再乘 1.25 安全系数加 1024 framing)，未知 endpoint 直接按 UTF-8 字节数当上界。宁可多算，不可漏算。

整理和 `/compact` 走同一条路。同一个 Main Agent，不带工具，看完整消息历史，返回一份有界纯文本摘要。校验很硬，合法 UTF-8、无 NUL、无首尾空白、不超过 32 KB,finish 必须是 stop 且无工具调用，不合格记 `invalid_context_summary`，不可重试，直接暂停等人来看。

摘要落进新 epoch 的方式也有讲究。它不裸插进 transcript，而是包进一条 user 消息，和 Runtime 投影的事实同帧但分区。同一帧里还有 `user_message_archive`，全部用户消息的目录进 CAS，内联首条和最近四条。prefix 明确告诉模型，archive 是权威的，摘要漏了某条用户消息不等于那条消息消失，拿 `catalog_reference` 可以读回原文。摘要之外，最近命令回执和最近失败各留八条。

epoch 之间是单向哈希链，`PreviousEpochSHA256`、`SourceFrameSHA256`、`SummarySHA256` 逐环咬死。整理期间到达的用户消息不进摘要，覆盖边界切在第一条未投递消息之前，新 epoch 建立后它们作为原样消息进入下一轮。

会话没有累计 token、回合数、工具调用次数和时长预算。单次操作仍有防失控边界，这些边界不会随会话寿命逐步耗尽。

## direct 与 --safe，两种边界都写清楚

默认 `direct + host`。文件修改立即作用于确认过的工作区，shell 在宿主跑。文档明说这是标准编辑器语义，检查与重命名之间有极窄的竞争窗口，shell 能以当前用户身份访问网络和其他路径。它不是沙盒，不适合跑不可信代码。

路径边界在代码里长这样。Linux 用 `openat2` 加 `RESOLVE_BENEATH`，一路禁 symlink;macOS 没有 openat2，逐组件 openat 加 `O_NOFOLLOW`，每打开一层重验一次 device。受保护清单里躺着 `.git`、`.codex`、`.claude`、`.gcodey` 和一切 `.env` 开头的路径，只有 `.env.example` 这类模板作为叶子文件放行，同名目录照拒。

`--safe` 是另一套。先创建私有工作副本，排除 `.git` 和 `.env*`，拒绝 symlink、硬链接、特殊文件，上限十万个文件、单文件 32 MiB、总量 1 GiB。复制前后各对源做一次快照，两次不一致就判源已变、放弃。然后命令跑在原生沙盒里，macOS Seatbelt,Linux bubblewrap，网络关闭。

Seatbelt profile 在 `(deny default)` 之上只放出去很少的东西，六个 sysctl(Go 和 Node 启动所需，注释里明令禁止改成全量)，八个 mach 服务，几个设备文件的 ioctl。`file-link` 和 `file-clone` 显式拒绝，防止把受保护的 inode 硬链接进可写区。敏感路径不光 deny 读，还对它和它的每一级祖先 deny 写和 unlink，谁也别想把 deny 挪开。`.env` 用 regex 兜底，连创建时还不存在的文件都提前挡掉。

建沙盒之前先 probe，而且 probe 是真跑用例。可写区写要成功，越界写必须失败，deny 路径读必须失败，硬链接逃逸必须失败，TCP 连接必须失败。任何一项不过，拒建，本次执行停止，不回退到宿主。

能力证明(attestation)只记录实际生效的边界。十一个维度逐维标 hard、soft、unsupported，残余风险用人话写在里面，比如 macOS 的 Host IPC 标 soft,CPU 和内存 quota 标 unsupported。deny 路径清单只记 SHA-256，不记原始路径。不夸大，也不装作是容器。

副本的变更由用户审阅后写回，这套写回流程是全代码里最重的一段。应用前依次复核源目录身份、源快照等于 baseline、逐字节重算 diff 和已批准补丁比对、把全部新内容读进内存复验哈希;然后拿协作锁(建在源工作区，防另一个 GCodey 进程对同一源并发 apply)，持锁状态下再证一次源等于 baseline、再验一次元数据，然后才动手。journal 两阶段落盘，失败按逆序回滚，崩溃恢复只在事实可证明时补记，否则进 `failed`。另有一道小闸，后台进程没清零不许 apply。

shell 的进程组监督同样不含糊。一律 Setpgid，终止按 SIGINT、SIGTERM、SIGKILL 逐级升，每级留 grace。leader 退出不等于后代退出，继续探原进程组，发现残留就杀组并报 `lingering_descendants`。后台句柄上限 128 个，不随会话恢复存活。stdin 写超时先杀子进程再报错，排队的输入永远不会在一张可重试的回执之后偷偷执行。

## 性能工程，消灭持续热源

Harness 自己的开销被压得很低(Apple M2,Go 1.26.5，本地多次测量)。

| 场景 | 优化前 | 当前 |
|---|---|---|
| 512 个 timeline item,tick + frame | 80 到 150 ms/op,81.9 MB/op | 0.54 到 0.59 ms/op,0.74 MB/op |
| direct host 跑 `/usr/bin/true` | 301 到 494 ms/op | 1.48 到 2.40 ms/op |
| 1.59 MB / 674 事件完整 replay | 无 | 约 0.08 s |

两个最疼的优化。direct host 的 shell 曾经每次调用都复制、同步并校验约 13 MiB 的 GCodey 自身再启动，改成普通进程组监督后直接快了两个数量级。TUI 空闲时不再有动画 ticker 每 25 ms 唤醒，终端输入改成 cancellation pipe 驱动的真阻塞 poll。长历史的渲染靠三级缓存，整张 transcript 按宽度缓存，每条消息再按内容指纹缓存 layout，流式更新只重排变化的尾部。

停止条件也写了出来。空闲无周期工作，长历史流式显示维持低个位数单核占用，命令包装成本远低于工具进程本身。继续优化需要引入新的复杂状态或削弱正确性时，就停。

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

也可以从 [Releases](https://github.com/CYoungG06/Gcodey/releases) 下二进制，附 `SHA256SUMS`。alpha 的 macOS 包还没签名，Gatekeeper 提示属正常。

## 现状与非目标

alpha 阶段，有些事明确还没做。多工作区、运行中切换 direct/safe、活跃工具调用中的即时 steering、容器或远程沙盒、Windows、自动 Session GC。评测纪律也写了出来，benchmark 只测量行为，不能反过来决定产品的工具、状态机或输入输出。

写它的过程反过来也校准了我们读那两篇 harness 文章的方式。Lil' Log 说 harness 是模型能力的外衣，我们的体会更具体一点。外衣的每一根线都得回答那五个问题，答不上来的，趁早别织进去。

如果你也对「harness 应该有多厚」这个问题有体感，代码在 [GitHub](https://github.com/CYoungG06/Gcodey)，设计和威胁模型的细节在仓库的 `docs/` 里，issue 和 PR 都开着。
