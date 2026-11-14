/**
 * 全站 404:独立页,自带 <html>/<body>(根 layout 是透传空壳,全局样式也不在这里),
 * 所以样式全部内联。跟随系统深色模式,也认站点主题开关存的 localStorage("theme")。
 * 链接带 basePath(GitHub Pages 子路径部署),不能用相对路径:404 可能出现在任意深度。
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const css = `
  :root { --bg: #ffffff; --fg: #09090b; --muted: #52525b; --line: rgb(9 9 11 / 0.1); }
  @media (prefers-color-scheme: dark) {
    :root:not(.light) { --bg: #09090b; --fg: #f4f4f5; --muted: #a1a1aa; --line: rgb(244 244 245 / 0.12); }
  }
  :root.dark { --bg: #09090b; --fg: #f4f4f5; --muted: #a1a1aa; --line: rgb(244 244 245 / 0.12); }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--bg); color: var(--fg);
    font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif; }
  main { text-align: center; padding: 2rem; }
  .code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 6rem; font-weight: 700;
    letter-spacing: -0.04em; line-height: 1; margin: 0; }
  .msg { color: var(--muted); margin: 1.5rem 0 2rem; line-height: 1.7; }
  .home { display: inline-flex; align-items: center; height: 2.5rem; padding: 0 1.5rem; border-radius: 9999px;
    background: var(--fg); color: var(--bg); font-size: 0.875rem; text-decoration: none; }
  .links { margin-top: 1.5rem; display: flex; gap: 1.25rem; justify-content: center;
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.8rem; }
  .links a { color: var(--muted); text-decoration: none; }
  .links a:hover { color: var(--fg); }
`;

// 站点主题开关(next-themes)存在 localStorage.theme:light / dark / system
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.classList.add(t)}catch(e){}`;

export default function NotFound() {
  return (
    <html lang="zh">
      <head>
        <title>404 · 相对性阿卡内</title>
        <meta name="robots" content="noindex" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <main>
          <p className="code">404</p>
          <p className="msg">
            你要找的页面不在这里。
            <br />
            The page you requested could not be found.
          </p>
          <a className="home" href={`${basePath}/`}>
            返回首页 / Back home
          </a>
          <nav className="links" aria-label="常用入口">
            <a href={`${basePath}/zh/blog/`}>文章</a>
            <a href={`${basePath}/zh/papers/`}>论文速递</a>
            <a href={`${basePath}/zh/archive/`}>归档</a>
            <a href={`${basePath}/zh/search/`}>搜索</a>
          </nav>
        </main>
      </body>
    </html>
  );
}
