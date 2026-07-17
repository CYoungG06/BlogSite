/**
 * 全站 404:独立页,自带 <html>/<body>(根 layout 是透传空壳)。
 * 等宽字体大 404 + 双语文案 + 黑胶囊返回。
 */
export default function NotFound() {
  return (
    <html lang="zh">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif",
          background: "#ffffff",
          color: "#09090b",
        }}
      >
        <main style={{ textAlign: "center", padding: "2rem" }}>
          <p
            style={{
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              fontSize: "6rem",
              fontWeight: 700,
              letterSpacing: "-0.04em",
              lineHeight: 1,
              margin: 0,
            }}
          >
            404
          </p>
          <p style={{ color: "#52525b", margin: "1.5rem 0 2rem" }}>
            你要找的页面不在这里。
            <br />
            The page you requested could not be found.
          </p>
          <a
            href="./"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: "2.5rem",
              padding: "0 1.5rem",
              borderRadius: "9999px",
              background: "#09090b",
              color: "#ffffff",
              fontSize: "0.875rem",
              textDecoration: "none",
            }}
          >
            返回首页 / Back home
          </a>
        </main>
      </body>
    </html>
  );
}
