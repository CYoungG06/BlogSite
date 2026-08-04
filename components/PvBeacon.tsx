"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { trackPageview } from "@/lib/analytics/pv";

/** 全站 PV 打点:路由变化时上报当前路径(无 UI) */
export default function PvBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    trackPageview(pathname);
  }, [pathname]);
  return null;
}
