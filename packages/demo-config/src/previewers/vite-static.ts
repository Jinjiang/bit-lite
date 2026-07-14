import { createRequire } from "node:module";
import path from "node:path";
import mdx from "@mdx-js/rollup";
import { mdxOptions } from "demo-utils";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [mdx({ ...mdxOptions, include: /\.docs\.mdx?$/ })],
  resolve: {
    alias: {
      react: path.dirname(require.resolve("react")),
      "react-dom": path.dirname(require.resolve("react-dom")),
    },
    dedupe: ["react", "react-dom"],
  },
});
