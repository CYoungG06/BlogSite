# 维护手册

本文档覆盖在新机器上接续维护博客需要的全部步骤,以及日常工作流。
配合 `REQUIREMENTS.md`(需求与架构)和 `DEPLOY-GH-PAGES.md`(GH Pages 部署)阅读。

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
# 打开 http://localhost:3000 (main 分支会自动跳到 /zh)
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
- 改了文章后,`npm run dev` 会重新生成索引
- 也可以单独跑:`npm run search:index`
- 搜索逻辑:中文 bigram + 英文按词,见 `lib/search/tokenize.ts`

### 2.7 build & 预览生产构建

```bash
npm run build           # 自动先跑 search:index,然后 next build
npm run start           # main 分支:本地起 Node 服务器
# gh-pages 分支:
npx serve out -p 3000   # build 输出 ./out,用静态服务器跑
```

### 2.8 typecheck / lint

```bash
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
```

提交前建议都跑一遍。

---

## 3. 分支模型

| 分支 | 用途 | 部署目标 |
|---|---|---|
| `main` | Vercel-ready,有 middleware,`localePrefix: as-needed` | Vercel |
| `gh-pages` | 静态导出,无 middleware,`localePrefix: always` | GitHub Pages |

**两个分支的内容是 99% 重叠的**,只有 11 个文件不同(配置 / 入口 / Analytics / 部署文件)。
日常写文章/调样式都在 main 做,然后看是否需要 cherry-pick 到 gh-pages。

**同步策略**(把 main 的文章/组件改动带到 gh-pages):

```bash
git checkout gh-pages

# A. 单文件 cherry-pick(推荐 — 精准)
git checkout main -- content/blog/zh/new-post.md
git commit -m "content: 同步 main 的新文章"

# B. 整批 cherry-pick(从 main 的某个 commit)
git cherry-pick <main-commit-sha>
# 如果 commit 同时改了配置类文件,可能会有冲突,挑你要的 hunks

# C. 直接 merge(只在你已合并并解决冲突时用)
# 不推荐 — 容易把 main 的 next.config.ts / i18n/routing.ts 也带过来
```

**绝对不要做的事**:
- ❌ 在 gh-pages 上直接改 `next.config.ts` / `i18n/routing.ts` / `proxy.ts` 等差异文件并 merge 回 main
- ❌ 修改 `.npmrc` 把 registry 换成内部 mirror 然后提交
- ❌ 把 `.env.local` 提交(`.gitignore` 已挡住,但 `git add -f` 仍能突破)

---

## 4. 部署

| 部署 | 文档 |
|---|---|
| Vercel(main 分支) | 见 4.1 |
| GitHub Pages(gh-pages 分支) | 见 `DEPLOY-GH-PAGES.md` |

### 4.1 Vercel(main 分支)

1. 去 [vercel.com/new](https://vercel.com/new) → Import Project → 选这个 repo
2. Framework Preset 自动识别 Next.js,不用改任何配置
3. Environment Variables 标签按需填(全部 `NEXT_PUBLIC_*` 都是公开变量):
   - `NEXT_PUBLIC_SITE_URL` — 部署后再填回完整 URL
   - `NEXT_PUBLIC_GISCUS_*` (4 个,可选)
   - `NEXT_PUBLIC_UMAMI_*` (可选)
4. Deploy → 拿到 `xxx.vercel.app` 临时域名

之后每次 `git push origin main` 都会自动重新部署。
开 PR 会自动出 Preview 部署。

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
├── REQUIREMENTS.md          # 需求与方案文档
├── DEVELOPMENT.md           # 本文档 — 维护手册
├── DESIGN.md                # 设计规格文档(设计系统 + 复刻指南)
├── DEPLOY-GH-PAGES.md       # GitHub Pages 部署说明(仅 gh-pages 分支)
├── .npmrc                   # ⚠️ 锁公共 registry
├── .env.local.example       # 环境变量模板
├── .github/workflows/       # CI(仅 gh-pages 分支)
│
├── app/
│   ├── (root)/              # 根路径重定向(独立最小 root layout)
│   ├── not-found.tsx        # 全站 404(自带 <html>/<body>)
│   └── [locale]/            # 多语言路由
│       ├── layout.tsx
│       ├── page.tsx         # 首页
│       ├── blog/            # 文章列表 + [slug] 详情
│       ├── notes/           # 笔记列表 + [slug] 详情
│       ├── projects/        # 项目卡片 + [slug] 详情(可选)
│       ├── about/page.tsx
│       ├── friends/page.tsx # 友链 + Giscus
│       └── search/page.tsx
│
├── components/
│   ├── layout/              # Header / HeaderBar / NavLinks / MobileNav / Footer / Container / PageHeader
│   ├── blog/                # PostCard / FallbackNotice
│   ├── notes/               # NoteCard
│   ├── projects/            # ProjectCard
│   ├── mdx/                 # BlogImage / MDXComponents / MDXContent / CodeBlock / TableOfContents
│   ├── search/              # use-search hook / HeaderSearch / SearchClient
│   ├── Analytics.tsx / Giscus.tsx / MouseSpotlight.tsx
│   ├── ThemeProvider.tsx / ThemeToggle.tsx
│   └── LanguageToggle.tsx
│
├── lib/
│   ├── content-loader.ts    # MDX 文件扫描/解析底层
│   ├── posts.ts / notes.ts / projects.ts
│   ├── friends.ts / giscus.ts
│   ├── mdx.ts               # MDX 编译选项(Shiki/GFM/CJK 强调/KaTeX/锚点)
│   ├── markdown.ts          # stripMarkdown / firstParagraphPreview / extractHeadings
│   ├── images.ts            # 图床抽象
│   ├── format.ts            # 本地化日期
│   └── search/tokenize.ts   # 中英混合分词器
│
├── i18n/
│   ├── routing.ts           # locale 配置 + assertLocale
│   ├── request.ts           # next-intl 服务端配置
│   └── navigation.ts        # 多语言感知 Link/Router
│
├── messages/                # i18n 文案 — zh.json / en.json
│
├── content/                 # 所有内容
│   ├── blog/{zh,en}/*.mdx
│   ├── blog/_template.md.example
│   ├── notes/{zh,en}/*.mdx
│   ├── projects/*.mdx
│   ├── about/{zh,en}.mdx
│   └── friends.json
│
├── scripts/
│   ├── new-post.mjs         # npm run new-post
│   ├── build-search-index.mjs
│   └── migrate-old-blog.mjs # 一次性:旧 Hexo 站文章迁移(search.xml → MDX)
│
├── public/
│   ├── images/              # 本地图床(含迁移文章的 images/harness/)
│   └── search-index/        # build 产物,.gitignore 已忽略
│
├── proxy.ts                 # next-intl middleware(仅 main 分支)
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

# 跑测试套件(暂时只有 typecheck + lint + build)
npm run typecheck && npm run lint && npm run build
```

特别关注:
- **next-intl** — 接口偶尔有 break(metadata 内 setRequestLocale 等)
- **next-mdx-remote** — 主版本号变更通常涉及 RSC API 调整
- **@tailwindcss/typography** — 升级后检查 prose 样式没破
- **shiki** — 大版本会换主题文件,确认 dark/light 还能跑
