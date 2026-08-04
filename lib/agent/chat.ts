import { buildSuggestPrompt, buildSystemPrompt } from "./system";
import { AGENT_TOOLS, executeTool, type ToolCallRecord } from "./tools";

/**
 * Agent 对话循环:
 * 请求 Worker 代理(SSE 流式)→ 累积 content 与 tool_calls →
 * 有 tool_calls 就在浏览器端执行(fetch 站内静态 JSON)并继续循环,
 * 直到模型给出最终回答。跨轮历史只保留 user/assistant 文本
 * (tool 交换不带入下一轮,省 token)。各轮流出的文本全部保留、
 * 按片段流交错渲染(中间过程对用户可见)。
 * 深度调研模式(deep):更多工具轮数、更长输出、调研者 prompt;
 * 工具轮数用满后补一轮「无工具」请求强制模型给结论,不烂尾。
 * 最终回答产出后,再发一次轻量请求生成 3 条追问建议。
 */

const NORMAL_LIMITS = { rounds: 8, history: 10, maxTokens: 4096 };
const DEEP_LIMITS = { rounds: 16, history: 12, maxTokens: 8192 };

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

/** 单轮对话的产出:最终回答文本 + 本轮全部工具调用记录(UI 渲染用)+ 追问建议 */
export interface AgentTurnResult {
  content: string;
  toolCalls: ToolCallRecord[];
  suggestions: string[];
  /** 按发生顺序排列的渲染片段:各轮文本与工具调用交错,UI 按序渲染 */
  parts: AgentPart[];
}

/** 渲染片段:一轮流出的文本,或一次工具调用 */
export type AgentPart =
  | { type: "text"; content: string }
  | { type: "tool"; call: ToolCallRecord };

/** 解析一路 SSE 流,返回累积的 content 与 tool_calls;content delta 通过 onDelta 实时上抛 */
async function fetchRound(
  apiUrl: string,
  messages: ApiMessage[],
  signal: AbortSignal,
  onDelta: (content: string) => void,
  options: { maxTokens: number; withTools?: boolean },
): Promise<{ content: string; toolCalls: ApiToolCall[] }> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages,
      tools: options.withTools === false ? undefined : AGENT_TOOLS,
      stream: true,
      max_tokens: options.maxTokens,
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

/** 回答完成后,基于问答对生成 3 条追问建议;失败静默降级为空数组 */
async function fetchSuggestions(
  apiUrl: string,
  question: string,
  answer: string,
  locale: string,
  signal: AbortSignal,
): Promise<string[]> {
  try {
    const { content } = await fetchRound(
      apiUrl,
      [
        { role: "system", content: buildSuggestPrompt(locale) },
        {
          role: "user",
          content: `问:${question.slice(0, 500)}\n答:${answer.slice(0, 1500)}`,
        },
      ],
      signal,
      () => {},
      { maxTokens: 512, withTools: false },
    );
    // 优先按 JSON 数组解析,退化到按行解析(模型可能不老实输出纯 JSON)
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed: unknown = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 3);
      }
    }
    return content
      .split("\n")
      .map((line) => line.replace(/^[-*\d.、\s]+/, "").trim())
      .filter((line) => line.length >= 4 && line.length <= 60)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export async function runAgentTurn(options: {
  apiUrl: string;
  history: HistoryMessage[];
  locale: string;
  signal: AbortSignal;
  /** 用户当前浏览的站内路径(含 locale 前缀),注入 system prompt 提供页面上下文 */
  currentPath?: string;
  /** 深度调研模式:更多工具轮数、更长输出、调研者 prompt */
  deep?: boolean;
  /** 渲染片段流:每次文本增量或工具执行完成时,以全量快照回调(新数组引用) */
  onParts: (parts: AgentPart[]) => void;
}): Promise<AgentTurnResult> {
  const { apiUrl, locale, signal, onParts } = options;
  const limits = options.deep ? DEEP_LIMITS : NORMAL_LIMITS;
  const messages: ApiMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(locale, options.currentPath, options.deep),
    },
    ...options.history.slice(-limits.history),
  ];
  const records: ToolCallRecord[] = [];
  const parts: AgentPart[] = [];
  const emit = () => onParts([...parts]);
  let accumulated = "";

  /** 流出一轮文本并累积;作为独立片段追加渲染 */
  const streamTextRound = async (withTools: boolean) => {
    let textPart: { type: "text"; content: string } | null = null;
    const result = await fetchRound(
      apiUrl,
      messages,
      signal,
      (roundContent) => {
        if (!roundContent) return;
        if (textPart) {
          textPart.content = roundContent;
        } else {
          textPart = { type: "text", content: roundContent };
          parts.push(textPart);
        }
        emit();
      },
      { maxTokens: limits.maxTokens, withTools },
    );
    accumulated = joinRounds(accumulated, result.content);
    return result;
  };

  const conclude = async (): Promise<AgentTurnResult> => {
    const question = [...options.history].reverse().find((m) => m.role === "user")?.content ?? "";
    const suggestions = accumulated
      ? await fetchSuggestions(apiUrl, question, accumulated, locale, signal)
      : [];
    return { content: accumulated, toolCalls: records, suggestions, parts };
  };

  for (let round = 0; round < limits.rounds; round++) {
    const { content, toolCalls } = await streamTextRound(true);
    if (!toolCalls.length) return conclude();

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
      const { result, detail } = await executeTool(call.function.name, args, locale, apiUrl);
      const record = {
        name: call.function.name as ToolCallRecord["name"],
        args,
        detail,
      };
      records.push(record);
      parts.push({ type: "tool", call: record });
      emit();
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  // 工具轮数用满:补一轮无工具请求,强制基于已收集的资料给结论
  await streamTextRound(false);
  return conclude();
}
