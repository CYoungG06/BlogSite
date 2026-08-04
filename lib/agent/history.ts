import type { ChatMessage } from "./chat";

/**
 * 对话历史本地持久化(localStorage,多会话):
 * 每段对话是一个 session(含标题/时间/完整消息,含 parts 与追问建议),
 * 回答结束时落盘;历史列表可回看、切换、删除;刷新/重开浏览器自动恢复最近会话。
 * 上限 20 个会话 × 40 条消息,单会话 200KB,超出从最旧裁剪;
 * 写入失败(配额)逐个丢弃最旧会话重试。
 * 多标签页为 last-write-wins,不做跨 tab 同步。
 * 旧版单会话 key(acane-chat-history)在首次读取时自动迁移。
 */

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

const SESSIONS_KEY = "acane-chat-sessions";
const LEGACY_KEY = "acane-chat-history";
const MAX_SESSIONS = 20;
const MAX_MESSAGES = 40;
const MAX_SESSION_BYTES = 200_000;

function isValidMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== "object") return false;
  const msg = m as Record<string, unknown>;
  return (
    typeof msg.id === "number" &&
    (msg.role === "user" || msg.role === "assistant") &&
    typeof msg.content === "string"
  );
}

function isValidSession(s: unknown): s is ChatSession {
  if (!s || typeof s !== "object") return false;
  const ses = s as Record<string, unknown>;
  return (
    typeof ses.id === "string" &&
    typeof ses.title === "string" &&
    typeof ses.updatedAt === "number" &&
    Array.isArray(ses.messages)
  );
}

export function createSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** 标题取第一条用户消息(单行截断);没有就用时间兜底 */
function deriveTitle(messages: ChatMessage[], fallbackTs: number): string {
  const first = messages.find((m) => m.role === "user" && m.content.trim());
  if (first) {
    const line = first.content.replace(/\s+/g, " ").trim();
    return line.length > 24 ? `${line.slice(0, 24)}…` : line;
  }
  return new Date(fallbackTs).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** 裁剪单会话:先按条数,再按体积从旧到新按对删;瞬态(pending/failed 原因)不持久化 */
function trimMessages(messages: ChatMessage[]): ChatMessage[] {
  let out = messages
    .slice(-MAX_MESSAGES)
    .map((m) => ({ ...m, pending: undefined }));
  while (out.length > 2 && JSON.stringify(out).length > MAX_SESSION_BYTES) {
    out = out.slice(2); // 对话成对产生,按对裁
  }
  return out;
}

function readRaw(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as { v?: unknown; sessions?: unknown };
    if (data?.v !== 1 || !Array.isArray(data.sessions)) return [];
    return data.sessions
      .filter(isValidSession)
      .map((s) => ({ ...s, messages: s.messages.filter(isValidMessage) }));
  } catch {
    return [];
  }
}

function writeRaw(sessions: ChatSession[]): void {
  // 配额不足:逐个丢最旧会话重试,直到能写下或只剩当前一个
  let list = sessions.slice(0, MAX_SESSIONS);
  for (;;) {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify({ v: 1, sessions: list }));
      return;
    } catch {
      if (list.length <= 1) return; // 单个都写不下就放弃(下次成功自然覆盖)
      list = list.slice(0, -1);
    }
  }
}

/** 旧版单会话 → 迁移为一个 session,迁移后删旧 key */
function migrateLegacy(): ChatSession[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data?.v !== 1 || !Array.isArray(data.messages)) return [];
    const messages = (data.messages as unknown[]).filter(isValidMessage);
    if (!messages.length) return [];
    const ts = typeof data.savedAt === "number" ? data.savedAt : Date.now();
    const session: ChatSession = {
      id: createSessionId(),
      title: deriveTitle(messages, ts),
      updatedAt: ts,
      messages,
    };
    localStorage.removeItem(LEGACY_KEY);
    writeRaw([session]);
    return [session];
  } catch {
    return [];
  }
}

/** 全部会话,按最近更新排序(首次调用时顺带迁移旧版数据) */
export function loadSessions(): ChatSession[] {
  let sessions = readRaw();
  if (!sessions.length) sessions = migrateLegacy();
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 启动恢复:最近更新的那段对话 */
export function loadLatestSession(): ChatSession | null {
  return loadSessions()[0] ?? null;
}

/** 新建或更新会话(id 为 null 时新建),返回会话 id */
export function saveSession(id: string | null, messages: ChatMessage[]): string {
  if (!messages.length) return id ?? "";
  const sessions = loadSessions();
  const now = Date.now();
  const existing = id ? sessions.find((s) => s.id === id) : undefined;
  const session: ChatSession = {
    id: existing?.id ?? createSessionId(),
    title: existing?.title ?? deriveTitle(messages, now),
    updatedAt: now,
    messages: trimMessages(messages),
  };
  const rest = sessions.filter((s) => s.id !== session.id);
  writeRaw([session, ...rest]);
  return session.id;
}

export function deleteSession(id: string): void {
  writeRaw(loadSessions().filter((s) => s.id !== id));
}
