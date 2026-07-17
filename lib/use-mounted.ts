"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * 是否已挂载(水合安全的 client-only 判断):
 * 服务端/首次水合渲染 false,客户端后续渲染 true。
 * 替代 useEffect + setState 的 mounted 模式(react-hooks/set-state-in-effect)。
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
