import { describe, expect, it } from "vitest";
import { createMdxOptions, mdxOptions } from "./mdx-options.js";

describe("shared MDX options", () => {
  it("exports ordinary plugin functions", () => {
    expect(typeof mdxOptions.remarkPlugins?.[0]).toBe("function");
  });

  it("composes local plugins after shared defaults", () => {
    const localPlugin = () => undefined;
    const result = createMdxOptions({ remarkPlugins: [localPlugin] });

    expect(result.remarkPlugins?.at(-1)).toBe(localPlugin);
    expect(result.remarkPlugins).toHaveLength((mdxOptions.remarkPlugins?.length ?? 0) + 1);
  });
});
