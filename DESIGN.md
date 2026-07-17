# BlogSite 设计规格文档

> 目标读者:接手复刻这个博客的工程师。
> 本文档描述**设计系统 + 架构决策 + 关键实现配方**,不依赖原代码即可重建一个同等气质的双语个人博客。
> 维护手册见 `DEVELOPMENT.md`,部署见 `DEPLOY-GH-PAGES.md`。

---

## 0. 一句话定位

**冷调结构主义(Soft Structuralism)+ 工程质感**的双语(中/英)静态博客:
白/银灰基底、巨大紧凑的 Grotesk 标题、悬浮式组件、极柔和的弥散阴影、克制而精确的动效,
叠加"理工科隐式元素"(工程点阵、等宽字体元数据、终端光标、鼠标探照灯)。
**全站只有一个冷蓝 accent,除此之外严格单色。**

## 1. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | Next.js 16(App Router)+ React 19 + TypeScript strict | 全站 SSG,`output: 'export'` 纯静态导出 |
| 样式 | Tailwind CSS v4(CSS-first,无 tailwind.config)+ `@tailwindcss/typography` | 设计 token 全部在 `app/globals.css` 的 `@theme inline` |
| 内容 | 本地 MDX(`next-mdx-remote` RSC 版) | 构建期编译,零运行时成本 |
| 代码高亮 | `@shikijs/rehype` 双主题(github-light / github-dark) | 构建期渲染,CSS 变量切换 |
| 数学公式 | `remark-math` + `rehype-katex`(构建期渲染)+ `katex.min.css` | |
| i18n | `next-intl` v4,`localePrefix: 'always'` | `/zh/...` `/en/...` 双语路由 |
| 搜索 | `minisearch` + 自研 CJK bigram 分词 | 构建期生成索引 JSON,客户端加载 |
| 主题 | `next-themes`(attribute="class") | light / dark / system 三态 |
| 图标 | `@phosphor-icons/react`,**服务端组件一律走 `dist/ssr` 入口** | 主入口的 IconContext 会让 RSC 构建报错(踩过的坑) |
| 评论 | `@giscus/react`(仅友链页,env 开关) | |

零 `any`、零 `@ts-ignore`;ESLint + `tsc --noEmit` 必须全绿。

### 1.1 环境要求

- **Node.js ≥ 22(硬性)**:`scripts/build-search-index.mjs` 依赖 Node 22 的原生 type-stripping
  直接 `import .ts`(分词器与客户端共享同一份源码,零构建工具);CI 同样用 Node 22。
  低版本会在 `npm run dev`/`build` 的前置搜索索引步骤直接报错。
- **npm**(仓库带 `package-lock.json`,用 `npm ci` 严格复现;不要用 pnpm/yarn 混用)。
- 仓库根 `.npmrc` 锁定公共 registry:`registry=https://registry.npmjs.org/`。

### 1.2 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 先重建搜索索引,再 `next dev --turbopack`(默认 3000 端口) |
| `npm run build` | 先重建搜索索引,再静态导出到 `out/` |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit`,提交前必过 |
| `npm run new-post` | 交互式生成新文章模板(frontmatter 自动填好) |
| `npm run search:index` | 手动重建搜索索引(一般不用,dev/build 会自动跑) |

### 1.3 环境变量(全部可选,本地不配也能完整跑起来)

写在 `.env.local`(`.gitignore` 已拦截);生产环境改在 GitHub 仓库 Settings → Variables,改完重跑 workflow。

| 变量 | 作用 |
|---|---|
| `NEXT_PUBLIC_BASE_PATH` | 子路径部署时设为 `/仓库名`;用户主页/自定义域名留空 |
| `NEXT_PUBLIC_IMAGE_BASE_URL` | 文章图片走 OSS 图床时的 CDN 前缀 |
| `NEXT_PUBLIC_GISCUS_REPO` / `_REPO_ID` / `_CATEGORY` / `_CATEGORY_ID` | 友链页 Giscus 评论;不配则显示配置引导面板 |
| `NEXT_PUBLIC_DEPLOY_TARGET` | `vercel`(默认)/ `gh-pages`,控制是否注入 Vercel Analytics |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` / `NEXT_PUBLIC_UMAMI_SCRIPT_URL` | Umami 统计(不配不注入) |

## 2. 设计 Token 层(全站唯一事实源)

