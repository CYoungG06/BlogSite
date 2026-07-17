# 部署到 GitHub Pages

本文档是 `DEVELOPMENT.md` §4 的配套手册:把这个静态博客部署到 GitHub Pages 的完整步骤。
部署模型的设计背景见 `DESIGN.md` §7;workflow 文件在 `.github/workflows/deploy.yml`。

---

## 0. 前置条件

- 仓库已经 push 到 GitHub;
- 本地 `npm run build` 能通过(产物输出到 `out/`)。本地过不了,CI 一样过不了。

## 1. 打开 Pages,选 GitHub Actions 源

仓库页面 → **Settings → Pages** → **Build and deployment**:

- **Source 选 `GitHub Actions`**(不要选 `Deploy from a branch`)。

选完之后不需要再配任何东西;`actions/deploy-pages@v4` 会负责发布。

## 2. 触发方式

workflow 在两种情况下运行:

- `git push` 到 `main` 分支;
- 手动触发:Actions → **Deploy to GitHub Pages** → **Run workflow**(改了 Variables 之后用这招重跑)。

每次运行做四件事:`npm ci` → `npm run build`(前置自动重建搜索索引)→ 给 `out/` 加 `.nojekyll` → 上传并部署。

## 3. Repository Variables 配置

环境变量在构建期注入。位置:**Settings → Secrets and variables → Actions → Variables** 标签页
(注意是 Variables,不是 Secrets — 这些都是 `NEXT_PUBLIC_*` 公开变量,会打进前端产物,不要放任何私密值)。

全部可选,留空等价于不配置。**改完 Variables 必须重跑 workflow 才生效**(它们只在构建时读取)。

| 变量 | 作用 | 何时要设 |
|---|---|---|
| `NEXT_PUBLIC_BASE_PATH` | 站点子路径前缀 | **项目主页**(`https://<user>.github.io/<repo>/`)必须设为 `/仓库名`,如 `/BlogSite`;**用户主页**仓库(`<user>.github.io`)或**自定义域名**留空 |
| `NEXT_PUBLIC_IMAGE_BASE_URL` | 文章图片的 CDN 前缀 | 图片走 OSS/图床时设为 CDN 根地址;用仓库内 `public/images/` 留空 |
| `NEXT_PUBLIC_GISCUS_REPO` | Giscus 评论仓库,如 `CYoungG06/BlogSite` | 要开友链页评论就配;四个必须同时配,缺一则显示配置引导面板 |
| `NEXT_PUBLIC_GISCUS_REPO_ID` | Giscus 仓库 ID | 同上,从 [giscus.app](https://giscus.app/zh-CN) 配置器里取 |
| `NEXT_PUBLIC_GISCUS_CATEGORY` | Giscus Discussion 分类名 | 同上 |
| `NEXT_PUBLIC_GISCUS_CATEGORY_ID` | Giscus 分类 ID | 同上 |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | Umami 站点 ID | 要接 Umami 统计才配 |
| `NEXT_PUBLIC_UMAMI_SCRIPT_URL` | Umami 脚本地址 | 同上,自托管时填自己的脚本 URL |

## 4. 首次 push 后验证

1. **Actions 页**:push 后到仓库 Actions 标签页,确认 `Deploy to GitHub Pages` 运行成功(绿勾);失败点进去看日志,最常见的原因是 §1 的 Source 没选 GitHub Actions。
2. **访问站点**:打开 `https://<user>.github.io/<repo>/`(项目主页;用户主页则没有 `/<repo>` 前缀),确认首页正常、样式没丢。样式全丢基本是 `NEXT_PUBLIC_BASE_PATH` 没配或配错。
3. **功能抽查**:
   - 语言切换按钮(中 / EN)来回切一次;
   - 打开一篇文章,确认 TOC、代码高亮、公式渲染正常;
   - 用 ⌘K 或导航上的搜索按钮搜一个中文词,确认搜索索引已生成;
   - 切一次深色模式。
4. **后续更新**:写文章 → 本地 `npm run build` 验证 → push,CI 自动重新部署。

## 5. 自定义域名备注

- 在 **Settings → Pages → Custom domain** 填你的域名,DNS 侧按 GitHub 提示配 `CNAME` 记录(指向 `<user>.github.io`);apex 域名用 `A` 记录指向 GitHub 的四个 IP。
- 用自定义域名后站点挂在根路径下,**`NEXT_PUBLIC_BASE_PATH` 必须留空**,然后重跑 workflow。
- 勾选 **Enforce HTTPS**(证书签发需要几分钟,签发前勾不上属正常)。
- 仓库里不需要手动维护 `CNAME` 文件 — Actions 部署会以 Pages 设置里的域名为准。

## 6. 常见问题

| 症状 | 原因与处理 |
|---|---|
| 站点 404,但 Actions 是绿的 | Pages Source 没选 GitHub Actions,见 §1 |
| 页面有文字没样式 / 链接全 404 | `NEXT_PUBLIC_BASE_PATH` 与访问路径不匹配,见 §3 表格,改完重跑 workflow |
| 搜索无结果 | 索引没进产物:本地跑 `npm run search:index` 验证,CI 里 `npm run build` 会自动重建 |
| 评论框显示"未配置" | Giscus 四个变量没配齐,见 §3 |
