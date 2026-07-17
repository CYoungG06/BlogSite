"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import {
  isValidElement,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * 代码块围栏:右上角语言标签 + 复制按钮。
 * 复制 code.textContent;clipboard API 失败用 execCommand 兜底。
 * 移动端常显,桌面 hover 淡入。语言来自 Shiki addLanguageClass
 * 打在 code 上的 language-x。
 */
export default function CodeBlock({
  children,
  ...props
}: HTMLAttributes<HTMLPreElement> & { children?: ReactNode }) {
  const t = useTranslations("blog");
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  let language: string | null = null;
  if (isValidElement(children)) {
    const code = children as ReactElement<{ className?: string }>;
    const match = code.props.className?.match(/language-([\w-]+)/);
    language = match?.[1] ?? null;
  }

  const copy = async () => {
    const text = preRef.current?.querySelector("code")?.textContent ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="group relative">
      <div className="absolute top-2.5 right-2.5 flex items-center gap-2 opacity-100 transition-opacity duration-300 ease-premium md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        {language ? (
          <span className="font-mono text-[0.7rem] text-muted select-none">
            {language}
          </span>
        ) : null}
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? t("copied") : t("copyCode")}
          title={copied ? t("copied") : t("copyCode")}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-muted ring-1 ring-hairline backdrop-blur transition-colors duration-300 ease-premium hover:text-foreground active:scale-[0.98]"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre ref={preRef} {...props}>
        {children}
      </pre>
    </div>
  );
}