所有颜色走语义 token,**组件内禁止写死 `zinc-*`/`dark:` 颜色类**;
dark 模式靠 CSS 变量整体换值,组件不需要写 `dark:` 变体。

### 2.1 色彩(6 个语义 token)

```css
:root {
  --background: #ffffff;              /* 页面底 */
  --foreground: #09090b;              /* 主文字(zinc-950) */
  --muted:      #52525b;              /* 次要文字(zinc-600) */
  --surface:    #fafafa;              /* 银灰区块(zinc-50) */
  --hairline:   rgb(9 9 11 / 0.08);   /* 发丝描边(替代一切 border-gray) */
  --accent:     #2952e3;              /* 唯一彩色:克制的冷蓝 */
  --soft-shadow: 0 1px 2px rgb(9 9 11 / .04), 0 12px 32px -12px rgb(9 9 11 / .12);
  --ease-premium: cubic-bezier(0.32, 0.72, 0, 1);
}
.dark {
  --background: #09090b;
  --foreground: #f4f4f5;
  --muted:      #a1a1aa;
  --surface:    #101013;
  --hairline:   rgb(244 244 245 / 0.1);
  --accent:     #7aa2ff;
  --soft-shadow: 0 1px 2px rgb(0 0 0 / .3), 0 12px 32px -12px rgb(0 0 0 / .55);
}
```

在 `@theme inline` 中映射为 `--color-*` / `--shadow-soft` / `--ease-premium`,
于是全站只用 `bg-background` `text-foreground` `text-muted` `bg-surface` `ring-hairline` `text-accent` `shadow-soft` `ease-premium`。

**accent 使用白名单**(除此之外不出现彩色):
focus 描边、`::selection`、正文链接 hover、当前导航态、TOC scroll-spy 左边线、
阅读进度条、Hero 闪烁光标、鼠标探照灯点阵。
徽章一律中性(surface + hairline),禁止 amber/blue/emerald 杂色。错误/警告类语义色(red)除外。

### 2.2 字体

- 拉丁:**Geist Sans / Geist Mono**(`next/font/google`,variable 注入)。
- CJK 显式回退栈:`"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", system-ui`。
- **基准字号 15px**(`html { font-size: 15px }`,全站 rem 同步收小;媒体查询不受影响)。
- 正文行高 1.75;大标题 `tracking-tighter`(`letter-spacing: -0.02em` 起)。
- **元数据(日期、阅读时长)一律 `font-mono`**:营造"实验日志"感,是最重要的气质细节之一。
- Tailwind v4 断点按初始字号计算,15px 基准不影响 `sm/md/lg/xl` 断点。

### 2.3 形状 / 阴影 / 描边

- **圆角规则(全站锁定)**:按钮/徽章/胶囊 = `rounded-full`;卡片 = `rounded-3xl`;
  代码块/图片 = `rounded-xl`;引用/提示面板 = `rounded-2xl`。
- **阴影只有一档** `shadow-soft`(弥散、带色相,禁止 `shadow-md` 类生硬投影);
  dark 模式用 `ring-1 ring-white/10` 高光边代替投影。
- 所有分隔线/边框统一 `border-hairline` / `ring-1 ring-hairline`,不用 1px 实灰线。

### 2.4 间距节奏

- 容器 `max-w-5xl` + `px-4 sm:px-6 lg:px-8`;阅读页正文统一 `max-w-3xl`。
- 区块间距 `py-16`(首页 Hero `py-16 sm:py-24`);页头 `py-12 sm:py-16`。
- 文章卡 `py-8`,笔记卡 `py-5`,首页列表行 `py-4`,详情页 `py-12`。
- 导航胶囊 `h-12`,按钮 `h-9`,触控目标 ≥ 36px(图标按钮 36px,可接受)。

### 2.5 z-index 体系(只允许这几层)

| 层 | 值 |
|---|---|
| 噪点肌理(body::after) | 30 |
| 鼠标探照灯(body::before) | 25 |
| 阅读进度条 / sticky 导航 | 40 |
| 移动端菜单 overlay | 35(故意低于导航,让胶囊始终可点关闭) |

## 3. 背景肌理(三层,全部零 JS 或可忽略成本)

1. **噪点**:`body::after` fixed SVG feTurbulence data-uri,`opacity: 0.028`(dark 0.05),
   `pointer-events: none`,z-30。只挂 fixed 伪元素,绝不挂滚动容器(持续 GPU 重绘)。
