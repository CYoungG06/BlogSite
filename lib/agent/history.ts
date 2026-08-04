import type { ChatMessage } from "./chat";

/**
 * 对话历史本地持久化(localStorage,单会话):
 * 整段对话(含 parts 交错片段与追问建议)在回答结束时落盘,
 * 刷新/重开浏览器后恢复;清空对话时同步清除。
 * 上限 40 条 / 400KB,超出从最旧裁剪;写入失败(配额)减半重试一次。
 * 多标签页为 last-write-wins,不做跨 tab 同步。
 */

const HISTORY_KEY = "acane-chat-history";
const MAX_MESSAGES = 40;
const MAX_BYTES = 400_000;

function isValidMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== "object") return false;
  const msg = m as Record<string, unknown>;
  return (
    typeof msg.id === "number" &&
    (msg.role === "user" || msg.role === "assistant") &&
    typeof msg.content === "string"
  );
}

/** 裁剪到上限内:先按条数,再按体积从旧到新删;瞬态(pending)不持久化 */
function trim(messages: ChatMessage[]): ChatMessage[] {
  let out = messages.slice(-MAX_MESSAGES).map((m) => ({ ...m, pending: undefined }));
  while (out.length > 2 && JSON.stringify(out).length > MAX_BYTES) {
    out = out.slice(2); // 对话成对产生,按对裁
  }
  return out;
}

export function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data?.v !== 1 || !Array.isArray(data.messages)) return [];
    return data.messages.filter(isValidMessage);
  } catch {
    return [];
  }
}

export function saveHistory(messages: ChatMessage[]): void {
  if (!messages.length) return;
  const payload = (list: ChatMessage[]) =>
    JSON.stringify({ v: 1, savedAt: Date.now(), messages: list });
  const trimmed = trim(messages);
  try {
    localStorage.setItem(HISTORY_KEY, payload(trimmed));
  } catch {
    // 配额不足:砍半重试一次,仍失败就放弃(下次成功时自然覆盖)
    try {
      localStorage.setItem(HISTORY_KEY, payload(trimmed.slice(Math.floor(trimmed.length / 2))));
    } catch {
      // 静默
    }
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // 静默
  }
}
