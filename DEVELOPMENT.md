# 维护手册

本文档覆盖在新机器上接续维护博客需要的全部步骤,以及日常工作流。
配合 `DESIGN.md`(设计系统与架构)和 `DEPLOY-GH-PAGES.md`(GitHub Pages 部署)阅读。

---

## 1. 新机器一次性环境配置

### 1.1 需要的工具

| 工具 | 版本要求 | 备注 |
|---|---|---|
| Node.js | ≥ 22(推荐 22 LTS 或 25) | 项目用了 Node ≥ 22 原生 TypeScript 支持(`.mjs` 直接 import `.ts`)|
| npm | ≥ 10 | 跟 Node 一起来 |
| git | ≥ 2.30 | |

macOS 装 Node 推荐:
```bash
brew install node            # 或 nvm install --lts && nvm use --lts
node -v && npm -v
```

### 1.2 克隆仓库并装依赖

```bash
git clone git@github.com:<your-handle>/BlogSite.git
cd BlogSite

# 配置仓库级 git 身份(可选,但建议)— 决定 commit author
git config user.name  "Your Name"
git config user.email "your-github-email@example.com"

npm install
```

### 1.3 ⚠️ npm registry 安全网

仓库根目录有 `.npmrc`:

```
registry=https://registry.npmjs.org/
```

**这是为了避免在不同公司机器上误把内部 mirror URL 写到 `package-lock.json`、
然后泄露到公开 GitHub。** 它的优先级 > 你的全局 `~/.npmrc` 设置。

**不要删除这个文件,也不要在仓库内 `npm config set registry ...` 覆盖它。**

如果你**就是**想用某个内部 mirror(比如新公司的私有 npm),可以临时:
```bash
npm install --registry=https://your-internal-mirror.example.com
```
但**别 commit 重生的 lock 文件**到这个公开 repo;先用公共 registry 重生一次再 commit。

### 1.4 验证装好了

```bash
npm run dev
# 打开 http://localhost:3000 (根路径按浏览器语言跳到 /zh/ 或 /en/)
```

---

## 2. 日常工作流

### 2.1 写新文章

**最简方式 — 脚手架命令**:
```bash
npm run new-post -- my-slug --title "我的标题" --tags 随笔,日常
# 生成 content/blog/zh/my-slug.md,frontmatter 预填好
```

完整参数:
```bash
npm run new-post -- <slug> [--title=...] [--locale=zh|en] [--tags=a,b,c] [--description=...] [--draft]
```

写好后:
```bash
npm run dev
# 文章自动出现在 /blog 列表
```

**手动方式**:复制模板:
```bash
cp content/blog/_template.md.example content/blog/zh/my-slug.md
# 编辑 frontmatter 与正文
```

### 2.2 写英文版

同名 slug 不同 locale:
```bash
content/blog/zh/my-slug.md     # 中文版
content/blog/en/my-slug.md     # 英文版(可选)
```

文章详情页会自动检测两种语言是否都存在;有则显示 `中 / EN` 切换徽章,
只有中文则英文站访问时显示「暂无英文版」横幅 + 中文内容。

### 2.3 笔记 / 项目 / 友链 / About

- **笔记** `content/notes/{zh,en}/*.mdx` — 同 Blog 写法但更轻量(标签可省、preview 自动从首段截取)
- **项目** `content/projects/*.mdx` — **不分 locale**,frontmatter 里写 `title: { zh: ..., en: ... }`;`hasDetail: true` 才生成详情页
- **友链** `content/friends.json` — JSON 数组,字段 `name / url / description? / avatar?`
- **About** `content/about/{zh,en}.mdx` — 单文件,frontmatter 可选 `title` / `description` 覆盖 i18n 默认文案

### 2.4 添加 / 修改 UI 文案

中英文界面文案在 `messages/zh.json` 和 `messages/en.json`,同步加同 key 就行。

### 2.5 切换深色模式 / 语言

页面右上角有按钮。深色三态:浅色 → 深色 → 跟随系统。

### 2.6 全文搜索

