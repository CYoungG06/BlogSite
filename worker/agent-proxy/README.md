# blogsite-agent-proxy

博客 AI 助手(右下角悬浮窗)的 DeepSeek 代理:藏 API key、CORS 白名单、按 IP 限流。
纯转发,无业务逻辑 —— 助手的工具数据全是站内公开静态 JSON,浏览器直接 fetch。

## 部署(约 5 分钟)

```bash
npm i -g wrangler          # 或全程用 npx wrangler
wrangler login             # 浏览器授权 Cloudflare 账号(免费计划即可)

cd worker/agent-proxy
npx wrangler secret put DEEPSEEK_API_KEY   # 粘贴 .env 里那把 key
npx wrangler deploy
```

部署成功后会得到 `https://blogsite-agent-proxy.<账号>.workers.dev`。

## 接入站点

把上面的 URL 配给站点构建:

- 本地:`.env.local` 加 `NEXT_PUBLIC_AGENT_API=https://blogsite-agent-proxy.<账号>.workers.dev`
- GitHub Pages:在仓库 Settings → Secrets and variables → Actions → **Variables** 加同名变量,
  构建工作流会注入(不配则助手组件不渲染,不影响其余功能)。

## 说明

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
- **费用兜底**:限流 + 前端单轮最多 5 次工具循环 + max_tokens ≤ 4096。
- **密钥**:只存在于 Cloudflare secrets,不进本仓库。
