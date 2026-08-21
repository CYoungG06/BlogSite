# DeepSeek Harness 深入拆解，Agent 运行时怎样管理三种状态

> 2026-08-14

假设一个 Coding Agent 正在改仓库。它先读出一份三万行的搜索结果，随后为了腾出上下文，把旧工具输出裁成五千多字；中途用户切换了工具配置；接着一个写文件工具已经执行完，进程却在结果落盘前崩溃。重启以后，系统要回答三个彼此冲突的问题。

1. 旧插件留下的监听器和服务引用有没有清干净？
2. 模型下一轮究竟该看到长结果、短结果，还是压缩摘要？原始执行记录还能不能审计？
3. 那次写文件到底发生了没有？系统能不能安全重试？

这三个问题分别对应运行时内部状态、模型可见状态和外部世界状态。把它们混在一起，Agent Loop 很快就会变成一团充满例外分支的代码；把它们分开，也不能只靠抽象接口，必须给每一类状态设计不同的协议。

文件、Shell、Skill、子代理、MCP 和网页搜索很容易占满发布介绍，却不足以解释这套系统。DeepSeek Harness 更值得看的地方，是它怎样处理三种状态边界。

- 运行时内部的资源，用 Cordis 的 effect 与依赖重解析来管理，目标是尽量可撤销；
- 模型看过的内容，用 append-only 事件日志和可替换的 surface 来管理，目标是能够解释和重建；
- 已经作用于文件、进程或网络的结果无法真正撤销，只能在执行前做权限控制、在执行前落耐久检查点、在结果不确定时明确记成 `TOOL_OUTCOME_UNKNOWN`。

Code Mode 则叠在这三层之上。它改变模型组织工具调用的粒度，却没有另造一条绕过权限与审计的捷径。