2. **工程点阵**:`body` 背景上叠 26px 间隔的 1px 圆点(light `rgb(9 9 11 / .065)`,dark `rgb(244 244 245 / .07)`),
   `background-attachment: fixed`。近看才察觉的图纸感。
3. **鼠标探照灯**:`body::before` 上画第二层 accent 色点阵,
   用 `mask-image: radial-gradient(260px circle at var(--mx) var(--my), black, transparent 72%)` 遮住,
   只在光标周围 260px 显现。`--mx/--my` 注册 `@property`(`<length>`,初值 `-500px`),
   一个小 client 组件在 `mousemove` 时写到 `<html>` 上(不写 React state,零重渲染);
   `transition: --mx .3s ease-out` 让光斑跟随带惯性。
   触屏无 mousemove 自然不出现;`prefers-reduced-motion` 不挂监听;
   不支持 `@property` 的浏览器 mask 定位在屏外,静默降级。

## 4. 动效规范

- **缓动统一** `cubic-bezier(0.32, 0.72, 0, 1)`;时长 300–800ms;禁止 linear / ease-in-out。
- 只动 `transform` / `opacity` / `filter`。**唯一例外**:搜索框展开用 `max-width` 过渡(见 §5.2)。
- 入场:`fade-up`(translateY(16px) + blur(4px) → 归位,0.8s),首页按 `--stagger` 级联(100ms 步进)。
- 滚动显现:`animate-reveal` 用 `animation-timeline: view()` + `@supports` 渐进增强,无 JS scroll 监听。
- **主题切换**:`document.startViewTransition(() => flushSync(() => setTheme(next)))` 整页交叉淡化,
  CSS 里 `::view-transition-old/new(root) { animation-duration: .45s }`;
  `next-themes` 保留 `disableTransitionOnChange` 防逐元素闪烁;不支持/减弱动效则直接切。
- **阅读进度条**:文章页顶部 `h-0.5 bg-accent scale-x-0` 细条,
  `@supports (animation-timeline: scroll())` 内 `animation: grow-x linear both; animation-timeline: scroll()`,零 JS。
- 所有 CSS 动画包在 `@media (prefers-reduced-motion: no-preference)` 里。
- 按钮触感:`active:scale-[0.98]`。

## 5. 关键组件配方

### 5.1 悬浮胶囊导航(Fluid Island)

```
sticky top-3 z-40 px-3
└ 胶囊:mx-auto flex h-12 w-max max-w-full rounded-full
       bg-background/70 backdrop-blur-xl ring-1 ring-hairline shadow-soft
  ├ Logo(纯文本站名)
  ├ NavLinks(桌面,hidden md:flex)
  │   当前页:aria-current="page" + bg-foreground/5 小胶囊高亮
  ├ 搜索触发按钮(放大镜 + ⌘K kbd)
  ├ 语言切换(中/EN 单按钮)
  ├ 主题切换(Phosphor Sun/Moon/Monitor,三态循环,mount 后才渲染图标防水合闪烁)
  └ MobileNav(md:hidden):汉堡两条线 morph 成 X → 全屏毛玻璃 overlay(z-35),
    大号链接从 translate-y 交错淡入;路由变化在渲染期间比对 pathname 收起(不用 effect setState)
```

毛玻璃 `backdrop-blur` 只允许出现在 sticky/fixed 元素上。
`html { scrollbar-gutter: stable }` — 短页面无滚动条时胶囊不位移(踩过的坑)。

### 5.2 顶栏内联搜索(不跳页)

- 点击/⌘K 后,**同一个胶囊连续形变**:导航、Logo 全部保持原位,
  搜索框在胶囊内从 `max-w-0` → `max-w-[26rem]` 过渡展开(`overflow-hidden` 裁切,
  内层固定宽 `clamp(10rem, 30vw, 26rem)`),胶囊随之变宽;收起时回放。
  用 max-width 是因为它是可插值属性 — 这是唯一允许动画的尺寸属性。
- 搜索框本身:内凹小胶囊 `h-8 rounded-full bg-foreground/5`,mono 输入文字;esc kbd + × 关闭。
- 收起态 `inert` + `pointer-events-none`,不进 Tab 序。
- 结果面板:`absolute inset-x-0 top-full` 垂在胶囊下方(不推挤布局),
  `rounded-3xl bg-background/95 backdrop-blur-xl shadow-soft`,最多 8 条,
  Esc / 点外部(透明幕布 z-30)/ 点 × 关闭;点结果跳转并关闭。
