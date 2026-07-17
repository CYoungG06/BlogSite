import Script from "next/script";

/**
 * Umami 统计:不配 NEXT_PUBLIC_UMAMI_* 则不注入任何脚本。
 */
export default function Analytics() {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  const scriptUrl = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;

  if (!websiteId || !scriptUrl) {
    return null;
  }

  return (
    <Script
      src={scriptUrl}
      data-website-id={websiteId}
      strategy="afterInteractive"
    />
  );
}
