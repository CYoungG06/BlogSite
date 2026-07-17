/**
 * 根路径 `/`:JS 读 navigator.language 跳 ./zh/ 或 ./en/,
 * 相对路径兼容 basePath;meta refresh 兜底(无 JS 时落 zh)。
 * 不要用 public/index.html 做这事 — dev 下 Next 路由优先会 404。
 */
export default function RootPage() {
  return (
    <>
      <meta httpEquiv="refresh" content="1;url=./zh/" />
      <script
        dangerouslySetInnerHTML={{
          __html:
            "(function(){var l=(navigator.language||'').toLowerCase();var t=l.indexOf('zh')===0?'zh':'en';location.replace('./'+t+'/');})();",
        }}
      />
      <p style={{ fontFamily: "monospace", padding: "2rem" }}>
        Redirecting… <a href="./zh/">中文</a> · <a href="./en/">English</a>
      </p>
    </>
  );
}