- 索引在 build 时自动生成到 `public/search-index/{locale}.json`(已加 `.gitignore`)
- 覆盖 blog / notes / distilled / reading 四个集合;改了文章后,`npm run dev` 会重新生成索引
- 也可以单独跑:`npm run search:index`
- 搜索逻辑:中文 bigram + 英文按词,见 `lib/search/tokenize.ts`

### 2.7 build & 预览生产构建

```bash
npm run build           # 先跑一串生成脚本,再 next build 静态导出到 ./out
npm run preview         # npx serve out -l 3000,本地看生产产物
```

`build`(和 `dev`)前置的生成脚本,产物全部在 `public/` 下且**已被 `.gitignore` 忽略,不要提交**:

| 脚本 | 产物 | 用途 |
|---|---|---|
| `search:index` | `public/search-index/` | 站内搜索索引 |
| `feed` | `public/feed.xml` | 论文速递 RSS |
| `api` | `public/api/papers/` | 论文速递静态 JSON API(含 AI 助手用的 `all.json`) |
| `agent:api` | `public/api/agent/` | AI 助手读取的站点地图与文章正文 |
| `export:files`(仅 build) | `public/export/` | 文章与速递的 Markdown 导出 |

### 2.8 typecheck / lint

```bash
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
```

提交前建议都跑一遍。PR 会由 `.github/workflows/ci.yml` 自动跑 lint / typecheck / 抓取脚本测试 / build。

### 2.9 论文速递(自动,一般不用管)

`.github/workflows/daily-papers.yml` 每天定时跑两班:早班只抓 Hugging Face 热门,午班补 arXiv
并回查最近 14 天缺失或未完成的速递。流程是 `scripts/fetch-daily-papers.py` 抓取 →
`scripts/summarize-digest.py` 调 DeepSeek 生成中文导读与兴趣评分 → bot 提交 `content/papers/` →
触发部署。所以 **`main` 上每天都有 bot 提交,本地动手前先 `git pull`**。

- 评分依据是 `scripts/interest-profile.md`(兴趣画像),误判的方向直接改这个文件。
- 需要仓库 Secret `DEEPSEEK_API_KEY`;没配时只是没有中文导读,不影响发布。
- 失败会开(或追加评论到)一个标题以「Daily Papers 失败」开头的 Issue,恢复后自动关闭。
- 手动补某一天:Actions → **Daily Papers** → Run workflow,填日期;或本地
  `python3 scripts/fetch-daily-papers.py --date 2026-07-20 && python3 scripts/summarize-digest.py 2026-07-20`。
- 抓取脚本的测试:`python3 -B -m unittest discover -s scripts -p 'test_fetch_daily_papers.py'`。

### 2.10 AI 助手与访客统计(Cloudflare Worker)

右下角助手和页脚 PV/UV 走 `worker/agent-proxy/` 这个 Worker,**它不随站点部署,需要单独
`npx wrangler deploy`**。系统提示词(`lib/agent/system.ts`)和工具定义(`lib/agent/tool-schemas.ts`)
是打进 Worker 的,改了它们要重新部署 Worker。接口、预算与发布顺序见 `worker/agent-proxy/README.md`。

---

## 3. 分支模型

只有一个长期分支 `main`:纯静态导出(`output: 'export'`、`localePrefix: always`、无 middleware),
push 即由 GitHub Actions 构建并发布到 GitHub Pages。早期的「`main` 走 Vercel + `gh-pages` 走静态导出」
双分支模型已经废弃,不存在 `gh-pages` 分支,也不需要任何 cherry-pick 同步。

- 人工改动:直接在 `main` 上提交,或开分支走 PR(PR 会跑 CI)。
- 自动改动:`github-actions[bot]` 每天向 `main` 提交 `content/papers/`(见 §2.9)。

**绝对不要做的事**:
- ❌ 修改 `.npmrc` 把 registry 换成内部 mirror 然后提交
- ❌ 把 `.env` / `.env.local` 提交(`.gitignore` 已挡住,但 `git add -f` 仍能突破)
- ❌ 提交 `public/` 下的构建产物(search-index / feed.xml / api / export,见 §2.7)

