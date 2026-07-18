---
title: "COSTAR"
date: "2025-01-03"
description: "清晰明确的 Prompt 内容和结构化的 Prompt 框架对 LLM 生成更高质量内容具有重要作用，而这次要说的就是结构化框架的问题，CO-STAR框架，其工作方式为："
tags: ["prompt"]
---
参考链接：[https://www.jiqizhixin.com/articles/2024-05-14-4](https://www.jiqizhixin.com/articles/2024-05-14-4)

Learning Prompt Pt.1：[Learning Prompt](/zh/blog/learning-prompt/)

## 使用 CO-STAR 框架来搭建 prompt 的结构

清晰明确的 Prompt 内容和**结构化的 Prompt 框架**对 LLM 生成更高质量内容具有重要作用，而这次要说的就是结构化框架的问题，CO-STAR框架，其工作方式为：

-   (C) 上下文（Context）：提供与任务有关的背景信息。这有助于 LLM 理解正在讨论的具体场景，从而确保其响应是相关的。
-   (O) 目标（Objective）：定义你希望 LLM 执行的任务。明晰目标有助于 LLM 将自己响应重点放在完成具体任务上。
-   (S) 风格（Style）：指定你希望 LLM 使用的写作风格。这可能是一位具体名人的写作风格，也可以是某种职业专家（比如商业分析师或 CEO）的风格。这能引导 LLM 使用符合你需求的方式和词语给出响应。
-   (T) 语气（Tone）：设定响应的态度。这能确保 LLM 的响应符合所需的情感或情绪上下文，比如正式、幽默、善解人意等。
-   (A) 受众（Audience）：确定响应的目标受众。针对具体受众（比如领域专家、初学者、孩童）定制 LLM 的响应，确保其在你所需的上下文中是适当的和可被理解的。
-   (R) 响应（Response）：提供响应的格式。这能确保 LLM 输出你的下游任务所需的格式，比如列表、JSON、专业报告等。对于大多数通过程序化方法将 LLM 响应用于下游任务的 LLM 应用而言，理想的输出格式是 JSON。

### 一个使用该框架的例子

提示词：（提示词也由 LLM 给出）

> 请写一篇关于环保的文章，重点讲述塑料污染问题。

输出：

> ## 塑料污染：我们不能忽视的环境危机
> 
> ### 塑料污染的现状
> 
> 在当今世界，塑料污染已经成为一个不容忽视的全球性环境问题。每年，全球约有800万吨塑料垃圾被倾倒入海洋，对海洋生态系统造成严重破坏。据统计，到2050年，海洋中的塑料数量可能会超过鱼类。
> 
> ### 塑料污染的危害
> 
> 1.  **生态系统破坏**
>     -   海洋生物误食塑料
>     -   塑料微粒进入食物链
>     -   珊瑚礁遭受破坏
> 2.  **人类健康威胁**
>     -   塑料微粒通过食物链进入人体
>     -   塑料分解释放有害物质
>     -   影响饮用水安全
>         
>         ### 解决方案
>         
>         #### 个人层面
>         
> 
> -   减少使用一次性塑料制品
> -   选择可重复使用的购物袋
> -   正确分类回收塑料垃圾
>     
>     #### 社会层面
>     
> -   完善塑料回收体系
> -   推广可降解材料
> -   加强环保教育
>     
>     ### 结语
>     
>     塑料污染问题需要全社会的共同努力。从个人做起，从点滴做起，让我们共同为保护地球家园贡献一份力量。只要每个人都采取行动，我们就能创造一个更清洁、更环保的未来。

提示词（CO\_STAR）：

> Context (上下文)：  
> 全球正面临严重的塑料污染危机，每年约有800万吨塑料进入海洋。
> 
> Objective (目标)：  
> 撰写一篇关于塑料污染的科普文章，提高公众环保意识并提供可行的解决方案。
> 
> Style (风格)：  
> 采用National Geographic杂志的写作风格，专业且平易近人。
> 
> Tone (语气)：  
> 严肃中立，但富有希望感，激发读者采取行动。
> 
> Audience (受众)：  
> 面向25-40岁的城市年轻白领，具有基本环保意识但需要进一步指导。
> 
> Response (响应)：  
> 请以下列格式输出：
> 
> 1.  引言（100字）
> 2.  问题现状（200字）
> 3.  影响分析（200字）
> 4.  解决方案（200字）
> 5.  行动建议（100字）  
>     每部分都需要配有小标题。

输出：

> ## 海洋的无声呐喊：直面塑料污染危机
> 
> ### 引言：我们共同的困境
> 
> 在这个被称为”塑料时代”的21世纪，每一片海洋、每一处沙滩，甚至是最偏远的极地，都能找到塑料的踪迹。这些看似便利的现代产物，正悄然成为地球生态系统的隐形杀手。让我们一起审视这场人类自己制造的环境危机。
> 
> ### 触目惊心的现状
> 
> 根据联合国环境规划署的最新数据，全球每年产生的塑料垃圾高达4亿吨，其中约有800万吨最终流入海洋。这相当于每分钟向海洋倾倒一整车的塑料垃圾。更令人担忧的是，科学家预测到2050年，海洋中的塑料重量可能超过鱼类。在中国，年均塑料使用量已达到惊人的约7000万吨，其中近60%来自包装领域。这些数字背后，是我们过度依赖一次性塑料制品的残酷现实。
> 
> ### 危机四伏：塑料污染的多重打击
> 
> 塑料污染的影响远超我们的想象。首先是生态系统遭受重创：海洋生物误食塑料，导致每年约100万只海鸟和10万只海洋哺乳动物死亡。其次是食物链污染：微塑料已经进入人类的食物系统，平均每周我们会摄入相当于一张信用卡重量的塑料颗粒。更重要的是，塑料分解过程会释放有害化学物质，污染土壤和水源，影响农作物生长，最终危及人类健康。
> 
> ### 破局之道：科技创新与政策引导
> 
> 面对塑料污染，解决方案已现曙光。在科技层面，可降解材料技术取得突破，如PHA类生物降解塑料的商业化应用正在加速。政策方面，多个国家已开始实施塑料限制令，中国也在2021年全面禁止不可降解塑料袋。企业创新同样可圈可点，如使用可重复使用的包装系统、开发环保替代材料等。这些措施共同构建起对抗塑料污染的防线。
> 
> ### 从我做起：改变始于生活细节
> 
> 每个人都可以成为环保先锋。从随身携带可重复使用的购物袋开始，到选择简约包装的商品，再到支持环保品牌，点滴行动都在改变地球的未来。让我们携手行动，为下一代留下一片干净的海洋。

## 使用分隔符为 prompt 设置分节

分隔符是一种特殊 token，可帮助 LLM 分辨 prompt 的哪些部分应被视为单个含义单元。这很重要，因为输入 LLM 的整个 prompt 是单个的 token 长序列。分隔符能将 prompt 中不同部分隔离开，从而为这个 token 序列提供结构，让其中各个部分能被区别对待。

需要说明的是，如果任务很简单，那么分隔符对 LLM 的响应质量的影响不大。但是，任务越复杂，使用分隔符分节对 LLM 响应的影响就越大。

具体在[Learning Prompt](/zh/blog/learning-prompt/)中也有提到过，在此不再赘述，不过我感觉 XML 标签还是挺好用的，而且对于写提示词的人来说也比较容易看和理解。

## 仅使用 LLM 进行数据分析

LLM 执行准确数学计算的能力有限，这使得它们不适合需要对数据集进行精确定量分析的任务，如：（为 LLM 添加计算 / 编程工具或许可以改善这一情况）

-   描述性统计数值计算：以定量方式总结数值列，使用的度量包括均值或方差。
-   相关性分析：获得列之间的精确相关系数。
-   统计分析：比如假设测试，可以确定不同数据点分组之间是否存在统计学上的显著差异。
-   机器学习：在数据集上执行预测性建模，可以使用的方法包括线性回归、梯度提升树或神经网络。

而 LLM 擅长识别模式和趋势。这种能力源自 LLM 训练时使用的大量多样化数据，这让它们可以识别出可能并不显而易见的复杂模式。

这让他们非常适合处理基于**模式发现**的任务，比如：

-   异常检测：基于一列或多列数值识别偏离正常模式的异常数据点。
-   聚类：基于列之间的相似特征对数据点进行分组。
-   跨列关系：识别列之间的综合趋势。
-   文本分析（针对基于文本的列）： 基于主题或情绪执行分类。
-   趋势分析（针对具有时间属性的数据集）：识别列之中随时间演进的模式、季节变化或趋势

> **Example Task**：假设你在该公司的宣传团队工作，你的任务是使用这个客户信息数据集来指导营销工作。
> 
> 这个任务分为两步：
> 
> 第一步，使用数据集生成有意义的细分客户群；
> 
> 第二步，针对每个细分群生成最好的营销策略。
> 
> 现在，这个问题就成了模式发现（第一步）的实际业务问题，这也正是 LLM 擅长的能力。

一个用于数据分析的提示词示例：（经翻译）

以下 prompt 用到了 4 种提示工程技术：

1.  将复杂任务分解为简单步骤（Just step-by-step, which is CoT like, and with fixed instructions, more details in [Learning Prompt](/zh/blog/learning-prompt/)）
2.  索引每一步的中间输出（`CLUSTERS、CLUSTER_INFORMATION、CLUSTER_NAME...` in `# OBJECTIVE #`）
3.  设置 LLM 的响应的格式（In `# RESPONSE: MARKDOWN REPORT #`）
4.  将指令与数据集分离开（In `# START ANALYSIS #`）

```markdown
系统提示：
我希望你作为一名数据科学家来分析数据集。不要编造数据集中没有的信息。对于我要求的每个分析，请提供准确和明确的答案，不要提供代码或在其他平台上进行分析的说明。

提示：
# 背景 #
我销售葡萄酒。我有一个包含客户信息的数据集：[出生年份、婚姻状况、收入、子女数量、距离上次购买的天数、消费金额]。
#############
# 目标 #
我想要你使用数据集将我的客户分类成不同群组，然后给我建议如何针对每个群组开展营销活动。请按照以下步骤进行分析（无需使用代码）：
1. 聚类：使用数据集的列来对数据集的行进行聚类，使得同一群组内的客户具有相似的列值，而不同群组的客户具有明显不同的列值。确保每一行只属于1个群组。
对于每个发现的群组：
2. 群组信息：用数据集的列来描述该群组。
3. 群组名称：根据[群组信息]为该客户群组取一个简短的名称。
4. 营销建议：为该客户群组生成营销产品的想法。
5. 理由：解释为什么[营销建议]对该客户群组来说是相关且有效的。
#############
# 风格 #
商业分析报告
#############
# 语气 #
专业、技术性
#############
# 受众 #
我的商业伙伴。说服他们你的营销策略是经过深思熟虑的，并且完全有数据支持。
#############
# 响应：MARKDOWN报告 #
<对于[聚类]中的每个群组>
— 客户群组：[群组名称]
— 档案：[群组信息]
— 营销建议：[营销建议]
— 理由：[理由]
<附件>
提供一个表格，列出属于每个群组的行号，以支持你的分析。使用这些表格标题：[[群组名称]，行号列表]。
#############
# 开始分析 #
如果你理解了，请向我索要数据集。
```

英文原版：  

```markdown
System Prompt:
I want you to act as a data scientist to analyze datasets. Do not make up information that is not in the dataset. For each analysis I ask for, provide me with the exact and definitive answer and do not provide me with code or instructions to do the analysis on other platforms.
Prompt:
# CONTEXT #
I sell wine. I have a dataset of information on my customers: [year of birth, marital status, income, number of children, days since last purchase, amount spent].
#############
# OBJECTIVE #
I want you use the dataset to cluster my customers into groups and then give me ideas on how to target my marketing efforts towards each group. Use this step-by-step process and do not use code:
1. CLUSTERS: Use the columns of the dataset to cluster the rows of the dataset, such that customers within the same cluster have similar column values while customers in different clusters have distinctly different column values. Ensure that each row only belongs to 1 cluster.
For each cluster found,
2. CLUSTER_INFORMATION: Describe the cluster in terms of the dataset columns.
3. CLUSTER_NAME: Interpret [CLUSTER_INFORMATION] to obtain a short name for the customer group in this cluster.
4. MARKETING_IDEAS: Generate ideas to market my product to this customer group.
5. RATIONALE: Explain why [MARKETING_IDEAS] is relevant and effective for this customer group.
#############
# STYLE #
Business analytics report
#############
# TONE #
Professional, technical
#############
# AUDIENCE #
My business partners. Convince them that your marketing strategy is well thought-out and fully backed by data.
#############
# RESPONSE: MARKDOWN REPORT #
<For each cluster in [CLUSTERS]>
— Customer Group: [CLUSTER_NAME]
— Profile: [CLUSTER_INFORMATION]
— Marketing Ideas: [MARKETING_IDEAS]
— Rationale: [RATIONALE]
<Annex>
Give a table of the list of row numbers belonging to each cluster, in order to back up your analysis. Use these table headers: [[CLUSTER_NAME], List of Rows].
#############
# START ANALYSIS #
If you understand, ask me for my dataset.
```
