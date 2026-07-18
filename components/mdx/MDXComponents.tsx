import type { MDXRemoteProps } from "next-mdx-remote/rsc";
import BlogImage from "./BlogImage";
import CodeBlock from "./CodeBlock";
import MDXLink from "./MDXLink";

type Components = NonNullable<MDXRemoteProps["components"]>;

export const mdxComponents: Components = {
  pre: CodeBlock,
  img: BlogImage,
  a: MDXLink,
};