- 搜索逻辑抽成共享 hook,索引模块级缓存(同 locale 只 fetch + 反序列化一次);
  `/search` 独立页保留(完整列表),与顶栏共享同一 hook。
- 全局 `:focus-visible` 给链接/按钮 2px accent 描边,但**排除** `input/textarea/select`(矩形框在胶囊里很丑)。

### 5.3 卡片

- **ProjectCard(Double-Bezel 嵌套)**:外壳 `rounded-[1.75rem] bg-surface p-1.5 ring-1 ring-hairline`,
  内芯 `rounded-[calc(1.75rem-0.375rem)] bg-background ring-1 ring-hairline overflow-hidden`;
  hover 整体 `-translate-y-0.5` + `shadow-soft` 浮现,封面 scale 1.02(500ms premium 缓动)。
  标题是 stretched-link(`after:absolute after:inset-0`),GitHub/Live 是真实 `<a>`(`relative z-10` 抬升)。
- **PostCard**:发丝行(`border-b border-hairline`),mono 元信息行 + `text-xl` 标题 + 摘要 + 中性 pill 标签;
  hover 标题变 accent + 右侧 ArrowUpRight 淡入位移。
- **NoteCard**:轻量版同上,`py-5`,标题一行截断。

### 5.4 首页

- Hero 左对齐:`text-4xl sm:text-5xl tracking-tighter` 大标题,尾部一个 accent 色闪烁 `_` 光标
  (`@keyframes blink 1.1s step-end infinite`,reduced-motion 静止);
  主 CTA = 近黑实心胶囊 + button-in-button 箭头圆(`bg-foreground text-background`,
  内嵌 `bg-background/15` 圆,hover 位移放大);次 CTA = ghost 环胶囊。
- 区块:最近文章(发丝行,左 mono 日期列 + 标题 + hover 箭头)→ 最新笔记(银灰 Double-Bezel 面板)
  → 精选项目(2 列卡片)。全部条件渲染(无内容不出 section)。

### 5.5 文章页

- xl 以上两栏:`xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-10`,右栏 TOC sticky(`top-24`)。
  **坑:article 必须 `min-w-0` 且 `xl:mx-0`** — grid 子元素带 auto margin 会退化成 fit-content,
  长代码/公式把文章顶出轨道压到 TOC(实测踩过)。
- 标题 `text-3xl sm:text-4xl tracking-tighter`;meta 行 `font-mono text-xs`;tags 中性 pill。
- **TOC**:解析 markdown 的 h2/h3,用 `github-slugger` 算 id(**必须和 rehype-slug 同款**,否则锚点对不上);
  标题 < 3 个不显示;移动端收进正文上方 `<details>` 折叠面板;
  scroll-spy 用 IntersectionObserver(`rootMargin: -96px 0px -66% 0px`),当前项 accent 左边线。
  展示文本剥掉 `$...$`(目录不渲染公式)。
- **代码块**:`pre` 覆盖为客户端组件,右上角语言标签 + 复制按钮
  (复制 `code.textContent`;clipboard API 失败用 execCommand 兜底;
  移动端常显,桌面 hover 淡入;语言来自 Shiki `addLanguageClass` 打在 code 上的 `language-x`)。
  围栏 `.shiki`:`rounded-xl border-hairline padding 1rem overflow-x auto`。
- prose 精修:中文行高 1.75;**引用块去斜体去弯引号**(中文强制斜体很丑)+ hairline 左边线;
  行内 code 浅底药丸(去掉 typography 默认的反引号伪元素);链接浅下划线 hover 亮 accent;
  表格 hairline 边框 0.875em;图片 `rounded-lg ring-1 ring-hairline`;标题 `scroll-margin-top: 6rem` 避开悬浮导航。

### 5.6 页脚 / 404

- Footer 三栏(站名 + 描述 / 导航 / 更多)+ 底行版权,`border-t border-hairline`,mono 小号。
- 404:独立页自带 `<html>/<body>`(根 layout 是透传空壳),等宽字体大 404 + 双语文案 + 黑胶囊返回。

## 6. 内容与数据管线

### 6.1 MDX 插件链(`lib/mdx.ts`,顺序敏感)

