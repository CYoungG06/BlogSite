import type { MDXRemoteProps } from "next-mdx-remote/rsc";
import BlogImage from "./BlogImage";
import CodeBlock from "./CodeBlock";

type Components = NonNullable<MDXRemoteProps["components"]>;

export const mdxComponents: Components = {
  pre: CodeBlock,
  img: BlogImage,
};
