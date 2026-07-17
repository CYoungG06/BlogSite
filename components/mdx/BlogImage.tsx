import { imageUrl } from "@/lib/images";

/**
 * 文章图片:走 lib/images 图床抽象(OSS CDN 前缀 / basePath)。
 * 样式由 globals.css 的 .prose img 统一给(rounded-lg + hairline 描边)。
 */
export default function BlogImage({
  src,
  alt,
  title,
}: {
  src?: string;
  alt?: string;
  title?: string;
}) {
  if (!src || typeof src !== "string") return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl(src)} alt={alt ?? ""} title={title} loading="lazy" />
  );
}
