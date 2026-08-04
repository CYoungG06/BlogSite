/**
 * 全站 PV/UV 打点(自建 worker + D1,见 worker/agent-proxy):
 * - 每会话每页只记一次(sessionStorage 去重,防刷新灌水)
 * - 访客身份是 localStorage 里的匿名 UUID,不存 IP、无 cookie
 * - text/plain 发送避免 CORS 预检;sendBeacon 优先,fallback keepalive fetch
 * - 任何失败都静默:打点永远不影响页面
 */

const VID_KEY = "acane-vid";
const API_BASE = process.env.NEXT_PUBLIC_AGENT_API ?? "";

function visitorId(): string {
  try {
    let vid = localStorage.getItem(VID_KEY);
    if (!vid) {
      vid = crypto.randomUUID();
      localStorage.setItem(VID_KEY, vid);
    }
    return vid;
  } catch {
    // 隐私模式等场景:每次一个临时 id,UV 会略偏高,可接受
    return crypto.randomUUID();
  }
}

export function trackPageview(path: string): void {
  if (!API_BASE) return;
  try {
    const dedupeKey = `pv:${path}`;
    if (sessionStorage.getItem(dedupeKey)) return;
    sessionStorage.setItem(dedupeKey, "1");

    const body = JSON.stringify({ vid: visitorId(), path });
    const blob = new Blob([body], { type: "text/plain" });
    if (navigator.sendBeacon?.(`${API_BASE}/pv`, blob)) return;
    void fetch(`${API_BASE}/pv`, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "Content-Type": "text/plain" },
    });
  } catch {
    // 静默
  }
}
