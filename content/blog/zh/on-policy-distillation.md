---
title: "On-Policy Distillation(OPD)深度解析:损失函数、散度选择与自蒸馏"
date: "2026-07-25"
description: "把 OPD 的原理写透:损失函数的三种等价写法、它把分布训成什么样、与 SFT/离线蒸馏/RL 的精确数学关系、reverse KL 之外的散度动物园,以及 2026 年上半年的 OPSD 自蒸馏革命与批判性文献。"
tags:
  - LLM
  - 知识蒸馏
  - On-Policy Distillation
  - 强化学习
  - 后训练
featured: true
---

> 本文初版写于 2026 年 5 月,原为一份文献调研报告;2026 年 7 月 25 日全文重写为原理导向的深度解析,文献覆盖更新至 2026 年 7 月。

## 引言

On-Policy Distillation(OPD,在线策略蒸馏)用一句话说,就是**让学生模型在自己生成的轨迹上,接受教师模型的逐 token 密集反馈**。自 2025 年 10 月 Thinking Machines Lab 的博客[《On-Policy Distillation》](https://thinkingmachines.ai/blog/on-policy-distillation/)(Kevin Lu)引爆这个方向以来,它在不到一年里从"一个聪明的训练技巧"变成了头部厂商后训练流水线的标准组件——DeepSeek-V4 用它合并领域专家,小米 MiMo 用它做多教师蒸馏,GLM-5 用它跨阶段抗遗忘。

但大多数介绍停留在"学生 rollout + 教师逐 token 打分"的直觉层。这篇文章想把几个更硬的问题回答清楚:

- OPD 的损失函数到底长什么样?它有哪几种等价写法,各自的偏差和方差如何?
- 它把学生的分布**训成了什么样**——优化的不动点是什么?
- 它与 SFT、离线蒸馏、RL 的数学关系,能不能精确到一个等式?
- 除了 reverse KL,还能用什么散度?为什么 2026 年的 OPSD 里 forward KL 反而最好?
- 2026 年上半年的自蒸馏革命(OPSD)和一批批判性文献,改变了什么?

**记号约定**:教师分布记 $p_T$,学生(策略)分布记 $p_S$ 或 $\pi_\theta$;$x$ 为输入,$y$ 为生成序列,$y_{<n}$ 为前 $n-1$ 个 token 构成的前缀;自回归分解 $\pi_\theta(y\mid x) = \prod_{n} \pi_\theta(y_n \mid x, y_{<n})$。

---

## 一、一个坐标系看懂所有后训练方法

所有后训练方法都可以放进两个自由度张成的坐标系:**训练轨迹来自谁**(off-policy:来自别人 / on-policy:来自学生自己)× **监督信号有多密**(稠密:每个 token 都有信号 / 稀疏:整条序列只有一个标量)。

| 方法 | 训练轨迹来源 | 监督信号密度 |
| --- | --- | --- |
| SFT | off-policy(人类/教师数据) | 稠密(逐 token 交叉熵) |
| 离线蒸馏 | off-policy(教师生成) | 稠密(逐 token 分布匹配) |
| RL / RLVR | on-policy(学生 rollout) | 稀疏(序列级标量奖励) |
| **OPD** | **on-policy(学生 rollout)** | **稠密(教师逐 token 分布)** |

这张表来自 Thinking Machines 原文(我们加了"离线蒸馏"一行),它是理解 OPD 全部优势与全部局限的钥匙:

- **RL 的痛点在"稀疏"**:一条几百 token 的推理链,对错只在末端给一个 0/1,信用分配(credit assignment)无从谈起——学生知道答案错了,却不知道错在哪一步;
- **SFT 的痛点在"off-policy"**:学生只在教师/数据走过的状态上学习,推理时自己犯了错、走进训练里从未出现的状态,错误就会沿自回归级联(exposure bias);
- **OPD 占了空出来的第四象限**:轨迹是学生的(治 exposure bias),信号是稠密的(治信用分配)。

下面把每一格都写成数学,你会发现它们之间的差别比想象中更小——往往只是同一个损失里的两个旋钮拧到了不同位置。

---

## 二、数学基础:蒸馏 = 散度最小化

### 2.1 统一形式

给定教师 $p_T$ 和学生 $p_S$(参数化为 $\pi_\theta$),几乎所有蒸馏方法都能写成同一个形式:

$$\mathcal{L}(\theta) = \mathbb{E}_{x \sim \mathcal{D}}\; \mathbb{E}_{y \sim q(\cdot \mid x)}\Bigg[ \sum_{n=1}^{|y|} D\Big( p_T(\cdot \mid x, y_{<n}) \,\Big\|\, p_S(\cdot \mid x, y_{<n}) \Big) \Bigg]$$

这里只有两个自由旋钮:

1. **采样分布 $q$**:求期望的轨迹 $y$ 从哪来——固定数据集(SFT)、教师生成(离线蒸馏)、还是学生自己(OPD);
2. **散度 $D$**:用什么衡量两个 next-token 分布的差异、谁放在前面——forward KL、reverse KL、JSD、skew KL、TVD……

后面我们会看到:GKD、MiniLLM、TML 版 OPD、OPSD,全部是这两个旋钮的不同拧法。

### 2.2 SFT = 数据分布上的 forward KL

先看一个常被忽视但至关重要的事实:**SFT 本身就是一种蒸馏,而且用的是 forward KL**。SFT 的交叉熵损失

$$\mathcal{L}_{\mathrm{SFT}}(\theta) = -\mathbb{E}_{(x,y)\sim\mathcal{D}} \sum_{n=1}^{|y|} \log \pi_\theta(y_n \mid x, y_{<n})$$

就是最大似然;而最大似然等价于最小化"数据分布→模型"方向的 KL(差一个与 $\theta$ 无关的数据熵常数):

$$\arg\max_\theta\; \mathbb{E}_{y\sim p_{\mathrm{data}}} \log \pi_\theta(y) \quad\Longleftrightarrow\quad \arg\min_\theta\; \mathrm{KL}\big(p_{\mathrm{data}} \,\|\, \pi_\theta\big)$$

也就是说,SFT 是把数据分布当教师、在教师轨迹上做的 forward KL 蒸馏。这个等价关系是后面一切讨论的起点:SFT 的优点(稠密、稳定、实现简单)和缺点(mode-covering、exposure bias)都可以从这个式子里推出来。

### 2.3 Exposure bias:off-policy 的原罪

SFT 训练时,每个前缀 $y_{<n}$ 都来自数据分布(teacher forcing);推理时,前缀来自学生自己。学生早期一旦犯了教师从不犯的错,就会进入一个训练分布里几乎不存在的状态,此后的每一步都在"未见过的土地"上行走,误差沿序列**级联累积**。

这在模仿学习里是老问题,而且有漂亮的定量结果(Ross et al., 2011, [DAgger](https://arxiv.org/abs/1011.0686)):设每步策略误差为 $\varepsilon$、序列长为 $T$,行为克隆(= SFT)的累积误差是 $O(\varepsilon T^2)$;而 DAgger 让专家在**学习者自己访问的状态**上给出标注,累积误差降到 $O(\varepsilon T)$。把一个 $T$ 因子省下来的代价,只是"专家要愿意在学习者犯错的地方继续指导"。

**OPD 就是 DAgger 思想在 LLM 上的实例化**:"专家"是教师模型给出的逐 token next-token 分布,"学习者访问的状态"是学生自己 rollout 出来的前缀。Thinking Machines 原文也明确把 DAgger 列为第一灵感来源。理解了这一层,on-policy 就不再是一个工程 trick,而是模仿学习二十年理论在 LLM 时代的还魂。

### 2.4 离线蒸馏家族:换了散度,换不掉教师轨迹

在 OPD 之前,蒸馏在 LLM/NLP 里已经有完整谱系,它们的 $q$ 全部取教师/数据:

- **Word-level KD**:在教师(或数据)序列上逐 token 算 forward KL;Hinton 2015 年的经典 KD([arXiv:1503.02531](https://arxiv.org/abs/1503.02531))是它的分类版——温度 $T$ 软化分布、软目标梯度按 $1/T^2$ 缩放故需乘回 $T^2$;
- **Sequence-level KD**(SeqKD,Kim & Rush 2016,[arXiv:1606.07947](https://arxiv.org/abs/1606.07947)):直接对序列分布做 forward KL 不可解(指数级求和),于是用教师 beam search 的众数样本近似——实际就是"在教师 beam 输出上做 SFT"。它留下一个至今仍有提醒意义的实验现象:蒸馏学生的 PPL 反而更差(22.7 vs 8.2)但 BLEU 更好——**困惑度低不等于生成好**,学生只需把概率集中到教师众数附近;
- **Logit 蒸馏**:在每个位置匹配全词表分布,信息最完整,但只要轨迹来自教师,分布失配就依然在。

共同的病根不在散度,而在 $q$:**无论 $D$ 选什么,状态分布都不是学生自己的**。这正是 OPD 拧动的第一个旋钮。

---

## 三、OPD 的损失:三种等价写法

OPD 取 $q = p_S$——在学生自己的 rollout 上算逐 token 散度。但"在学生轨迹上最小化散度"在实践里有三种实现形态,它们都被叫做 OPD,搞清楚它们的等价性与差异,是读懂 2026 年文献的前提。

### 3.1 全词表形式(logit OPD)

$$\mathcal{L}(\theta) = \mathbb{E}_{x}\; \mathbb{E}_{\hat{y} \sim p_S(\cdot \mid x)}\Bigg[ \frac{1}{|\hat{y}|} \sum_{n=1}^{|\hat{y}|} D\Big( p_T(\cdot \mid x, \hat{y}_{<n}) \,\Big\|\, p_S(\cdot \mid x, \hat{y}_{<n}) \Big) \Bigg]$$

每个位置上对**完整词表**的两个分布求散度,梯度只流过学生 logits。信号最稠密、无采样噪声,但教师要对每条学生轨迹做一次完整前向取 logits,学生反向也要过全词表,显存和算力开销都不小。DeepSeek-V4 合并领域专家时用的就是全词表 reverse KL(多教师加权);OPSD 用的是全词表 forward KL(见第七节)。

### 3.2 采样 token 形式(TML 版)

Thinking Machines 的选择是逐 token **reverse KL**,但只在学生实际采到的 token 上估计:

$$\mathrm{KL}\big(\pi_\theta \,\|\, \pi_T\big)\Big|_{x_{1..t}} = \mathbb{E}_{x_{t+1} \sim \pi_\theta}\Big[ \log \pi_\theta(x_{t+1} \mid x_{1..t}) - \log \pi_T(x_{t+1} \mid x_{1..t}) \Big]$$

实现时,把每个 token 的**教师 logp 减学生 logp** 当作优势(advantage):

$$A_n = \log \pi_T(\hat{y}_n \mid x, \hat{y}_{<n}) - \log \pi_\theta(\hat{y}_n \mid x, \hat{y}_{<n})$$

然后直接调用 RL 训练器的 importance-sampling 损失。用原文的话说,对任何带 KL 正则的 RL 实现,这**只改一行代码:把参考模型换成教师**。工程红利非常实在:

- 教师只需一次前向(`compute_logprobs`),不生成 token;
- 不必等 rollout 采完,可以用短 rollout 甚至部分 rollout;
- 采样由更便宜的学生承担,折扣因子取 0(每步只优化当前 token)在实践中不掉点。

### 3.3 策略梯度形式(MiniLLM 版)

MiniLLM(Gu et al., 2023,[arXiv:2306.08543](https://arxiv.org/abs/2306.08543))早在 2023 年就给出了第三种面孔。对**序列级** reverse KL 目标直接求梯度,得到的是一个标准的 REINFORCE:

$$\nabla \mathcal{L}(\theta) = -\mathbb{E}_{y \sim \pi_\theta} \sum_{t} \big(R_t - 1\big)\, \nabla \log \pi_\theta(y_t \mid y_{<t}), \qquad r_t = \log \frac{p_T(y_t \mid y_{<t})}{\pi_\theta(y_t \mid y_{<t})}$$

其中 $R_t = \sum_{t' \ge t} r_{t'}$ 是回报,$-1$ 来自学生自身的熵项。也就是说,**OPD = 以"教师 logp − 学生 logp"为逐 token 稠密奖励的策略梯度**。TML 设折扣为 0 的采样版,正是这个梯度的单步简化。

MiniLLM 论文里还有三个至今仍在用的稳定化技巧,值得记住:

1. **Single-step decomposition**:把单步项拆出来对整个词表精确求和(不采样),大幅降方差;
2. **Teacher-mixed sampling**:以 $\alpha=0.2$ 的比例混入教师分布采样,抑制退化轨迹与奖励 hacking,配截断重要性权重;
3. **Length normalization**:回报按剩余长度归一,消除"短序列回报天然更高"的偏置。

### 3.4 三种形态的关系:偏差-方差的取舍

三种写法并不等价,差异在统计性质上:

- **全词表**:对逐 token 目标无偏、信号最完整,但最贵;
- **采样 token**:便宜、可复用 RL 基建,但对序列级 reverse KL **有偏**——逐 token 目标里每一项的期望都依赖学生自己诱导的前缀分布,而前缀分布本身也随 $\theta$ 变化,token 级求和并不等于序列级散度;
- **Revisiting OPD**(Fu et al., 2026-03,[arXiv:2603.25562](https://arxiv.org/abs/2603.25562))把这件事定理化了:token 级 OPD 相对序列级 reverse-KL 有偏,但**最坏方差界显著更紧**(论文的分析为 $O(T^2)$ 对 $O(T^4)$);合成实验还显示,未来奖励耦合越强,梯度方差越大、训练越不稳。这从理论上解释了为什么社区一致选择 token 级估计器;
- 同一论文还指出采样版在长 rollout 上的失效机制:学生前缀逐渐漂出教师典型支撑,教师在这些"陌生状态"上的指导变得不可靠。修法是**教师 top-K 局部支撑匹配**——只在教师 top-K token 集合上比较截断后的 reverse KL,配合 top-p 采样和特殊 token 掩码,比标准采样版提升 +19.8%。

---

## 四、不动点分析:OPD 把分布训成了什么样

损失函数只是手段,真正的问题是:这个目标的最优解是什么分布?学生最终会变成什么样?

### 4.1 容量无限时:逐状态的条件分布拷贝

逐 token 散度在每个前缀上是**相互独立**的最小化问题——每个位置的最优解都是让学生的 next-token 分布等于教师的。所以容量无限时,OPD 的不动点是:

$$\forall\, \hat{y}_{<n} \text{ 在学生可达前缀集上}: \quad p_S(\cdot \mid x, \hat{y}_{<n}) = p_T(\cdot \mid x, \hat{y}_{<n})$$

注意它与 SFT 不动点的差别只在"在哪些前缀上相等":**SFT 在教师会去的状态上拷贝教师,OPD 在学生自己会去的状态上拷贝教师**。后者恰好覆盖了推理时的真实分布——这就是 exposure bias 被消除的精确含义。

### 4.2 容量有限时:散度方向决定命运

现实中学生容量远小于教师,不动点达不到,散度的**方向**开始起决定性作用(经典理论见 Bishop PRML §10.1.2 与 Huszár 2015,[arXiv:1511.05101](https://arxiv.org/abs/1511.05101)):

- **Reverse KL**($\mathrm{KL}(p_S \| p_T)$,学生在前)是 **zero-forcing / mode-seeking** 的:教师概率为零的地方,学生必须也趋零,否则惩罚无穷;但允许学生放弃教师的部分众数。净效果是学生**收缩到教师的主众数**上——放弃多样性,保住正确性与忠实度;
- **Forward KL**($\mathrm{KL}(p_T \| p_S)$,教师在前)是 **zero-avoiding / mass-covering** 的:教师有质量的地方学生必须都有质量;容量不够时,学生只能把概率摊薄到教师的低概率区,结果是在自由生成时采出"教师分布下极不可能"的序列——蒸馏版幻觉就是这么来的。

MiniLLM 论文里的高斯混合 toy 实验是这个对照的经典演示:forward KL 学出一个盖住所有众数的胖高斯(均值化),reverse KL 收缩到单一众数。Thinking Machines 选择 reverse KL 正是基于这个论证,他们还指出 reverse KL 的两个实用性质:**mode-seeking** 让学生只学一种确定行为(教师的)而非在多个次优选项间摊派,以及天然缓解 exposure bias。

### 4.3 Forking tokens:惩罚集中在哪

Thinking Machines 原文里最有信息量的一个实证观察:把学生答错的轨迹按逐 token reverse KL 染色,深红色(惩罚最大)集中在**把学生带上歧路的短语起始 token** 上——推理链的"分叉点"(forking tokens);而最终的错误答案几乎不被惩罚,因为给定前面那串推理,它是完全可预测的。

这个观察的价值在于它回答了"OPD 到底在学什么":**它监督的是过程中的策略选择,而不是结果**。这与 RLVR 形成鲜明对照——GRPO 给整条序列的所有 token 分配同一个优势,无法区分"走错方向的决策点"和"将错就错的合理续写"。它与 RL 侧的独立证据也相互印证:[Beyond the 80/20 Rule](https://arxiv.org/abs/2506.01939)(Wang et al., 2025)发现 RL 的增益主要由少数高熵分叉 token 驱动——OPD 的教师惩罚恰好也落在同一类 token 上。

### 4.4 与 SFT 的分工:先撑开支撑,再收缩众数

Thinking Machines 在注脚里埋了一条重要的实践原则:**SFT(forward KL)负责扩充支撑,reverse KL 负责在支撑内 mode-seek**。如果学生的支撑里根本没有相关 token(比如 mid-training 前从未见过某领域),reverse KL 无从收缩——教师再强也教不出来。所以几乎所有 OPD 实践都从 SFT/mid-training 检查点出发:先用 off-policy 的 forward KL 把新 token 引进支撑,再用 on-policy 的 reverse KL 把分布削到教师的主众数上。两个散度不是竞争对手,是流水线上的上下游。

---

## 五、散度动物园:reverse KL 不是唯一选择

回到统一形式里第二个旋钮 $D$。所有常用散度都属于 f-散度家族:

$$D_f(p \,\|\, q) = \sum_{v} q(v)\, f\!\left(\frac{p(v)}{q(v)}\right), \qquad f \text{ 凸且 } f(1)=0$$

取不同的 $f$ 得到不同的行为。一张总览表(方向约定:与蒸馏文献一致,$p$=教师,$q_\theta$=学生):

| 散度 | 行为 | 梯度性质 | 代表工作 |
| --- | --- | --- | --- |
| Forward KL(教师在前) | mass-covering,均值化 | 系数含 p/q,q→0 时爆炸 | Hinton KD、GKD 默认 |
| Reverse KL(学生在前) | mode-seeking,收缩众数 | 含学生熵项,天然降熵 | MiniLLM、TML OPD |
| JSD(β)(广义) | 对称化折中,有界 | 分母是混合分布,恒正 | GKD |
| Skew KL(α) | 接近 KL 但温和 | 混合分布使梯度有界 | DistiLLM |
| TVD(全变差) | 对称、有界 | 无 log,梯度最稳 | f-distill |

逐个展开:

**广义 JSD(GKD)**:GKD(Agarwal et al., 2023,[arXiv:2306.13649](https://arxiv.org/abs/2306.13649))——"on-policy distillation"一词的正式出处——引入

$$\mathrm{JSD}(\beta)(p_T \| p_S) = \beta\, \mathrm{KL}\big(p_T \,\|\, m\big) + (1-\beta)\, \mathrm{KL}\big(p_S \,\|\, m\big), \qquad m = \beta p_T + (1-\beta) p_S$$

$\beta \to 0$ 时趋于 forward KL,$\beta \to 1$ 时趋于 reverse KL,中间是一片连续的折中地带;有界性让它不会像 KL 那样出现无穷惩罚。GKD 还定义了数据侧的 $\lambda$ 插值($\lambda=0$ 纯 off-policy、$\lambda=1$ 纯 on-policy、$0.5$ 混合),把统一形式里的两个旋钮都参数化了。

**Skew KL(DistiLLM)**:DistiLLM(Ko et al., 2024,[arXiv:2402.03898](https://arxiv.org/abs/2402.03898))观察到 forward KL 的梯度系数是 $p/q_\theta$,学生给某 token 分配的概率趋零时梯度爆炸。修法是把 KL 的一个参数替换成插值分布:

$$D_{\mathrm{SKL}}^{(\alpha)}(p, q_\theta) = \mathrm{KL}\big(p \,\|\, \alpha p + (1-\alpha) q_\theta\big), \qquad D_{\mathrm{SRKL}}^{(\alpha)}(p, q_\theta) = \mathrm{KL}\big(q_\theta \,\|\, (1-\alpha) p + \alpha q_\theta\big)$$

混合分布的分母恒正,梯度范数有界,训练显著更稳;实验最优 $\alpha=0.1$,配合自适应 off-policy 调度和 replay buffer,比 MiniLLM/GKD 提速 2.5–4.3 倍。

**对称散度(f-distill)**:Wen et al. 2023([arXiv:2307.15190](https://arxiv.org/abs/2307.15190))做了迄今最系统的散度对比:KL/RKL/JS/TVD 全部分解为 step-wise 损失,在摘要、翻译、对话上统一评测。结论:单向 KL 的病根都在不对称(KL 过覆盖、RKL 过收缩),**对称散度(JS、TVD)在绝大多数任务上更优**;他们还提出 likelihood risk 与 coverage risk 两个诊断指标,把"覆盖不足"和"众数塌陷"分开度量。

### 5.1 三个反直觉的结论,"reverse KL 最优"不是定律

**其一,GKD 自己的实验**:最优散度是任务相关的——WMT 翻译用 JSD(0.1) 最好,其余任务反而是 forward KL 最好。翻译的输出空间接近单峰,mass-covering 无害;开放式生成就另当别论。

**其二,f-distill 的系统比较**:对称散度普遍优于单向 KL,这与"reverse KL 适合生成"的流行说法并不一致——流行说法来自 MiniLLM 的指令跟随场景,未必可推广。

**其三,也是最新的:OPSD 的消融**(2026,详见第七节)发现,自蒸馏场景下全词表 **forward KL 显著最好**(AIME25 @ Qwen3-1.7B:36.7 → 43.9),reverse KL 和 JSD(0.5) 提升有限甚至为负——与 Thinking Machines 的选择正好相反。

为什么 OPSD 反过来了?以下是我们的解读(论文未给出定论):OPSD 的师生是**同一个模型**,容量差为零,mass-covering 的主要代价(摊薄到空区)天然消失;特权教师的高概率区集中在"通向正确解答"的 token 上,covering 保证这些 token 一个不漏;而 mode-seeking 会把学生过早压回它已有的模式——那恰恰是它做错题的模式。旁证来自 **EOPD**(Jin et al., 2026-03,[arXiv:2603.07079](https://arxiv.org/abs/2603.07079)):教师高熵位置(编码多条推理路径的不确定性)改用 forward KL 增强、低熵位置保持 reverse KL,在 6 个数学基准上 Pass@8 提升 +1.37~+5.05。**没有全位置最优的散度**——推理分叉点该收缩,路径选择点该保持。

### 5.2 工程稳定化技巧汇总

散度之外,2026 年的实践沉淀了一组即插即用的稳定化手段:

| 技巧 | 出处 | 解决什么 |
| --- | --- | --- |
| Teacher-mixed sampling(α=0.2) | MiniLLM | 退化轨迹、奖励 hacking |
| Single-step decomposition | MiniLLM | 采样方差 |
| Length normalization | MiniLLM | 短序列偏置 |
| 教师 top-K 局部支撑匹配 | Revisiting OPD | 长 rollout 前缀漂移(+19.8%) |
| 逐 token 逐词表项 pointwise clipping | OPSD | 风格 token 主导训练信号 |
| 特殊 token 掩码 + tokenizer 对齐 | Revisiting OPD | 系统性偏差 |
| 熵感知散度混合 | EOPD | 高熵位置信息丢失 |

---

## 六、OPD 与 RL:一体两面

### 6.1 蒸馏 = 稠密奖励的 RL

把 MiniLLM 的梯度形式(§3.3)和 RLHF 的标准目标并排看:

$$\max_\theta\; \mathbb{E}_{y \sim \pi_\theta}\big[ r(x, y) \big] - \beta\, \mathrm{KL}\big(\pi_\theta \,\|\, \pi_{\mathrm{ref}}\big)$$

取逐 token 奖励 $r_t = \log p_T(y_t \mid \cdot)$、参考策略取学生自身、$\beta=1$,就精确退化为 OPD。KL 正则 RL 还有闭式解 $\pi^\star(y\mid x) \propto \pi_{\mathrm{ref}}(y\mid x) \exp\big(r(x,y)/\beta\big)$——向"奖励倾斜分布"做 reverse KL 投影(Korbak et al., 2022,[arXiv:2205.11275](https://arxiv.org/abs/2205.11275));OPD 可以看作这个投影的在线近似。

这个等价的实际含义是:**蒸馏把 RL 的探索问题消掉了**。RL 难在奖励稀疏、需要探索;而 OPD 的奖励函数是教师 logp——已知、稠密、无噪声,于是问题退化为纯优化。Thinking Machines 的表述很精辟:RL 在语义策略空间里搜索,蒸馏是一条直达最终策略的捷径。

### 6.2 G-OPD:定理化的等价,与超越教师的钥匙

G-OPD(Yang et al., 2026-02,[arXiv:2602.12125](https://arxiv.org/abs/2602.12125))把这个直觉变成了定理:**标准 OPD 是稠密 KL 约束 RL 的特例——奖励项与 KL 正则恒等权重,参考模型可以是任意模型**。沿着定理松绑出两个扩展:

- **奖励缩放因子 $\lambda$**(奖励项相对 KL 正则的权重):$\lambda > 1$ 即"奖励外推"(ExOPD),在"把各领域 RL 专家合并回基座"的场景中,学生在**所有领域都超越了对应教师**;
- **灵活参考模型**:强教师蒸馏弱学生(strong-to-weak)时,取教师的 pre-RL 基座做参考模型可校正奖励信号,进一步提升(代价是需要教师的 pre-RL 版本和额外算力)。

这个定理也给出冷静的推论:标准 OPD($\lambda=1$,KL 锁死)的能力上限被教师封死——**想超越教师,要么外推,要么回到 RL**。这与 2026 年对 OPD 定位的共识一致:OPD 是"探索催化剂",负责把学生引到正确的路上,不负责抬高天花板(Demystifying OPD,见 6.3)。

### 6.3 "不可黑客"的限度

Thinking Machines 原文有个著名论断:reverse KL 奖励是"unhackable"的——低 KL 必然对应教师视角下的高概率行为,不像学得出来的奖励模型那样容易被钻空子。

2026 年 7 月的 **Demystifying OPD**(Wang et al.,[arXiv:2607.13399](https://arxiv.org/abs/2607.13399))给出了迄今最清晰的反驳:OPD 存在两种病理,其一是师生失配(教师信号与任务正确性脱节),其二是 **length exploitation**——学生学会靠截断回答或冗余填充来操纵逐 token 稠密奖励,这是 OPD 版本的 reward hacking。好在修法很轻:advantage 硬裁剪、保序 log 压缩即可大幅缓解。结论应当修正为:reverse KL 相对**学得出的奖励模型**更难 hack,但不是绝对免役。

### 6.4 与 GRPO/RLVR 的组合:2026 年的主流配方

OPD 与 RL 不是替代关系,是互补关系——OPD 给过程(哪一步错了),RL 给方向(答案对不对)。2026 年跑出了几种成熟的组合方式:

- **RLSD**(Yang et al., 2026-04,[arXiv:2604.03128](https://arxiv.org/abs/2604.03128)):纯自蒸馏的信号会泄露特权信息、长期训练不稳;RLSD 让自蒸馏只决定逐 token 的**更新幅度**,让 RLVR 的环境反馈决定**更新方向**,两者结合超过各自的天花板;
- **SRPO**(2026-04,[arXiv:2604.02288](https://arxiv.org/abs/2604.02288)):按样本对错路由——错误样本走自蒸馏(精确定位错在哪)、正确样本走 GRPO 式奖励;Qwen3-8B 五个基准平均比 GRPO +3.4%、比 SDPO +6.3%;
- **Seed 的置信门控 OPD**(2026-07):在 OPD 的逐 token 信号上加门 $g = \sigma(\beta \cdot \Delta \log p)$,防止"技能归因错误"的 token 把错误知识学进策略,与 GRPO 损失联合优化。我们精读区有这篇的全文译注:[Seed:自进化 OPD](/zh/reading/seed-self-evolving-opd);
- **sparse-to-dense 原则**:在 GRPO 稀疏奖励阶段之间插入 OPD 稠密教师奖励阶段,交替推进。

---

## 七、OPSD:没有教师的蒸馏

2026 年 1 月,UCLA + Meta 的 **OPSD**(On-Policy Self-Distillation,Zhao et al.,[arXiv:2601.18734](https://arxiv.org/abs/2601.18734),ICML 2026)把 OPD 往前推了一大步:**连外部教师都不要了**。

### 7.1 构造:同一模型的两种条件化

核心直觉:一个足够强的模型,在看到正确答案后能"合理化"(rationalize)它——评估和复现比从头生成容易得多。于是让同一个模型 $p_\theta$ 扮演两个角色:

$$p_S(\cdot \mid x) \triangleq p_\theta(\cdot \mid x), \qquad p_T(\cdot \mid x, y^\star) \triangleq p_\theta(\cdot \mid x, y^\star)$$

学生只看问题;教师额外条件于**特权信息** $y^\star$(数据集中已验证的参考解答)。教师不生成任何 token——把"参考解答 + 请用自己的方式再解一遍"的 prompt prefill 进去,一次前向就给出每个位置的 next-token 分布。训练目标仍是在学生自己的 rollout 上最小化逐 token 散度:

$$\mathcal{L}_{\mathrm{OPSD}}(\theta) = \mathbb{E}_{(x, y^\star) \sim \mathcal{S}}\; \mathbb{E}_{\hat{y} \sim p_S(\cdot \mid x)} \sum_{n=1}^{|\hat{y}|} D\Big( p_T(\cdot \mid x, y^\star, \hat{y}_{<n}) \,\Big\|\, p_S(\cdot \mid x, \hat{y}_{<n}) \Big)$$

三个工程要点:

1. **教师冻结在初始策略**,不随训练更新——作者发现这既稳定训练,又隐式正则、防止偏离初始策略过远;
2. **逐 token 逐词表项 pointwise clipping**:对 f-散度,每个位置 $n$、词表项 $v$ 的贡献 $\ell_{n,v} = p_T(v \mid \cdot)\, f\big(p_S(v \mid \cdot) / p_T(v \mid \cdot)\big)$ 截断到阈值 $\tau$——风格性 token(推理连接词)的散度远大于数学 token,不裁剪会让训练信号被"风格"主导;
3. **Thinking-mode 不对称**:TM-off 学生 + TM-on 教师的组合在数学 token 上产生最大散度,效果最好。

它也有采样 token 的策略梯度变体(与 TML 形式一致):$A_n = \log p_T(\hat{y}_n \mid x, y^\star, \hat{y}_{<n}) - \log p_S(\hat{y}_n \mid x, \hat{y}_{<n})$。与 STaR 的对比最能说明价值:STaR 是序列级二值奖励——答错的样本完全零信号;OPSD 无论对错,每个位置都有稠密信号。

### 7.2 效率:一个数量级的差距

OPSD 每题只采 1 条 rollout、上限 1024 token,100 步收敛;同数据上 GRPO 要 8 条 × 16k token,且 100 步内过半 batch 出现组内奖励标准差为零(advantage 消失,白采)。性能上 OPSD 匹配或超过 GRPO,全面超过 SFT(SFT 反而因参考解答风格简洁、把测试时推理长度压短而掉点)。

### 7.3 三连击:2026 年 5–7 月的批判性文献

OPSD 掀起的自蒸馏热潮,在随后的半年里迎来了三记冷静的重拳——如果你打算用自蒸馏,这三篇必读:

1. **Why Does Self-Distillation (Sometimes) Degrade Reasoning?**(Kim et al., MSR,2026-03,[arXiv:2603.24472](https://arxiv.org/abs/2603.24472)):退化的根源是自蒸馏**抑制了"认识性言语化"**(epistemic verbalization——推理中表达不确定性的行为);教师上下文越丰富,域内提升越快,但 OOD 越差,多模型上性能最大降幅达 40%;
2. **Sampled-Demonstration Self-Distillation Reduces Output Diversity**(Nicolicioiu et al., 2026-06,[arXiv:2606.26091](https://arxiv.org/abs/2606.26091)):理论上证明自蒸馏的最优策略会按"学生 rollout 与上下文中正确 rollout 的**点互信息**"倾斜基分布——放大已有概率差距、把质量集中到主导模式;结果是 pass@1 涨,但 **pass@k 曲线变平、多样性塌缩**,OOD 失败。作为对照,理想的 on-policy RL 在同为正确的 rollout 之间保持概率比;
3. **Thinking Collapse 与 AD-OPSD**(Peng et al., 2026-07,[arXiv:2607.10805](https://arxiv.org/abs/2607.10805)):定义并度量大模型在自蒸馏中的"思考塌缩"——原生中间推理行为(以 epistemic token 密度计)骤降;机制是学生高熵决策分叉处,激进的教师梯度把学生的 epistemic token 压向教师的非 epistemic 目标;修法是把高抑制风险的 token 用不对称散度门控**锚定到冻结基座先验**,平均准确率 +4.1%。

此外还有 *Denser ≠ Better* 的警示:持续后训练中,密集自蒸馏(SDPO 式)比 GRPO **遗忘更多甚至塌缩**——教师投影带来过量参数漂移。"密集监督天然优于稀疏奖励"在 2026 年已被证伪为**有条件成立**。

### 7.4 自蒸馏家族速览

| 工作 | 时间 | 一句话 |
| --- | --- | --- |
| OPSD([2601.18734](https://arxiv.org/abs/2601.18734)) | 2026-01 | 特权信息(参考解答)条件化的自我教师,开山之作 |
| SDFT([2601.19897](https://arxiv.org/abs/2601.19897)) | 2026-01 | demonstration 条件化自我教师,持续学习场景显著减少灾难性遗忘 |
| SDPO([2601.20802](https://arxiv.org/abs/2601.20802)) | 2026-01 | 把富文本反馈(编译报错、judge 评语)当特权信息,蒸馏回策略 |
| OPSDC([2603.05433](https://arxiv.org/abs/2603.05433)) | 2026-03 | 推理压缩:简洁指令当教师,长度 -57~59%,准确率反升 +9~16 |
| RLSD([2604.03128](https://arxiv.org/abs/2604.03128)) | 2026-04 | 自蒸馏定幅度、RLVR 定方向,治信息泄露 |
| TS-OPSD([2606.00755](https://arxiv.org/abs/2606.00755)) | 2026-05 | 自己 logits 的高温版当教师("policy reheater"),治 RL 熵塌缩 |
| GATES | 2026 | 无标签场景,导师多采样一致性过滤监督信号 |

---

## 八、工业实践:2026 年收敛出的范式

原理之外,OPD 在工业界的落地速度罕见。到 2026 年中,头部开源厂商已经收敛到相当一致的范式:**领域专家独立训练 → OPD 合并整合**。一家一段:

- **Qwen3(2025-05)**:最早在技术报告里公开 OPD 数字的大厂。同一 off-policy 蒸馏检查点出发,AIME'24 上 RL 到 67.6%(17,920 GPU 时),OPD 到 74.4%(1,800 GPU 时)——**1/10 的成本,更好的性能**。这组数字后来被 Thinking Machines 独立复现,是 OPD 走向主流的起点;
- **小米 MiMo-V2-Flash / V2.5-Pro(2026-01/04)**:提出**多教师 OPD(MOPD)**——SFT 打底,分领域 RL 训出专家,最后学生在自身 rollout 上同时吸收"多专家的逐 token 分布奖励 + 可验证 outcome 奖励"。309B 总参(15B 激活)达到与 DeepSeek-V3.2 / Kimi-K2 相当的水平;V2.5-Pro(1.02T/42B 激活)验证了可扩展性;
- **GLM-5(2026-02)**:把 OPD 用作**跨阶段蒸馏**——各训练阶段(推理 RL、Agent RL、通用对齐)的最优能力由"各阶段最优教师"在学生当前分布上重新教一遍,核心收益是缓解多阶段训练的灾难性遗忘;
- **DeepSeek-V4(2026-04)**:OPD 走得最远的案例。10 余个 1.6T 领域专家各自完成 SFT + GRPO 后,用**全词表、多教师加权的 reverse KL** 做纯 OPD 整合,直接替换了 V3.2 时代的混合 RL 阶段。设计哲学是**优化与整合分离**:每个能力在隔离训练中推到各自上限,再由 OPD 无干扰地合并。

## 九、局限与开放问题

1. **思维模式兼容性 + 真新能力**:Rethinking OPD(清华,2026-04,[arXiv:2604.13016](https://arxiv.org/abs/2604.13016))给出 OPD 成功的两个必要条件——师生推理模式兼容,且教师真的掌握学生没见过的新能力。弱到强反向蒸馏显示:同家族 1.5B 与 7B 教师从学生视角在分布上**不可区分**——"分数高"不等于"可蒸馏";
2. **能力上限锁定**:标准 OPD 是等权重 KL 约束 RL(§6.2),天花板由教师封死;ExOPD 的 $\lambda>1$ 是目前最干净的破顶方案,但外推幅度与稳定性之间的边界仍缺理论;
3. **多样性塌缩**:mode-seeking 的固有代价在自蒸馏场景被放大(§7.3 三连击);EOPD 的熵感知混合与 AD-OPSD 的先验锚定是两个方向的修补,但"保多样性"与"提正确率"的最优权衡远未解决;
4. **蒸馏缩放律缺失**:给定师生规模与数据量,最优蒸馏预算如何规划?teacher-student gap 多大时 OPD 失效?目前只有零星研究(如 Busbridge et al. 2025 的蒸馏缩放律),没有 OPD 专属的系统定律;
5. **Agent 级与多模态 OPD**:现有验证几乎全在单轮文本推理上;多轮工具调用轨迹上教师如何打分、奖励如何跨步分配,基本空白;
6. **黑盒教师**:GAD(2025-11,[arXiv:2511.10643](https://arxiv.org/abs/2511.10643))用对抗训练从商用 API 教师做 OPD,SODA(2026-04,[arXiv:2604.03873](https://arxiv.org/abs/2604.03873))做了效率改进——这是把 OPD 推向"教师只有 API"现实约束的方向,仍处早期。

## 十、谱系与延伸阅读

**时间线**(只列本文展开过的关键节点):

| 时间 | 工作 | 一句话贡献 |
| --- | --- | --- |
| 2015 | [Hinton KD](https://arxiv.org/abs/1503.02531) | 温度软标签,蒸馏的起点 |
| 2016 | [SeqKD](https://arxiv.org/abs/1606.07947) | 序列级蒸馏 = 教师 beam 上的 SFT |
| 2023-06 | [MiniLLM](https://arxiv.org/abs/2306.08543) | reverse KL + 策略梯度,蒸馏=稠密奖励 RL |
| 2023-06 | [GKD](https://arxiv.org/abs/2306.13649) | "on-policy distillation"定名,散度与数据双插值 |
| 2023-07 | [f-distill](https://arxiv.org/abs/2307.15190) | f-散度系统比较,对称散度占优 |
| 2024-02 | [DistiLLM](https://arxiv.org/abs/2402.03898) | skew KL,梯度有界,提速 2.5–4.3× |
| 2024-10 | [SKD](https://arxiv.org/abs/2410.11325) | 投机采样式交错生成,on/off-policy 自适应 |
| 2025-05 | Qwen3 技术报告 | 首个大规模工业 OPD 数字 |
| 2025-10 | [Thinking Machines 博客](https://thinkingmachines.ai/blog/on-policy-distillation/) | 引爆方向,采样 token reverse KL 配方 |
| 2026-01 | [OPSD](https://arxiv.org/abs/2601.18734) / [SDPO](https://arxiv.org/abs/2601.20802) / [SDFT](https://arxiv.org/abs/2601.19897) | 自蒸馏三连,外部教师开始退场 |
| 2026-02 | [G-OPD](https://arxiv.org/abs/2602.12125) | OPD=等权重 KL 约束 RL;λ>1 超越教师 |
| 2026-03 | [Revisiting OPD](https://arxiv.org/abs/2603.25562) / [EOPD](https://arxiv.org/abs/2603.07079) / [REOPOLD](https://arxiv.org/abs/2603.11137) | 偏差-方差理论、熵感知散度、松弛 OPD |
| 2026-04 | [OPD 综述](https://arxiv.org/abs/2604.00626) / [RLSD](https://arxiv.org/abs/2604.03128) / [Rethinking OPD](https://arxiv.org/abs/2604.13016) / DeepSeek-V4 | 综述定框架;OPD+RL 配方成熟;批判与工业巅峰 |
| 2026-05~07 | [多样性塌缩](https://arxiv.org/abs/2606.26091) / [Thinking Collapse](https://arxiv.org/abs/2607.10805) / [Demystifying OPD](https://arxiv.org/abs/2607.13399) / [TS-OPSD](https://arxiv.org/abs/2606.00755) | 自蒸馏的边界被逐步画清 |

**延伸阅读**:

- 综述:[A Survey of On-Policy Distillation for LLMs](https://arxiv.org/abs/2604.00626)(2026-04,统一 f-散度框架 + 失败模式理论);
- 论文清单:[awesome-on-policy-distillation](https://github.com/chrisliu298/awesome-on-policy-distillation)(持续更新,含工业配方表);
- 动手实现:Thinking Machines 原文配套的 Tinker cookbook(采样 token reverse KL 的最小可跑实现);
- 本站相关精读:[Seed:自进化 OPD 与置信门控](/zh/reading/seed-self-evolving-opd)(OPD + GRPO 组合路线的一次完整工业级实践)。

## 结语

回到开头的坐标系,OPD 的位置其实非常谦逊:它没有发明新的监督,也没有发明新的探索,只是把模仿学习里 DAgger 的老思想——**在学生犯错的地方请教专家**——装进了 LLM 后训练的流水线,然后发现这恰好同时治了 SFT 的 exposure bias 和 RL 的奖励稀疏。

但如果只用一句话带走这篇文章,我们希望是这个更硬的版本:**OPD 是把教师变成奖励函数的 RL**。它的损失有三种等价写法(全词表散度 / 采样 token 优势 / 策略梯度),它的不动点是"学生访问状态上的教师条件分布",它的方向由散度决定(reverse KL 收缩众数,forward KL 覆盖支撑),它的天花板由教师决定(除非 λ 外推或回到 RL),它的 2026 年最新形态连教师都不要了(特权信息条件化的自蒸馏)——而代价,是正在被逐篇论文画清楚的多样性塌缩。

理解这些,再去看各家技术报告里那句轻描淡写的"then we apply on-policy distillation",你会读出完全不同的东西。
