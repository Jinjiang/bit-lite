import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import type { CompileOptions } from "@mdx-js/mdx";

export type DemoMdxOptions = CompileOptions;

export const mdxOptions: Readonly<DemoMdxOptions> = {
  remarkPlugins: [remarkFrontmatter, [remarkMdxFrontmatter, { name: "frontmatter" }]],
};

export function createMdxOptions(overrides: DemoMdxOptions = {}): DemoMdxOptions {
  return {
    ...mdxOptions,
    ...overrides,
    remarkPlugins: [...(mdxOptions.remarkPlugins ?? []), ...(overrides.remarkPlugins ?? [])],
    rehypePlugins: [...(mdxOptions.rehypePlugins ?? []), ...(overrides.rehypePlugins ?? [])],
  };
}
