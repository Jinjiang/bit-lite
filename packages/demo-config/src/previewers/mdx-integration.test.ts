import { readFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@mdx-js/mdx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Plugin, UserConfig } from "vite";
import webpack, { type Configuration, type Stats } from "webpack";
import { DefaultDocsTemplate } from "bit-lite-preview/browser";
import { createMdxOptions } from "demo-utils";
import DemoDocsTemplate from "./docs-template.js";
import viteStaticConfig from "./vite-static.js";
import webpackReactConfig from "./webpack-react.js";
import { describe, expect, it } from "vitest";

const fixtureFile = fileURLToPath(new URL("./fixtures/shared.docs.mdx", import.meta.url));
const fixtureDir = path.dirname(fixtureFile);

describe("shared MDX integrations", () => {
  it("compiles the same frontmatter, Markdown, and JSX fixture through Vite and Webpack", async () => {
    const source = await readFile(fixtureFile, "utf8");
    const viteResult = await compileWithViteConfig(viteStaticConfig as UserConfig, source);
    const webpackResult = await compileWithWebpack(webpackReactConfig);
    expect(viteResult.code).toContain("frontmatter");
    expect(viteResult.code).toContain("Shared MDX fixture");
    expect(viteResult.code).toContain("data-docs-fixture");
    expect(webpackResult).toContain("Shared MDX fixture");
    expect(webpackResult).toContain("data-docs-fixture");
  }, 30_000);

  it("renders both the minimal and custom docs-only template contracts", () => {
    const docs = {
      default: () => createElement("p", undefined, "Compiled documentation"),
      frontmatter: { title: "Fixture title" },
    };
    expect(renderToStaticMarkup(createElement(DefaultDocsTemplate, { docs }))).toContain("Compiled documentation");
    const custom = renderToStaticMarkup(createElement(DemoDocsTemplate, { docs }));
    expect(custom).toContain("Fixture title");
    expect(custom).toContain("Compiled documentation");
  });

  it("fails explicitly without the Webpack MDX integration", async () => {
    await expect(compileWithWebpack({ mode: "development" })).rejects.toThrow(/Module parse failed|Unexpected token/);
  });

  it("surfaces a throwing shared or local MDX plugin", async () => {
    const source = await readFile(fixtureFile, "utf8");
    const throwingPlugin = () => {
      throw new Error("intentional MDX plugin failure");
    };
    expect(() => compile(source, createMdxOptions({ remarkPlugins: [throwingPlugin] }))).toThrow(
      "intentional MDX plugin failure"
    );
  });
});

async function compileWithWebpack(config: Configuration) {
  const outputPath = await mkdtemp(path.join(os.tmpdir(), "bit-lite-mdx-webpack-"));
  const compiler = webpack({
    ...config,
    mode: "development",
    context: fixtureDir,
    entry: "./shared.docs.mdx",
    output: { path: outputPath, filename: "fixture.js" },
    optimization: { ...(config.optimization ?? {}), minimize: false, usedExports: false },
  });
  if (!compiler) throw new Error("Webpack did not create a compiler");

  await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close(() => undefined);
      if (error) reject(error);
      else if (!result) reject(new Error("Webpack returned no stats"));
      else if (result.hasErrors()) reject(new Error(result.toString("errors-only")));
      else resolve(result);
    });
  });
  return readFile(path.join(outputPath, "fixture.js"), "utf8");
}

async function compileWithViteConfig(config: UserConfig, source: string) {
  const plugins = (config.plugins ?? []).flat(Infinity) as Plugin[];
  const mdxPlugin = plugins.find((plugin) => plugin?.name === "@mdx-js/rollup");
  if (!mdxPlugin || typeof mdxPlugin.transform !== "function") {
    throw new Error("Maintained Vite config is missing the native MDX plugin");
  }
  if (typeof mdxPlugin.config === "function") {
    await mdxPlugin.config({}, { command: "serve", mode: "development", isSsrBuild: false, isPreview: false });
  }
  const result = await mdxPlugin.transform.call({} as never, source, fixtureFile);
  if (!result || typeof result === "string") throw new Error("Vite MDX plugin did not emit compiled code");
  return result;
}
