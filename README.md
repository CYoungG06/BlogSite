# 相对性阿卡内 · Relativity Acane

个人博客的源码与内容:LLM、后训练与 Agent 方向的文章、论文精读,以及每天自动更新的论文速递。

**线上地址**:<https://cyoungg06.github.io/BlogSite/>

A bilingual (zh/en) static blog about LLMs, post-training and agents, with a daily
auto-generated paper digest. Built with Next.js static export and deployed to GitHub Pages.

## 站点内容

| 栏目 | 路径 | 说明 |
|---|---|---|
| 文章 / 笔记 | `/blog/` `/notes/` | 原创长文与短笔记 |
| 蒸馏 | `/distilled/` | 转载翻译 |
| 精读 | `/reading/` | 论文精读 |
| 论文速递 | `/papers/` | 每日 arXiv 新论文 + Hugging Face 热门,附 AI 中文导读与兴趣评分;另有深度解读 |
| 研究 / 项目 | `/research/` `/projects/` | |
| 其他 | `/about/` `/friends/` `/music/` `/search/` | |

站内还有一个 AI 助手(右下角),可以检索文章与速递、读论文全文。

## 论文速递的开放接口

速递数据是匿名只读的静态文件,字段只增不删:

- 归档索引:<https://cyoungg06.github.io/BlogSite/api/papers/index.json>
- 单日速递:`https://cyoungg06.github.io/BlogSite/api/papers/YYYY-MM-DD.json`
- RSS:<https://cyoungg06.github.io/BlogSite/feed.xml>
- 给 AI agent 用的 skill:<https://cyoungg06.github.io/BlogSite/papers-skill/SKILL.md>
- 主动检索 arXiv / Hugging Face 的 skill 源码:[`skills/paper-discovery/`](skills/paper-discovery/)

## 本地开发

需要 Node.js ≥ 22。

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # 静态导出到 ./out
npm run preview    # 本地预览 ./out
npm run lint && npm run typecheck
```

写新文章:`npm run new-post -- my-slug --title "标题"`。环境变量全部可选,模板见 [`.env.example`](.env.example)。

## 技术栈

Next.js 16(App Router,`output: 'export'`)· React 19 · TypeScript · Tailwind CSS v4 ·
MDX(`next-mdx-remote`)· `next-intl` · MiniSearch · Shiki · KaTeX。

## 自动化

- **部署**:push 到 `main` 后由 GitHub Actions 构建并发布到 GitHub Pages。
- **论文速递**:GitHub Actions 每天定时抓取 arXiv 与 Hugging Face,调用 DeepSeek 生成中文导读和评分,
  提交到 `content/papers/` 并触发部署。`main` 上每天都有 bot 提交,本地动手前先 `git pull`。
- **AI 助手与访客统计**:一个独立的 Cloudflare Worker([`worker/agent-proxy/`](worker/agent-proxy/)),需要单独部署。

## 文档

- [`DEVELOPMENT.md`](DEVELOPMENT.md) — 维护手册:环境、日常工作流、仓库结构、故障排查
- [`DESIGN.md`](DESIGN.md) — 设计系统与架构决策
- [`DEPLOY-GH-PAGES.md`](DEPLOY-GH-PAGES.md) — GitHub Pages 部署步骤
- [`worker/agent-proxy/README.md`](worker/agent-proxy/README.md) — Worker 的接口、预算与部署
