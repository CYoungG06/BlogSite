# blogsite-agent-proxy

博客 AI 助手(右下角悬浮窗)的 DeepSeek 代理:藏 API key、CORS 白名单、按 IP 限流、费用兜底。  
助手的工具数据全是站内公开静态 JSON,浏览器直接 fetch;Worker 只负责组装并转发对话请求。

## 部署(约 5 分钟)

```bash
npm i -g wrangler          # 或全程用 npx wrangler
wrangler login             # 浏览器授权 Cloudflare 账号(免费计划即可)

cd worker/agent-proxy
npx wrangler secret put DEEPSEEK_API_KEY   # 粘贴 .env 里那把 key
npx wrangler deploy
```

部署成功后会得到 `https://blogsite-agent-proxy.<账号>.workers.dev`。

> **什么时候要重新 deploy**:Worker 打包时会 import 仓库里的 `lib/agent/system.ts`  
> (系统提示词)和 `lib/agent/tool-schemas.ts`(工具定义)。改了这两个文件、  
> `src/index.js` 或 `wrangler.toml` 之后,都要在本目录重新 `npx wrangler deploy`,  
> 站点的 GitHub Pages 部署不会带上它们。
>
> **发布顺序**:协议有变动时先 deploy Worker、再发站点。Worker 兼容旧版前端  
> (见 `legacyHints`),反过来旧 Worker 不认识新前端的字段。

## 接入站点

把上面的 URL 配给站点构建:

- 本地:`.env.local` 加 `NEXT_PUBLIC_AGENT_API=https://blogsite-agent-proxy.<账号>.workers.dev`
- GitHub Pages:在仓库 Settings → Secrets and variables → Actions → **Variables** 加同名变量,  
  构建工作流会注入(不配则助手组件不渲染,不影响其余功能)。

## 论文速递的准点触发

GitHub Actions 自带的 `schedule` 实测会晚 7–8 小时,所以 Worker 带两个 Cron Trigger  
(`wrangler.toml` 的 `[triggers]`,UTC 02:12 / 10:05,即北京时间 10:12 / 18:05),到点调用  
`daily-papers.yml` 的 `workflow_dispatch`,分别传 `mode=hf`(早班)和 `mode=full`(午班)。  
GitHub 侧的 `schedule` 保留为兜底。

一次性配置:

1. GitHub → Settings → Developer settings → Fine-grained tokens → 新建:  
   Repository access 只选本仓库;Repository permissions → **Actions: Read and write**。
2. `npx wrangler secret put GITHUB_DISPATCH_TOKEN`,粘贴 token。
3. `npx wrangler deploy`。

没配 token 时触发器什么都不做(兜底照常,只是不准点)。token 过期或被吊销后,  
这次 cron 会在 Cloudflare 后台记为失败;仓库侧的兜底运行发现「前 7 天有过外部触发、今天没有」  
时也会开一个标题以「Daily Papers 外部定时触发失效」开头的 Issue。

## 对话接口

`POST /`,body 为 JSON:

| 字段            | 说明                                          |
| ------------- | ------------------------------------------- |
| `kind`        | `"chat"`(站点助手)或 `"suggest"`(追问建议,无工具)       |
| `locale`      | `"zh"` / `"en"`,决定系统提示词语言                   |
| `currentPath` | 可选,用户当前页面路径;只接受普通 URL 路径字符,否则忽略             |
| `deep`        | 可选,深度调研模式(更长的输出上限 + 调研者提示词)                 |
| `tools`       | 可选,`false` = 本轮不给工具                         |
| `messages`    | 对话消息,只允许 `user` / `assistant` / `tool` 三种角色 |
| `max_tokens`  | 上限随模式封顶:建议 512、普通 4096、深度 8192              |

系统提示词、工具 schema、model、stream 都由 Worker 决定,客户端传什么都不会被采用;  
`system` 角色的消息会被丢弃。响应是上游 SSE 流原样透传。

## 说明

- **费用兜底**(由外到内):
  1. 按 IP 限流(见下)。
  2. 请求校验:消息逐字段白名单,单条 ≤ 8 万字符、单次合计 ≤ 40 万字符、最多 64 条;  
     `tool_calls` 只接受已定义的工具名。
  3. 全站每日预算:请求数与输入字符数两个计数器(`wrangler.toml` 的 `[vars]`),  
     存 D1 `kv` 表的 `budget:requests:<日期>` / `budget:chars:<日期>`;  
     任一用尽当天返回 429,UTC 零点恢复。D1 不可用时拒绝请求而不是放行。
  4. 仍建议在 DeepSeek 控制台给这把 key 设消费上限,作为最后一道。
  `Origin` 白名单只是 CORS 手段 —— 浏览器之外可以随意伪造,不要把它当鉴权。
- **限流**:`wrangler.toml` 里 `[[ratelimits]]`,每 IP 40 次/分钟(深度调研单轮就要 ~18 次);改 `limit`/`period` 后重新 deploy 即可。
- **CORS**:只放行 `https://cyoungg06.github.io` 与本地开发端口,源码 `ALLOWED_ORIGINS` 里维护。
- **论文全文代理**:`GET /paper?arxiv=<id>` 返回 `{ source, text }` —— 主源 alphaXiv 全文  
  markdown,404 回退 arXiv HTML(HTMLRewriter 抽正文);id 有格式白名单,边缘缓存 1h。  
  前端 `read_paper` 工具走这里。
- **外部论文检索**:`GET /search-papers?query=...&limit=8` —— Semantic Scholar 主源(带引用数/TLDR),429 回退 arXiv API。
- **访客统计**(D1 数据库 `blogsite-stats`):
  - `POST /pv` —— 前端 beacon 打点(text/plain body `{vid, path}` 免预检);爬虫 UA 过滤,  
    vid/path 格式白名单;PV 累加到 kv 表,访客按匿名 vid 记一行。
  - `GET /stats` —— 返回 `{ pv, uv }`,响应缓存 60s,页脚 SiteStats 组件用。
  - schema 变更:`npx wrangler d1 migrations apply blogsite-stats --remote`(本地自测换 `--local`)。
- **密钥**:只存在于 Cloudflare secrets,不进本仓库。
