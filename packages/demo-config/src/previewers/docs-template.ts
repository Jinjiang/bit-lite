import { createElement } from "react";
import type { PreviewDocsTemplateProps } from "bit-lite-preview/browser";

export default function DemoDocsTemplate({ docs }: PreviewDocsTemplateProps) {
  const Content = docs.default;
  const title = readTitle(docs.frontmatter);
  return createElement(
    "main",
    { "data-demo-docs-template": "" },
    title ? createElement("header", undefined, createElement("h1", undefined, title)) : null,
    createElement("article", undefined, createElement(Content))
  );
}

function readTitle(frontmatter: Record<string, unknown> | undefined) {
  return typeof frontmatter?.title === "string" ? frontmatter.title : undefined;
}
