/**
 * AI 助手全局打开总线:
 * 划词气泡、文章页按钮、首页输入框、⌘K 面板等任意入口,
 * 统一通过 CustomEvent 通知 AgentWidget 打开并执行动作。
 * 面板按需加载(见 AgentWidgetLoader):加载完成前的请求由外壳排队,挂好后补发。
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

export const AGENT_PRELOAD_EVENT = "acane:preload";

/** 有使用意图时提前加载面板(悬停/聚焦入口时调用),不打开 */
export function preloadAgent(): void {
  window.dispatchEvent(new Event(AGENT_PRELOAD_EVENT));
}
