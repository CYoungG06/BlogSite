/**
 * AI 助手全局打开总线:
 * 划词气泡、文章页按钮、首页输入框、⌘K 面板等任意入口,
 * 统一通过 CustomEvent 通知 AgentWidget 打开并执行动作。
 * AgentWidget 未挂载时事件自然丢弃(动态加载完成后入口才可用)。
 */

export interface AgentOpenRequest {
  /** 打开面板并自动发送这条消息 */
  prompt?: string;
  /** 仅打开面板并预填输入框(等用户自己发) */
  prefill?: string;
}

export const AGENT_OPEN_EVENT = "acane:open";

export function openAgent(request: AgentOpenRequest): void {
  window.dispatchEvent(
    new CustomEvent<AgentOpenRequest>(AGENT_OPEN_EVENT, { detail: request }),
  );
}