---

## 4. 部署

| 部署对象 | 触发方式 | 文档 |
|---|---|---|
| 站点(GitHub Pages) | push 到 `main`、Daily Papers 有新内容时、手动 Run workflow | `DEPLOY-GH-PAGES.md` |
| AI 助手代理 + 访客统计(Cloudflare Worker) | 手动 `npx wrangler deploy` | `worker/agent-proxy/README.md` |

站点部署失败会自动重试一次,仍失败则开一个标题以「Deploy 失败」开头的 Issue,下次成功后自动关闭。

---

## 5. 故障排查

### 5.1 `npm install` 报内部 mirror 401/timeout

你在公司网络下,默认 npm registry 是公司内部 mirror,公共 registry 不通。
**短期**:开个人热点或 VPN 装一次。
**长期**:看 [§1.3](#13-️-npm-registry-安全网),临时 `--registry` 解决。

### 5.2 dev 起来后 /search 找不到任何结果

索引可能没生成。检查:
```bash
ls public/search-index/        # 应该有 zh.json 和 en.json
npm run search:index           # 单独重生
```

dev 模式下改 MDX 文件**不会**自动重建索引,需要重启 dev。

### 5.3 build 失败 `Cannot find module 'X'`

```bash
rm -rf node_modules .next package-lock.json
npm install
```
注意 — 重新生成 lock 之后**检查没有公司 mirror URL**:
```bash
grep -c "your-company-mirror" package-lock.json   # 应为 0
```

### 5.4 改了 frontmatter 后页面报 `缺少 frontmatter.title/date`

YAML 的 `date: 2026-05-22`(不带引号)会被解析成 Date 对象。
代码已经做了规整(`lib/content-loader.ts` 的 `normalizeDate`),
但若你的 frontmatter 字段名拼错(如 `tilte` / `dtae`),就会报 missing。
对照 `content/blog/_template.md.example`。

### 5.5 Giscus 评论框不显示

环境变量没配齐 — `NEXT_PUBLIC_GISCUS_REPO` / `REPO_ID` / `CATEGORY` / `CATEGORY_ID` 四个都得有。
缺任意一个会显示「未配置」占位。

### 5.6 我推到 GitHub 后,commit author 显示 Anonymous / 不在我 profile

GitHub 用 commit email 跟账号匹配。你的 git 身份(`git config user.email`)
要是 GitHub 注册账号下登记过的邮箱才会关联。

修复:
```bash
git config user.email "your-github-email@example.com"
git commit --amend --reset-author --no-edit         # 改最近一个 commit 的 author
# 或对所有未推送 commit 做 rebase --reset-author
```

---

## 6. 仓库结构索引

```
BlogSite/
├── README.md
├── DEVELOPMENT.md           # 本文档 — 维护手册
├── DESIGN.md                # 设计规格文档(设计系统 + 复刻指南)
├── DEPLOY-GH-PAGES.md       # GitHub Pages 部署说明
├── .npmrc                   # ⚠️ 锁公共 registry
├── .env.example             # 环境变量模板(复制为 .env.local)
├── .github/
│   ├── workflows/           # deploy.yml / daily-papers.yml / ci.yml
│   └── dependabot.yml       # 每月一次的依赖升级 PR
│
├── app/
│   ├── (root)/              # 根路径重定向(独立最小 root layout)
│   ├── not-found.tsx        # 全站 404(自带 <html>/<body>)
│   └── [locale]/            # 多语言路由
│       ├── layout.tsx / page.tsx        # 全站壳 / 首页
│       ├── blog/ notes/ distilled/ reading/   # 列表 + [slug] 详情
│       ├── papers/          # 速递归档 + [date] 单日 + insights/[id] 深度解读
│       ├── research/ projects/          # 列表 + [slug] 详情
│       └── about/ friends/ music/ search/
│
├── components/
│   ├── layout/              # Header / HeaderBar / NavLinks / MobileNav / Footer / Container / PageHeader
│   ├── agent/               # AI 助手:悬浮窗、对话渲染、划词提问、每日简报
│   ├── papers/              # PaperCard / DigestToc
│   ├── blog/ notes/ projects/           # 各集合的卡片
│   ├── mdx/                 # BlogImage / MDXComponents / MDXContent / CodeBlock / Lightbox / TableOfContents
│   ├── search/              # use-search hook / HeaderSearch / SearchClient
│   └── ArticleDetail / CiteBlock / ExportButtons / SiteStats / PvBeacon / Analytics / Giscus / Theme* ...
│
├── lib/
│   ├── content-loader.ts / collection.ts   # MDX 扫描解析;locale 回退、草稿过滤
│   ├── posts.ts / notes.ts / distilled.ts / reading.ts / projects.ts / research.ts
│   ├── papers.ts / insights.ts          # 论文速递与深度解读数据层
│   ├── agent/               # chat.ts(对话循环)/ tools.ts(工具执行)/ tool-schemas.ts / system.ts(后两者被 Worker 引用)
│   ├── analytics/pv.ts      # PV 打点
│   ├── mdx.ts / markdown.ts / images.ts / format.ts
│   └── search/              # tokenize.ts(中英混合分词)/ load-index.ts
│
├── i18n/                    # routing.ts / request.ts / navigation.ts
├── messages/                # i18n 文案 — zh.json / en.json(key 严格对齐)
│
├── content/                 # 所有内容
│   ├── blog/ notes/ distilled/ reading/   # {zh,en}/*.md(x)
│   ├── papers/*.json        # 每日速递(bot 生成)
│   ├── insights/*.md        # 论文深度解读,文件名 = arXiv id
│   ├── projects/*.mdx  research/  about/{zh,en}.mdx
│   └── friends.json  music.json
│
├── scripts/
│   ├── new-post.mjs         # npm run new-post
│   ├── build-search-index.mjs / generate-feed.mjs / generate-papers-api.mjs
│   ├── generate-agent-api.mjs / generate-export.mjs     # 以上均为 build 前置,见 §2.7
│   ├── fetch-daily-papers.py / summarize-digest.py / interest-profile.md   # 论文速递管线
│   ├── test_fetch_daily_papers.py
│   ├── generate-*-figures.py            # 个别文章的配图脚本(matplotlib,用 .venv)
│   └── migrate-old-blog.mjs # 一次性:旧 Hexo 站文章迁移
│
├── worker/agent-proxy/      # Cloudflare Worker:DeepSeek 代理 + PV/UV(单独部署)
├── skills/                  # 给 AI agent 用的论文检索 skill 源码
├── public/
│   ├── images/  research/   # 本地图床与附件
│   ├── papers-skill/  llms.txt          # 对外公开的 skill 与 llms.txt
│   └── search-index/ api/ export/ feed.xml   # build 产物,.gitignore 已忽略
│
└── next.config.ts
```

---

## 7. 升级 / 维护清单(每隔一阵跑一次)

```bash
# 看哪些依赖能升
npm outdated

# 升 patch + minor
npm update

# 升 major(谨慎,看 Changelog)
npx npm-check-updates -u
npm install

# 安全漏洞:先看,再修不破坏兼容的那部分
npm audit
npm audit fix

# 验证
npm run typecheck && npm run lint && npm run build
python3 -B -m unittest discover -s scripts -p 'test_fetch_daily_papers.py'
```

Dependabot 每月会各提一个 PR(npm 的非大版本升级、GitHub Actions 版本),CI 绿了即可合;
大版本升级不会自动提,需要按上面的流程手动做。

特别关注:
- **next-intl** — 接口偶尔有 break(metadata 内 setRequestLocale 等)
- **next-mdx-remote** — 主版本号变更通常涉及 RSC API 调整
- **@tailwindcss/typography** — 升级后检查 prose 样式没破
- **shiki** — 大版本会换主题文件,确认 dark/light 还能跑
