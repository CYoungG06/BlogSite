/**
 * AI 助手的工具 schema(OpenAI tools 格式)。
 * 纯数据、零依赖:浏览器端执行器(./tools.ts)与 Worker 代理
 * (worker/agent-proxy/src/index.js)共用同一份 —— 工具定义由服务端注入上游请求,
 * 客户端不再上传 tools,避免代理被当成通用 function-calling 中继。
 */

export const ARTICLE_TYPES = ["post", "note", "distilled", "reading", "insight", "research"] as const;

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_site_map",
      description:
        "获取站点地图:博客有哪些栏目、每篇文章的标题/简介/路径、以及研究/关于/音乐等页面摘要。需要了解站点结构或找文章时先调它。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_site",
      description:
        "全站全文检索(博客文章、笔记、蒸馏、精读)。按内容关键词找文章时用,返回标题、简介与路径。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索关键词,中英均可" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_article",
      description:
        "读取指定文章的完整正文(纯文本)。type 与 slug 来自 get_site_map 或 search_site 的结果。",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["post", "note", "distilled", "reading", "insight", "research"],
          },
          slug: { type: "string" },
        },
        required: ["type", "slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_digests",
      description:
        "列出论文速递的日期索引:哪些天有速递、每天多少篇、最新一期是哪天。查论文前先调它确定日期。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_digest",
      description:
        "读取某一天的论文速递(Hugging Face 热门 + arXiv 新论文),含 AI 评分、中文导读、深度解读标记与链接。已过滤低相关论文。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          source: {
            type: "string",
            enum: ["hf", "arxiv"],
            description: "可选,只看某一来源",
          },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_papers",
      description:
        "跨天检索论文速递:按关键词在全部历史速递(HF 热门 + arXiv)的标题/中文导读里检索,返回命中论文的日期、评分、导读与链接。回答「最近有哪些关于 X 的论文」「这周 RL 方向有什么新工作」这类跨天问题时用它,不要逐天 read_digest。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "检索关键词,空格分隔多个词时取交集(AND),中英均可,如「强化学习 RL」",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_articles",
      description:
        "一次读取 2-3 篇站内文章的正文用于对比。用户要求比较多篇文章(如「Seed 和 Frontis-MA1 的自进化思路有何异同」)时用,比多次 read_article 更省。",
      parameters: {
        type: "object",
        properties: {
          articles: {
            type: "array",
            description: "2-3 篇要对比的文章",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: [...ARTICLE_TYPES] },
                slug: { type: "string" },
              },
              required: ["type", "slug"],
            },
            minItems: 2,
            maxItems: 3,
          },
        },
        required: ["articles"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_paper",
      description:
        "读取 arXiv 论文全文的一段(纯文本)。默认从头返回 1.6 万字符;用 offset+limit 分页读后续段落。长论文推荐先用 search_in_paper 定位关键词位置,再按 offset 精读那一段。全文在浏览器端缓存,多次调用不重复下载。",
      parameters: {
        type: "object",
        properties: {
          arxiv_id: {
            type: "string",
            description: "arXiv id,形如 2607.28568(不带 abs/ 前缀)",
          },
          offset: {
            type: "number",
            description: "起始字符偏移,默认 0;接 search_in_paper 返回的 offset 或上一段的末尾",
          },
          limit: {
            type: "number",
            description: "本段长度,默认 16000,上限 16000",
          },
        },
        required: ["arxiv_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_in_paper",
      description:
        "在 arXiv 论文全文里检索关键词,返回命中处的上下文片段与字符偏移。读长论文的特定内容(某个公式、算法步骤、实验表格、消融)时先调它定位,再用 read_paper 带 offset 精读。",
      parameters: {
        type: "object",
        properties: {
          arxiv_id: { type: "string", description: "arXiv id,形如 2607.28568" },
          query: {
            type: "string",
            description: "定位关键词,空格分隔(英文术语命中率更高),如「KL divergence」「ablation」",
          },
        },
        required: ["arxiv_id", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_external_papers",
      description:
        "检索外部论文库(Semantic Scholar,覆盖全部 arXiv 与经典文献,带引用数与 TLDR)。站内速递只覆盖近期,问经典工作、源头论文、横向相关工作时用它;命中结果含 arXiv id,可用 read_paper / search_in_paper 继续深读。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "英文检索词,如「on-policy distillation language model」",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate",
      description:
        "向用户展示一个站内跳转卡片(用户点击后跳转)。当用户明确想找某个页面/栏目时使用,path 必须是站内路径。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "站内路径,如 /papers/、/music/、/blog/lora/",
          },
          label: { type: "string", description: "卡片上显示的名称" },
        },
        required: ["path", "label"],
      },
    },
  },
] as const;

export type AgentToolName =
  | "get_site_map"
  | "search_site"
  | "read_article"
  | "list_digests"
  | "read_digest"
  | "search_papers"
  | "compare_articles"
  | "read_paper"
  | "search_in_paper"
  | "search_external_papers"
  | "navigate";