![DeepSeek Harness 把运行时内部状态、模型可见状态和外部副作用交给三套不同协议处理](https://cyoungg06.github.io/BlogSite/images/blog/deepseek-harness/state-boundaries.svg)

本文以官方仓库提交 [`47f943859bef60e4160492346772ded9b24f765a`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a) 为代码快照，产品、论文和社区讨论状态截至 2026 年 8 月 14 日。项目刚发布一天，结论必须分清哪些来自代码，哪些来自论文的条件性论证，哪些只是社区报告。

## 先把它放回正确的位置

运行 `npx @deepseek-ai/dsh web`，本地界面会打开在 `127.0.0.1:3080`。用户选择工作区、模型和 Agent preset，之后可以在聊天界面旁查看 Trajectory。默认模型路由是 `deepseek-official/deepseek-v4-flash`。项目要求 Node.js `^22.19.0` 或 `>=24.0.0`。

这很容易让人把它当成又一个 Claude Code 或 Codex 客户端。功能表看上去也差不多。结合 README 与贡献指南，本文更愿意把它视为一份可运行的 Agent runtime 参考实现。README 明确标注 Developer Preview，警告会发生破坏性变化；贡献指南说项目仍处早期，暂时不接收外部 PR，并把仓库描述为一种理念、一个官方示例和灵感来源。它现在提供 headless runner，却还没有官方交互式 CLI/TUI、桌面端和 IDE 插件。

版本状态也与这个定位一致。本文固定快照里的包版本是 `0.1.0-rc.5`，核查时 npm 的 `latest` 已经前进到 `0.1.0-rc.6`，仓库却还没有 tag 或 GitHub Release。默认 JSONL Session 格式仍标作 v0，也没有稳定迁移承诺。今天使用这套运行时，必须把兼容性变化算进成本。

这会影响我们评价它的尺度。官方交互式客户端与兼容性承诺尚缺，Windows 和资源占用也已经出现需要继续验证的社区报告。作为运行时样本，它已经把插件组合、请求重建、工具管线和崩溃恢复写到了足够细的程度。

### 四种 preset 规定四种执行合同

Web 新建会话时可以选 Standard、Code、Minimal 和 Creator。表面上，它们的差异是工具多少；更准确地说，它们规定了模型的行动空间，也顺带规定了一部分信任边界。

| preset | 模型直接看到什么 | 更适合做什么 | 需要特别留意什么 |
|---|---|---|---|
| Standard | 文件、Shell、Skill、计划、子代理、工作流、网页搜索等原生工具 | 日常交互与开发 | 上下文会自动压缩，工具逐项进入模型 schema |
| Code | 一个 `run_code`，内部提供由当前工具表生成的 TypeScript SDK | 一次编排多次读取、搜索和条件分支 | 生成代码本身是额外能力要求；worker 不是安全边界 |
| Minimal | 持久 Bash 与 `str_replace_editor` | 更接近内部代码评测工具面的实验 | 不启用 compaction；编辑器使用裸 `fs-local`，不受通常的 workspace containment 约束 |
| Creator | Standard 加运行时检查与动态挂载工具 | 试验插件和 Harness 自修改 | 内部 id 是 `cordis`；模型写的 JavaScript 应按 Shell 同级权限看待 |

宿主和 preset 分别拥有不同的东西，这个结构也决定了四种模式的真实边界。

宿主侧的 base/web/profile 配置负责模型路由、Session 持久化、sandbox、审批、工具注册表和子代理后端。每个 Agent 再创建自己的 scope，并绑定到某个 preset 的 standing scope。preset 提供 persona、system prompt、工具呈现方式和 compaction 策略。服务查找沿作用域链合并，近层可以覆盖远层；Minimal 正是用 scoped `fs-local` 遮住了宿主通常提供的 `fs-sandbox`。

同一份 composition 的文件戳不变时，新 Agent 共享一代 standing mount，不会每开一个会话就重新挂一整棵插件树。文件的 `mtime+size` 改变后，下一次 `ensureStanding()` 才创建新 generation；已经加入的 Agent 继续停在旧 generation。产品路径只允许空白会话显式切换 preset 时执行 recompose 并移动 binding。子 Agent 不重新读取 preset，而是加入父 Agent 所在的同一 generation。

当前旧 generation 也不会按引用计数自动回收，只在整棵插件树 teardown 时释放。这一选择保证正在工作的父子 Agent 不会被配置文件变化拆散，代价是频繁编辑 preset 可能让多代 standing tree 共存到宿主退出。

因此，preset 更像一份执行合同。它决定模型可以提出哪些动作、这些动作以什么形式暴露、上下文怎样变短，以及哪些局部服务覆盖宿主默认值。只看 UI 上的四个名字，会漏掉这层意义。

## Cordis 管理资源的完整生命周期

普通依赖注入通常解决启动时的问题。创建 provider，把它交给 consumer，应用开始运行。但 Agent runtime 的依赖会在运行中变化。用户可能切换模型 provider，工具插件可能热更新，某个 MCP 连接会断开，Creator 甚至允许 Agent 临时挂载一段新插件。

把新 provider 放进注册表只做完了一半。撤走旧 provider 时，运行时还要处理所有依赖者与残留资源。

假如文件监听插件注册了 watcher 和事件回调，却只删除了服务名，旧 watcher 仍会继续工作；下次再装载一次，就可能收到两份事件。consumer 手里若还留着旧服务对象，即使新 provider 已经出现，也可能继续操作过期资源。插件“可以加载”远远不够，它还得能完整退出，并让所有依赖者一起退出到一个可恢复的状态。

Cordis 把这件事拆成两部分。第一部分是 effect，每次对外注册资源时，同时交出反向清理动作。第二部分是反应式依赖，consumer 的必需 provider 消失时，consumer 不得继续假装自己可用；依赖恢复以后，它再重新装载。

```ts
ctx.effect(() => {
  const watcher = watch(path, onChange)
  return () => watcher.close()
})
```

这个例子里的正向动作是创建 watcher，反向动作是关闭 watcher。`ctx.on()`、服务注册和子插件装载已经被框架纳入 effect；插件直接管理连接、定时器或外部句柄时，作者仍要自己给出 disposer。

### 一次 provider 替换实际会发生什么

源码状态机把 consumer 的完整过程写得很具体。

```text
PENDING
  └─ 必需 provider 到位 → LOADING → ACTIVE

ACTIVE
  └─ provider 消失或 provider UID 改变
       → UNLOADING
       → 清理自己拥有的 effects
       → PENDING

PENDING
  └─ 新 provider 到位 → LOADING → ACTIVE
```

`INACTIVE` 在实现里只是内部 epoch 哨兵，没有对应的公开 `FiberState`。这一点虽小，却说明 Cordis 远比给 JavaScript 插件加几个 lifecycle hook 更完整；provider replacement、consumer refresh、effect 所有权和重载顺序共同组成了一套运行时协议。

清理顺序也值得说清楚。同一个 effect 内通过 generator 逐步取得的 disposer，会按逆序串行执行，类似把一段注册过程倒放；一个 fiber 卸载时，它拥有的多个顶层 effect 则由 `Promise.all` 并发排空。也就是说，框架保留单个资源链条的 LIFO 语义，但不会无条件把彼此独立的所有清理都串起来。

Cordis 预印本把“操作可以带着逆操作撤回”称为时间可组合性，把“组件随着依赖出现和消失而重新求值”称为空间可组合性。这套概念为理解公开 Harness 的插件生命周期提供了一种语言。公开代码确实把模型接入、工具注册、压缩、持久化、UI 和沙箱纳入同一类生命周期管理；但论文没有声称这些具体设计由它直接推导。

这里引用的材料是一份仍在主动修订的预印本，署名 Yifan Shi、Wei Zhang 和 Tianyi Cui，草稿日期为 2026 年 8 月 13 日。论文仓库当时的 tag 是 v8，正文呈现 Cordis v4。它没有 arXiv 编号、DOI 或正式发表信息，下面谈到的定理都应按预印本结论理解。

### 可逆生命周期的证明，到哪里就停了

论文的形式化结果有一组相当具体的前提。

- 组件作者给出的恢复函数确实是正确的逆操作，运行时不替作者验证；
- 交错恢复要求 effect 两两独立，双方的状态变换可以交换，另一方也不能改变当前 iterator 将产生的 inverse 与 continuation；
- registry 必须 well-formed，不同 fiber 声明的 provision 集合不得重叠，因此一个 key 至多有一个可能的 provider；
- precedence relation 必须无环，其中 `n ≺ m` 表示 n 声明的 provision 与 m 的依赖相交；一条执行中出现的 fiber name 集合必须有限，每个 effect iterator 的长度有统一上界；
- confluence 还要求最后达到 quiescent state、没有 failed fiber、组件对 provision 是 total，并比较同一组 orchestration steps；
- 状态变换发生在 Cordis 能够观察和管理的系统边界内。

运行时无法自动证明 `watcher.close()` 真的关掉了所有资源，也无法把已经发出的 HTTP 请求从对方服务器收回来。插件若绕过 Context 直接修改全局变量，或者启动一个不会随 worker 退出的系统子进程，那些状态也不会因为 Cordis 调过 disposer 就神奇复原。

由此可以得到一个收窄后的判断。**可逆生命周期给安全自修改提供了前置条件，它本身没有解决安全自修改。** Creator preset 证明系统愿意把运行时自身变成 Agent 的操作对象；Cordis 给这些试验提供了卸载和依赖恢复的基本秩序。但代码权限、外部副作用、插件身份和结果验证仍要由另一套安全机制承担。

论文以 Koishi 作为生产案例。这个运行四年多、积累四千余插件的生态，说明 Cordis 的核心模型已在一个大型真实系统中长期使用；但它仍是单一生态的观察性证据。Koishi 当前使用 Cordis v3，论文呈现 Cordis v4。论文把 self-evolving harnesses 明确列为未来验证，也没有给出受控的开发效率或运行开销对照。

插件化移动了复杂度。Agent Loop 变得更薄，代价转移到服务 ABI、effect 纪律、卸载测试和版本兼容矩阵。对想搭建生态的人，这种转移通常值得；对只想维护十来个固定工具的应用，是否值得就未必了。

## Session 同时保留事实与模型视图

第二类状态更棘手。模型上下文需要不断删减，审计记录却最好永不改写。如果系统只保存当前 messages 数组，压缩以后就丢了原文；如果每次都把原始轨迹全部送给模型，上下文窗口很快会被工具输出塞满。

DeepSeek Harness 把会话分成三层。

1. **raw log** 是仅追加、带类型和递增 `seq` 的 SessionEvent；
2. **surface** 是由日志事件上的 `surfaceOp` 推导出的当前模型消息投影；
3. **request state** 由完整的 `request/header` 快照与独立的 `request/context` 事件组成。header 记录 call config，包括 provider、model、reasoning effort 与采样参数，同时保存 adapter defaults、system 和 tools；context 只在路由或容量变化时记录 provider、model 与 context window，不参与请求重建或 header equality。

raw log 回答“Session 曾经记录过什么”，surface 回答“模型下一步应该记得什么”，最新 `request/header` 回答“下一次请求由什么配置构造”；`request/context` 只是路由与容量观测元数据。它们相关，却不能互相代替。raw log 本身也不能证明外部副作用实际发生。

![原始 Session 日志通过 append 与 replace 形成模型可见 surface，request header 固定请求配置，request context 另记路由与容量](https://cyoungg06.github.io/BlogSite/images/blog/deepseek-harness/session-projection.svg)

### 一条旧工具结果怎样被替换，而不从历史中消失

假设 `seq=40` 是一条完整的 `tool/result`。它通过 `surfaceOp: append` 进入 surface。几十步以后，裁剪器发现这条结果太长，于是追加一条新的 `tool/result`，例如 `seq=87`。新事件的内容变短，`surfaceOp` 是 replace，provenance 指回 40。

```text
raw log
  seq 40  tool/result  完整内容  surfaceOp: append
  ...
  seq 87  tool/result  裁剪内容  surfaceOp: replace
                              sourceEventSeqs: [40]

deriveMessages() 看到 seq 87
审计 raw log 仍能看到 seq 40 与 seq 87
```

这里的 replace 范围指当前 surface 的位置，不是 raw log 的 seq 数值区间。运行时还要求 provenance 完整覆盖被遮蔽节点，不能拿一条来路不明的新消息静默改掉旧历史。对于工具结果，replacement 只能替换一个现存工具结果，并且只允许改变内容，调用身份等结构不能趁机换掉。

默认的无模型裁剪阈值是 8,192 个 Unicode code point，保留开头 4,096、结尾 1,024，再插入固定标记。请求压力达到模型上下文窗口的 0.8 时，basic compaction 会先尝试这种工具结果裁剪；仍然超限才总结旧区间，并保留约 0.16 的近期上下文。summarizer 默认最多用 8,192 tokens。

这些数字本身不神秘，结构才重要。压缩会向日志加入一份“从现在起给模型看这个版本”的声明，同时保留旧消息。模型视图可以持续变短，事后审计也能知道它是从哪段原始内容变来的。

### 请求可重建，不能写成一句过度漂亮的口号

`Agent.buildRequest()` 会在初始、恢复或任一 header 字段变化时记录 canonical `request/header`。下一次模型请求的 messages 取自 durable boundary 上的 `deriveMessages()`。`request/context` 另记路由和容量变化，不参与历史重建。

仓库还提供了一份可执行 invariant companion。它检查精确 request 对象及其 messages 数组是否冻结、session id 是否指向 live Session、step/header 是否存在，并把 request messages 与 `deriveMessages()` 做 JSON 级比较。测试 harness 会自动挂载它。

但基础 Web composition 没有强制加载这份 companion，而且 invariant 也没有比较 header 的每个字段。provider、reasoning effort、adapter defaults 和独立的 `request/context` 不在那组 equality 中。Harness 把“模型可见内容必须能由事件推导”做成了核心数据结构，并提供可执行测试守卫；现有证据不足以说明所有生产请求都由一个全字段 invariant 实时拒绝任何偏差。

这种克制很重要。可观测设计的价值来自明确记录了什么、怎样重建、哪里还只靠调用路径维持，而不是来自一句听起来无懈可击的宣传语。

### 崩溃以后，诚实地承认“不知道”

默认持久化格式是 JSONL。checkpoint policy 在每次 `agent/pre-step` flush 已提交的上一批响应或结果，在 `llm/stream` 真正交给 adapter 前 flush 完整请求前缀，并在每个顶层 `tools/execute` 进入工具 body 前 flush 已记录的 `tool/call`。嵌套 Code 副调用复用外层调用的耐久边界，不逐个 flush；这套规则也不会只照顾被标记为“有副作用”的工具。

于是，一次工具调用至少可能落在三种状态。

```text
assistant 已提出调用，但 tool/call 尚未持久化
  → TOOL_NOT_STARTED

tool/call 已持久化，tool/result 也已持久化
  → 已知结果

tool/call 已持久化，工具 body 可能已执行，tool/result 尚未持久化
  → TOOL_OUTCOME_UNKNOWN
```

最后一种最容易被粗糙的 Agent 框架处理错。系统若直接重试“创建工单”“转账”或“发送消息”，可能把外部副作用执行两次；若直接当作成功，也可能掩盖失败。DeepSeek Harness 的 repair 逻辑会补一条 `ToolOutcomeUnknownError`。它给模型的消息提示，只读或幂等操作才可直接重试；可能有副作用时，应先核验外部状态或询问用户。源码没有另一个状态机强制执行这条重试纪律。

这仍然达不到 exactly-once。检查点只能证明“调用意图在执行前已经耐久化”，无法让文件系统、远程 API 和 Session 日志组成分布式事务。系统得到了一条可靠的证据边界，可以分清哪些动作确定没开始，哪些动作结果确定，哪些动作必须承认未知。

这一点和 Cordis 的边界恰好呼应。内部注册的监听器可以用 disposer 尝试撤销；已经离开进程的副作用通常撤不回来，只能记账、核验与补偿。

## Code Mode 只改变调用粒度

原生 tool calling 有一条很长的往返路径。模型请求搜索，Harness 执行并把结果送回；模型看完再请求读文件；Harness 再执行，再发起下一轮模型请求。每个决策点都经过模型，容易理解，却会产生大量往返与上下文传输。

Code Mode 把当前原生工具表生成为 TypeScript SDK，模型直接看到的外层工具只剩 `run_code`。模型可以写一段程序，把确定性的搜索、过滤、并发读取和条件分支留在 worker 里。

```ts
const { matches } = await tools.grep({ pattern: "TODO", path: "src" })

const files = await Promise.all(
  matches.slice(0, 5).map(({ path }) => tools.read({ file_path: path })),
)

return files.map(({ content }) => content.slice(0, 800))
```

`run_code` 不会合并内部调用的权限与审批。每个真正开始的副调用会先追加 `tool/code-dispatch-start`，正常 settle 后再追加 `tool/code-dispatch`；进程崩溃时可能只留下 start。外层结束或中止时仍在队列中、尚未开始的副调用会被放弃，也不会记日志。

![Code Mode 中模型生成的程序通过 SDK 调用原生工具，每个实际启动的副调用仍经过校验、策略、审批和提交，只有外层结果进入下一轮模型上下文](https://cyoungg06.github.io/BlogSite/images/blog/deepseek-harness/code-mode-pipeline.svg)

### 每个 SDK 副调用仍走原生管线

模型提交的代码进入一个全新的 Node Worker。`tools.grep()` 或 `tools.read()` 的参数通过 lossless JSON bridge 回到宿主，随后仍走对应原生工具的注册、参数校验、pre-execute、权限 guard、人工审批、body 执行、post-execute 与 finalize。需要审批的工具不会因为藏在 `run_code` 里就绕开审批。

工具只有精确声明 `isConcurrencySafe: true`，body 才允许重叠执行；缺失、非法或解析失败一律按 exclusive 处理。默认最多并行十个副调用。exclusive 调用会等正在执行的并发工具排空，并一直持有屏障直到 post-execute commit 完成。程序本身还必须真的并发发出 Promise，连续写五个 `await` 仍然只会串行。

单 driver lane 保证 dispatch-start、pre-execute、post-execute 和 settle/commit 等有序阶段按 submission order 运行；只有 around-dispatch 与 tool body 可以重叠。并发 body 的实际完成顺序和外部副作用仍可能交错，因此系统没有确定性的副作用总序，也没有事务回滚语义。前面已经完成的文件写入不会因为后一个工具报错而撤回。外层 `run_code` 开始前有一次顶层 checkpoint，内部副调用没有逐个单独 flush，崩溃恢复的耐久粒度停在外层。

### 同一个副调用其实有三种结果

Code Mode 为同一次副调用保留三条数据通道。

| 通道 | 保存什么 | 谁能看到 | 能否从 Session replay 恢复 |
|---|---|---|---|
| 程序内值 | 原生工具的 canonical structured value，例如 `{ matches }` | 当前 worker 内的后续代码 | 不能；它不写 durable event |
| durable dispatch | normalized args、调用身份、rendered content、错误状态 | Trajectory、UI、调试与审计 | 可以恢复记录，但没有 canonical value |
| 模型 surface | 外层 `run_code` 的 logs 与最终 return | 下一轮模型 | 可以；作为外层 `tool/result` 进入 surface |

程序可以拿着结构化大对象继续筛选，不必把每个中间值塞给模型；Session 能看见每次实际开始的副调用及其已提交的 settle 记录；模型最终只收到外层程序主动返回的内容和日志。内部 `tool/code-dispatch-start`、`tool/code-dispatch` 会持久化，却被 `deriveMessages()` 忽略。三种表示各有用途，不能互相冒充。

代价也在这里。Session replay 能重建“哪个工具以什么参数执行、渲染出什么记录”，不能重建 worker 当时拿到的 canonical JavaScript 值，也无法逐指令恢复程序中间状态。若需要 bit-for-bit 重演 Code Mode，现有日志还不够；它追求的是可审计调用链，不是确定性进程快照。

### worker 的上限到底限制了什么

每次 `run_code` 都新建 Worker Thread，不复用池；环境变量为空，`execArgv` 为空。默认 active compute 限制为 60 秒，连续墙钟为 600 秒，old generation 为 512 MB，外层输出上限为 67,108,864 bytes，也就是 64 MiB。一次结束后 worker 会 terminate。

60 秒 compute 主要计 worker event loop 忙碌时间，等待慢工具时墙钟仍走但不占同样的计算预算。64 MiB 约束的是序列化后的外层 logs、completion 和 failure payload，不是每个内部 binding 的单值大小。内部对象最终仍受 worker/process 内存约束。

这些限制提供的是故障 containment，不是恶意代码隔离。Worker Thread 与宿主共享一个 OS 进程的安全命运，已经创建的系统子进程也未必随 worker terminate 消失。官方因此把 Creator/Code 这类可执行模型代码的能力按 Bash 等级看待。面对不可信仓库，真正的安全边界仍应放在 Harness 进程外的 VM 或容器。

## 它为什么和 DeepSeek 模型的训练协议有关

Harness 不只是“给任意模型套几个工具”。模型在后训练里见过怎样的角色序列、thinking 能否在工具回合间带回、工具 schema 用什么格式，都会影响实际表现。

DeepSeek V3.2 报告给出了一个很明确的协议信号。当对话只是追加 tool message 时，模型可以保留上一段 reasoning；出现新的 user message 时，这段 reasoning 会被丢弃。报告提醒，把工具返回伪装成 user message 的 Roo Code、Terminus 一类框架吃不到这项 retention，并建议此类架构使用 non-thinking。报告自己的 tool-use benchmark 采用 standard function-call format，MCP 评测还明确把工具输出放在 `tool` role；论文没有把“改用标准 tool calling”写成对这些框架的直接建议。

公开 Harness 的 DeepSeek adapter 与这套协议能够对上。它使用标准 tool role；只有带 tool call 的 assistant turn 会把 `reasoning_content` 送回后续请求，普通回合不会把这部分思考历史继续回传。这说明公开实现与报告描述的 retention 条件在序列化语义上相容；它仍不能证明 adapter 直接派生自论文，也不能量化这一处理带来的 benchmark 增益。

V3.2 的训练数据也说明工具能力并非发布时临时拼上去。报告列出 24,667 个代码任务、50,275 个搜索任务、4,417 个通用任务与 5,908 个 code-interpreter 任务。代码、搜索与 code-interpreter 任务使用真实环境，并分别接入 coding tools、web search APIs 与 Jupyter；通用任务的环境和 prompt 都由合成流程构造。数量不能直接推出泛化能力，却足以说明 tool use 是后训练的一部分。

V4 又把这条路线往前推了一步。报告描述了按领域做 SFT 与 GRPO 的 specialists，再通过 multi-teacher on-policy distillation 把十多个教师汇入一个学生模型。工具场景中的 interleaved thinking 还进一步保留跨 user 边界的推理历史。若运行时要复现报告描述的上下文语义，就必须稳定地区分 tool-calling path，并保存和传回相应的 reasoning 历史；报告没有量化公开 Harness 因此获得的增益。

### 论文内部 Harness 与开源项目必须分开

V4 代码评测使用内部 Harness，提供 Bash 加文件编辑工具，最多 500 步，512K context；搜索评测则给 web search 与 Python。V4 报告没有出现这次开源仓库的名称、提交或完整配置。

公开项目里的 Minimal preset 与内部代码评测工具面确实相似，前者是持久 Bash 加编辑器，后者是 Bash 加 file-edit。但“相似”不能越过证据边界变成“同一套实现”，更不能把论文里的 SWE 或 Terminal Bench 成绩直接记到公开 Harness 名下。那些数字属于模型、内部工具面、未公开提示与评测预算的组合。

内部代码任务和搜索任务采用了不同工具面，这说明公开材料至少没有支持一个对所有 Agent 任务都最优的 universal surface。公开项目另行提供了四种 preset。Standard 让模型逐项调用工具，Code 让模型编排 SDK，Minimal 靠近基准工具面，Creator 把运行时本身纳入行动空间；论文没有说明这组 preset 是由内部评测框架演化而来。

这也给 Code Mode 留下一个尚未回答的问题。它很可能减少模型请求次数、延迟和中间 token，但任务成功率未必单向上涨。模型需要正确生成 TypeScript、理解结构化返回并管理程序控制流；如果后训练主要见到原生 tool call，Code Mode 还可能形成分布偏移。仓库目前没有对照结果，`BENCHMARK.md` 只有运行说明，没有公开数字。

要判断它到底值不值，至少应该在同一模型、同一任务、同一权限与 token/时间预算下比较下面几项。

- 成功率与最终补丁质量；
- 模型请求次数、输入输出 token 和端到端延迟；
- 工具副调用数量、并行度与审批次数；
- 上下文压缩发生次数及摘要误差；
- 崩溃恢复后重复副作用的比例；
- worker 峰值内存、子代理总量和失败模式。

在这组实验出现之前，“Code Mode 更先进”只能当作架构假设，不能当作结果。

## 三类状态边界怎样落到安全问题上

DeepSeek Harness 的默认文件保护分成两层。Standard、Code 与 Creator 的内置文件工具在 write/edit 时经过宿主 `dsh-fs-sandbox`。它在 trusted process 内重新 canonicalize 路径并执行 containment policy fence，不使用 bubblewrap 或 Seatbelt。Bash、jobs 等子进程才交给平台 process sandbox，Linux 依次尝试 bubblewrap 与 Landlock，macOS 使用 Seatbelt，Windows 使用 restricted token 与 ACL。受限模式找不到可用进程 backend 时会抛出 `SANDBOX_UNAVAILABLE`，不会静默裸跑。

但这层安全边界有四个需要同时记住的限定。

第一，它主要约束文件效果。官方 CLI 文档明确说明，读取、网络访问和进程可见性不在同样的限制词汇里。sandbox 还会报告 `full` 或 `partial` enforcement。旧 Landlock ABI 可能只有 partial enforcement；Windows ACL backend 因 ambient `Everyone` 权限与 hard-link 边界始终报告 partial。所谓 `workspace-write` 不能被理解成整台机器的通用沙箱。

第二，Minimal 是有意保留的例外。它的持久 Bash 仍走宿主沙箱，`str_replace_editor` 却绑定 scoped `fs-local`，要求绝对路径，也不做通常的 workspace containment。Minimal 适合放在评测本来就提供的容器或 VM 中，不适合直接指向装有私人文件的宿主环境。

第三，路径检查本身可能出现竞态。[Discussion #159](https://github.com/deepseek-ai/deepseek-harness/discussions/159) 的报告者在固定提交 `47f9438` 上，通过后台进程交换工作区目录项，声称 provider-level 5 次全部命中、完整 model-facing 路径 3 次全部命中，从而覆盖工作区外预置文件。受限后台进程直接写外部文件会被拒绝；PoC 让它竞态替换目录项，再误导拥有宿主权限的 `ctx.fs` 在检查过路径后写向另一处。报告者的动态结果直接声称证明的是 TOCTOU/confused-deputy 式越界写，没有证明 bubblewrap 或 Landlock 被突破，也没有证明 RCE。另有社区成员核对了代码机制，还有人给自己的 fork 提交修复；截至本文核查时，上游提交未变，讨论中也没有 maintainer 确认。这里应把它当作有 PoC 和代码分析、尚待官方复现与修复的高优先级报告。

第四，资源预算同样是安全与可靠性边界。[Discussion #131](https://github.com/deepseek-ai/deepseek-harness/discussions/131) 的报告者称，在 Windows 11、Node 24、rc.6 上一次任务派生约 56 个子代理，进程升至约 2.2 GB，单核持续满载，UI 无响应；重启后输入“继续”还能再次触发。事故幅度尚未得到独立动态复现，讨论中也没有维护者确认。固定提交里的默认递归深度限制是可核验事实，但没有等价的全局 `maxConcurrent` 或 `maxTotal`；后台和 continuable 子代理也不会始终被一次顶层 `maxParallelToolCalls` 约束。报告指向的全局预算缺口与实现一致。Agent 资源需要按整棵执行树计费，单看调用栈深度挡不住一层铺开几十个 sibling。

### 本地优先仍然会有出站数据

会话默认写本地 JSONL，telemetry 默认是 `DISABLED`。用户打开 `FULL` 后，配置会发送完整 `event.data`，其中可能包括消息、工具参数、工具结果、prompt、schema 和路径；没有内置脱敏器。

独立于 telemetry，正常模型请求本来就要发往 provider。DeepSeek adapter 每次还会给配置的 base URL 发送稳定匿名 user id，有 session 时附带准确 session id。base URL 改成第三方 gateway，这些 header 也会随请求发过去。因此隐私审计至少要区分模型 provider、网页搜索/MCP 等工具和可选 telemetry 三条出站路径。只看到“日志保存在本机”远远不够。

## 把三套协议放进同一次执行

前面的结构可以用一场 Code preset 会话串起来。新 Agent 创建自己的 scope，绑定当前 preset generation。用户消息先进入 Session，`buildRequest()` 再从 surface 取 messages，把当时的 system、tools 和模型参数记进 request header。模型此时只看到 `run_code` 和生成的 SDK。

模型写了一段程序，同时搜索三个目录。Worker 把三次 `grep` 交给宿主；只有声明并发安全的 body 才会重叠，参数验证、policy 和审批仍逐项执行。每次副调用在 raw log 中留下 dispatch 事件，结构化 `matches` 则回到 worker。程序筛掉无关结果，只把五个文件名作为外层 `run_code` 结果送回模型。下一轮上下文因而没有三份完整搜索输出，Trajectory 仍能说明三次调用各自做了什么。

会话继续运行，旧工具结果把上下文推到窗口的八成。compaction 追加 replacement，surface 改为短版本，raw log 仍保留原文与 provenance。如果用户此时修改 preset，已经开始对话的当前 Agent 不会迁移；以后新建的顶层 Agent 可以进入新 generation，而由当前 Agent 创建的子 Agent 仍精确继承父级所在的旧 generation。若变化来自当前 scope 内的 provider replacement，旧 provider 的 consumer 才会进入卸载，effect disposer 清理监听器与服务注册，依赖恢复后再装载。

最后，程序调用了一个有文件副作用的原生工具。顶层 `run_code` 的调用意图已经在执行前 flush；某个内部 edit 完成后进程突然退出，外层 result 没有落盘。恢复逻辑只能确认外层 `tool/call` 已耐久记录，不能确认外层 body 是否真正开始，也不能从 dispatch 记录推出整段程序最终成功，更无法把 worker 的中间变量复原。它只能把结果标成未知，让下一步检查文件。

这段流程展示了三套协议各自的停点。Cordis 能清理框架管理的资源，Session 能重建模型看见的投影，checkpoint 能证明顶层工具 body 获准执行前，调用意图已耐久化；它不能证明外部动作实际开始或结束的精确时刻。系统越过进程边界以后，保证会逐级变弱。DeepSeek Harness 没有用一个“全量 replay”承诺掩盖这些差异，而是让未知状态在日志里留下明确名字。

## 现在已有的证据，究竟能推出什么

围绕首日发布，最容易出现的问题是把论文、代码和用户体验揉成一个结论。下面这张表是我采用的证据边界。

| 材料 | 能够支持的判断 | 不能支持的判断 |
|---|---|---|
| Cordis 预印本与实现 | effect/依赖机制怎样工作；在给定假设下怎样保持组合性质 | 任意插件都能正确卸载；Creator 自动安全；外部副作用可回滚 |
| Koishi 案例 | Cordis 思路在一个大型真实生态长期使用 | Cordis v4 的全面实证；Harness 性能优于其他 Agent runtime |
| V3.2、V4 技术报告 | DeepSeek 的工具训练、reasoning retention/context-management 规则与内部评测配置 | 公开 Harness 就是内部 Harness；论文 benchmark 能代表四个公开 preset |
| 固定提交的公开代码 | preset、Session、工具管线、adapter 与默认配置的真实行为 | 下一 RC 仍保持 ABI；未公开生产环境也采用完全相同配置 |
| GitHub/HN 社区报告 | 具体版本、机器和步骤下的可复现线索与生态摩擦 | 普遍性能结论；上游已经确认或修复；单个体验代表所有用户 |

社区反馈本身也呈现出这种两面性。一名 HN 用户称自己很快接通本地 llama.cpp 与 9B Qwen，并在小型 Python 项目中取得不错结果。另一名用户 Kuyawa 同时肯定 UI、Trajectory 和实际建应用的体验，也记录了约 47 MB 下载、构建后约 1.5 GB；还有一人自报空闲会话约占 500 MB。这些都只是未经独立复核的本机体验，不能外推成统一性能指标。插件作者在 [Discussion #380](https://github.com/deepseek-ai/deepseek-harness/discussions/380) 记录了模块解析、`inject` 形状、bundle 声明遗漏导致“安装但不激活”、persona scope 遮蔽等问题，另一名开发者称自己也遇到其中的依赖解析问题。至少已经有用户在具体环境中跑通核心能力，RC 阶段的错误信息、打包和版本漂移也确实会直接落到使用者身上。

官方目前限制新建 Issue 与 PR，公开讨论主要集中在 Discussions。关于客户端、CLI 与 VS Code 的整组诉求，[Discussion #172](https://github.com/deepseek-ai/deepseek-harness/discussions/172) 里有 collaborator 简短回复“后面会有”。这句回复没有区分具体客户端类型，也没有时间表，不能读成三项都已经进入确定路线图。项目当前更接近正在公开成形的 runtime，产品化客户端仍待补齐。

## 我会怎样使用它

如果工作内容是研究 Agent runtime、插件系统、持久执行或上下文管理，这个仓库现在就值得逐层读。三处实现尤其有参考价值，包括 provider replacement 时 consumer 的完整卸载、append-only raw log 上的 surface replacement，以及 Code Mode 拆开的程序内值、审计记录和模型输出。

如果只是想在个人仓库里试用，可以从 Standard 开始，再为同一批任务固定模型、commit、权限和预算，比较 Code。运行环境最好放在 VM 或容器里，Minimal 与 Creator 尤其如此；子代理再加一道宿主级并发和内存上限。对接第三方 gateway 时检查自定义 header，开启 FULL telemetry 前先确认事件内容。

如果准备接入生产仓库，我会先等三件事。

1. 文件路径竞态得到上游复现、修复和回归测试；
2. 插件 ABI、preset generation 和 JSONL v0 会话迁移策略趋于稳定；
3. 同模型、同任务、同预算的 preset 对照公开，资源总量控制补齐。

Harness 现在的价值已经相当清楚，只是价值的种类和成熟客户端不同。它把 Agent 长时间运行时最难缠的状态问题摆到了台面上，并给出了一套连贯实现。

内部状态尽可能可撤销，模型视图必须可解释，外部副作用承认不可逆。Cordis、Session 和 checkpoint policy 分别守住这三条边界；Code Mode 在上面重新安排工具调用，却仍回到同一条权限、提交和审计管线。

这套分工比“又多了几个工具”重要得多。以后无论 DeepSeek Harness 是否成为主流客户端，如何区分可逆资源、可重建历史与不可逆副作用，都会是每个 serious Agent runtime 绕不过去的问题。

## 主要来源

- [DeepSeek Harness 官方页面](https://www.deepseek.com/harness/)
- [DeepSeek Harness 官方仓库与 Developer Preview 说明](https://github.com/deepseek-ai/deepseek-harness)
- [npm 上的 @deepseek-ai/dsh](https://www.npmjs.com/package/@deepseek-ai/dsh)
- [本文使用的固定代码快照](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a)
- [固定快照的贡献指南](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/CONTRIBUTING.zh.md)
- [headless CLI 参考文档](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/apps/cli/reference/README.md)
- [受限的 Issues 页面](https://github.com/deepseek-ai/deepseek-harness/issues)
- [受限的 Pull requests 页面](https://github.com/deepseek-ai/deepseek-harness/pulls)
- [运行时架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md)
- [preset standing scope 实现](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/preset/agent-presets/src/index.ts)
- [Cordis fiber 生命周期实现](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/vendor/cordis/src/fiber.ts)
- [Session 子系统文档](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/session.md)
- [Session surface 验证与替换实现](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/session/src/surface.ts)
- [工具结果裁剪实现](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/compaction/compaction-tool-result-pruner/src/index.ts)
- [工具执行管线文档](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/tool-execution-pipeline.md)
- [Code Mode 核心实现](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/tools/src/code-mode.ts)
- [Code Mode worker 默认限制](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/code-runtime/code-runtime-worker-thread/src/index.ts)
- [Session 修复逻辑](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/session/src/repair.ts)
- [checkpoint policy 实现](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-checkpoint-policy/src/index.ts)
- [process sandbox 子系统文档](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/sandbox.md)
- [Minimal preset 的 fs-local 配置](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/apps/cli/config/agent-presets/minimal/agent.cordis.yml)
- [DeepSeek adapter 的消息序列化](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/llm/llm-deepseek/src/serialize.ts)
- [Cordis 时空可组合性预印本固定快照](https://github.com/cordiverse/paper/tree/948a07b369c62adb3b12e102458be5c18dfb69b9)
- [DeepSeek V3.2 技术报告](https://arxiv.org/abs/2512.02556)
- [DeepSeek V4 技术报告](https://arxiv.org/abs/2606.19348)
- [官方数据处理说明](https://www.deepseek.com/harness/data-processing/)
- [官方安全说明](https://www.deepseek.com/harness/privacy/)
- [文件边界竞态报告 #159](https://github.com/deepseek-ai/deepseek-harness/discussions/159)
- [子代理资源失控报告 #131](https://github.com/deepseek-ai/deepseek-harness/discussions/131)
- [插件开发实录 #380](https://github.com/deepseek-ai/deepseek-harness/discussions/380)
- [客户端形态讨论 #172](https://github.com/deepseek-ai/deepseek-harness/discussions/172)
- [#172 中 collaborator 的回复](https://github.com/deepseek-ai/deepseek-harness/discussions/172#discussioncomment-18010039)
- [HN 用户的本地 9B Qwen 体验](https://news.ycombinator.com/item?id=49287033)
- [HN 用户 Kuyawa 的本机体积记录](https://news.ycombinator.com/item?id=49287890)
- [同一用户对 UI 与 Trajectory 的体验](https://news.ycombinator.com/item?id=49288265)
- [另一名 HN 用户的空闲内存记录](https://news.ycombinator.com/item?id=49287827)