```
remark:    remark-gfm
           remark-cjk-friendly-gfm-strikethrough   # ~~删除线~~接中文能渲染
           remark-cjk-friendly                     # **粗体**接中文能渲染(CommonMark flanking 坑)
           remark-math
rehype:    rehype-slug                             # 标题 id(TOC 依赖)
           rehype-autolink-headings(append #)
           rehype-katex                            # 必须在 shiki 之前
           @shikijs/rehype(themes github-light/github-dark, addLanguageClass: true)
```

### 6.2 内容结构

```
content/
  blog/{zh,en}/*.md(x)      # frontmatter: title(必)/date(必)/description/tags/draft
  notes/{zh,en}/*.md(x)     # 同上,另有 preview(description 或正文首段 160 字)
  projects/*.mdx            # 单文件双语(title/description 可为 {zh,en} map),featured 置顶
  about/{zh,en}.mdx
  friends.json
```

- `draft: true` 仅 dev 可见;列表按日期倒序;缺 locale 时回退默认语言并显示降级提示。
- 静态参数生成 locale × slug 并集,英文站也能 SSG 出中文原文页(带 fallback notice)。

### 6.3 搜索

- 构建脚本扫描 `content/{blog,notes}/{locale}/`,剥 markdown,MiniSearch 建索引
  (CJK bigram 分词),写 `public/search-index/{zh,en}.json`(gitignore)。
- `npm run build`/`dev` 前置自动重建;客户端 `loadJSON` + `prefix: true, fuzzy: 0.15, combineWith: 'AND'`,上限 20 条。

### 6.4 i18n 与根重定向

- `localePrefix: 'always'`(export 模式无 middleware);文案 `messages/{zh,en}.json` 两文件 key 严格对齐。
- 根路径 `/` 由 `app/(root)/page.tsx` 处理:独立最小 root layout(自带 `<html>/<body>`),
  JS 读 `navigator.language` 跳 `./zh/` 或 `./en/`(相对路径兼容 basePath),meta refresh 兜底。
  **不要用 `public/index.html` 做这事** — dev 下 Next 路由优先会 404(踩过的坑)。

## 7. 部署模型

- 两分支:`main`(Vercel,`localePrefix: as-needed` + middleware)与
  `gh-pages`(静态导出:`output: 'export'`、`trailingSlash: true`、`images.unoptimized`、`basePath` 由 env 驱动)。
  约 11 个配置类文件分支独立,**内容/组件/样式改动 cherry-pick 同步,不整支 merge**。
- CI:push 到 `gh-pages` → `npm ci && npm run build`(自动先建搜索索引)→ `out/` 上传 Pages。
  环境变量(Giscus、Umami、basePath)放 GitHub Repository Variables。
- 日常更新 = 写文章(`npm run new-post`)→ 本地 `npm run build` 验证 → push。

## 8. 复刻步骤清单

1. `create-next-app`(TS + App Router)+ Tailwind v4 + typography 插件,按 §2 写 `globals.css` token 层。
2. 接入 `next-intl`(zh/en,`always`)+ `next-themes`;写 §3 的三层背景肌理。
3. 按 §5.1/5.2 做导航胶囊 + 内联搜索;§5.3 卡片;§5.6 页脚/404。
4. 按 §6.1 配 MDX 链(CJK 两个插件别漏),写 content-loader(gray-matter + locale fallback)。
5. 按 §5.5 做文章页(grid + TOC + 代码块复制 + 进度条),注意 `min-w-0` / `xl:mx-0` 的坑。
6. 写搜索索引脚本 + 共享搜索 hook(模块缓存)。
7. 装 `@phosphor-icons/react`,**RSC 里全部 `dist/ssr` 入口**。
8. 配 `output: 'export'` + basePath env + GitHub Actions(`out/.nojekyll` 别忘了)。
9. 验收: Lighthouse 双模式、`prefers-reduced-motion`、xl/1115/390 三档宽度、构建全绿。

## 9. 设计约束(写给将来改代码的人)

- 新增颜色前先问:能不能用现有 6 个 token?彩色只允许 accent,用途见 §2.1 白名单。
- 动效三问:它传达了什么(层级/反馈/状态)?能否纯 CSS?reduced-motion 下是否静止?
- 不加新阴影档位、不加第二种圆角规则、不在滚动容器上挂 blur/噪点。
- 文案避免"记录技术、阅读与思考"式模板话;徽章/标签永远中性色。
