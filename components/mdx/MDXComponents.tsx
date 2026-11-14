import type { MDXRemoteProps } from "next-mdx-remote/rsc";
import type { ComponentProps } from "react";
import BlogImage from "./BlogImage";
import CodeBlock from "./CodeBlock";
import MDXLink from "./MDXLink";

type Components = NonNullable<MDXRemoteProps["components"]>;

/** 宽表格在自己的容器里横向滚动,不把整页撑宽(手机上尤其) */
function ScrollTable(props: ComponentProps<"table">) {
  return (
    <div className="my-8 overflow-x-auto">
      <table {...props} className="my-0" />
    </div>
  );
}

export const mdxComponents: Components = {
  pre: CodeBlock,
  img: BlogImage,
  a: MDXLink,
  table: ScrollTable,
};

/**
 * 正文用了一级标题的文章(多为旧站迁移来的):整体降一级渲染。
 * 页面标题已是 h1,正文再出现 h1 会比标题还重,层级也不合法。
 * 只换标签,id / 锚点由 rehype 插件照常生成,TOC 不受影响。
 */
export const demotedHeadings: Components = {
  h1: (props: ComponentProps<"h2">) => <h2 {...props} />,
  h2: (props: ComponentProps<"h3">) => <h3 {...props} />,
  h3: (props: ComponentProps<"h4">) => <h4 {...props} />,
  h4: (props: ComponentProps<"h5">) => <h5 {...props} />,
  h5: (props: ComponentProps<"h6">) => <h6 {...props} />,
};
