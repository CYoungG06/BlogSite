import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * next-intl 原始导航 API。站内组件请从 ./navigation 引入:
 * 那里的 Link 换成了按意图预取的版本(components/IntentLink.tsx)。
 */
export const {
  Link: BaseLink,
  redirect,
  usePathname,
  useRouter,
  getPathname,
} = createNavigation(routing);
