"use client";

/**
 * 阿卡内的「状态脸」:面板头部小头像。
 * idle 时缓慢眨眼,busy 时眼睛变圆点跳动(查资料/思考中)。
 * 纯 SVG + CSS 动画,无外部资源。
 */
export default function AcaneAvatar({ busy }: { busy: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative flex items-center justify-center rounded-lg bg-accent/12 transition-transform duration-300 ease-premium ${
        busy ? "animate-pulse" : ""
      }`}
      style={{ width: 22, height: 22 }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        {busy ? (
          // 思考中:两个圆点交替跳
          <>
            <circle cx="4.5" cy="7" r="1.6" className="animate-bounce fill-accent [animation-delay:-0.2s]" />
            <circle cx="9.5" cy="7" r="1.6" className="animate-bounce fill-accent" />
          </>
        ) : (
          // 常态:两条竖线眼,缓慢眨眼
          <>
            <rect x="3.4" y="4" width="1.8" height="6" rx="0.9" className="acane-eye fill-accent" />
            <rect x="8.8" y="4" width="1.8" height="6" rx="0.9" className="acane-eye fill-accent" />
          </>
        )}
      </svg>
    </span>
  );
}
