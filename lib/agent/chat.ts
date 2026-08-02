import { buildSystemPrompt } from "./system";
import { AGENT_TOOLS, executeTool, type ToolCallRecord } from "./tools";

/**
 * Agent 对话循环:
 * 请求 Worker 代理(SSE 流式)→ 累积 content 与 tool_calls →
 * 有 tool_calls 就在浏览器端执行(fetch 站内静态 JSON)并继续循环,
 * 直到模型给出最终回答。单轮对话最多 MAX_ROUNDS 次工具循环,
 * 跨轮历史只保留 user/assistant 文本(tool 交换不带入下一轮,省 token)。
 * 各轮流出的文本全部保留、按轮拼接(中间过程对用户可见),
 * 而不是被下一轮覆盖。
 */

const MAX_ROUNDS = 5;
const MAX_HISTORY = 10;
const MAX_TOKENS = 4096;

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface ApiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type ApiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ApiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** 单轮对话的产出:最终回答文本 + 本轮全部工具调用记录(UI 渲染用) */
export interface AgentTurnResult {
  content: string;
  toolCalls: ToolCallRecord[];
}

/** 解析一路 SSE 流,返回累积的 content 与 tool_calls;content delta 通过 onDelta 实时上抛 */
async function fetchRound(
  apiUrl: string,
  messages: ApiMessage[],
  signal: AbortSignal,
  onDelta: (content: string) => void,
): Promise<{ content: string; toolCalls: ApiToolCall[] }> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages,
      tools: AGENT_TOOLS,
      stream: true,
      max_tokens: MAX_TOKENS,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`agent proxy error: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  // index → 累积中的 tool_call(SSE delta 按 index 分片到达)
  const pending = new Map<number, ApiToolCall>();

  const handleData = (data: string) => {
    if (data === "[DONE]") return;
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return; // 半包/心跳,跳过
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      onDelta(content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const idx = typeof tc.index === "number" ? tc.index : 0;
      const acc = pending.get(idx) ?? {
        id: "",
        type: "function" as const,
        function: { name: "", arguments: "" },
      };
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.function.name += tc.function.name;
      if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
      pending.set(idx, acc);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) handleData(trimmed.slice(5).trim());
      }
    }
  }
  if (buffer.trim().startsWith("data:")) {
    handleData(buffer.trim().slice(5).trim());
  }

  const toolCalls = [...pending.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => tc)
    .filter((tc) => tc.function.name);
  return { content, toolCalls };
}

/** 拼接相邻两轮的流出文本,空轮不产生多余空行 */
const joinRounds = (prev: string, next: string) =>
  prev && next ? `${prev}\n\n${next}` : prev || next;

export async function runAgentTurn(options: {
  apiUrl: string;
  history: HistoryMessage[];
  locale: string;
  signal: AbortSignal;
  onDelta: (content: string) => void;
  onToolCall?: (call: ToolCallRecord) => void;
}): Promise<AgentTurnResult> {
  const { apiUrl, locale, signal, onDelta, onToolCall } = options;
  const messages: ApiMessage[] = [
    { role: "system", content: buildSystemPrompt(locale) },
    ...options.history.slice(-MAX_HISTORY),
  ];
  const records: ToolCallRecord[] = [];
  let accumulated = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const base = accumulated;
    const { content, toolCalls } = await fetchRound(
      apiUrl,
      messages,
      signal,
      (roundContent) => onDelta(joinRounds(base, roundContent)),
    );
    accumulated = joinRounds(accumulated, content);
    if (!toolCalls.length) return { content: accumulated, toolCalls: records };

    // 回显 assistant 的 tool_calls,再逐个执行、追加 tool 结果
    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls,
    });
    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // 参数 JSON 不完整(理论上不应发生,流已结束),按空调用处理
      }
      const record = {
        name: call.function.name as ToolCallRecord["name"],
        args,
      };
      records.push(record);
      onToolCall?.(record);
      const result = await executeTool(call.function.name, args, locale);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  return { content: accumulated, toolCalls: records };
}
