import { MDXRemote } from "next-mdx-remote/rsc";
import { rehypePlugins, remarkPlugins } from "@/lib/mdx";
import { mdxComponents } from "./MDXComponents";

/** 构建期编译 MDX,零运行时成本 */
export default function MDXContent({ source }: { source: string }) {
  return (
    <MDXRemote
      source={source}
      options={{
        mdxOptions: {
          remarkPlugins,
          rehypePlugins,
        },
      }}
      components={mdxComponents}
    />
  );
}
