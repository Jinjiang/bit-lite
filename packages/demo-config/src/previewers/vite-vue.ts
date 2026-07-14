import { createRequire } from "node:module";
import path from "node:path";
import mdx from "@mdx-js/rollup";
import vue from "@vitejs/plugin-vue";
import { mdxOptions } from "demo-utils";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [mdx({ ...mdxOptions, include: /\.docs\.mdx?$/ }), vue()],
  resolve: {
    alias: {
      react: path.dirname(require.resolve("react")),
      "react-dom": path.dirname(require.resolve("react-dom")),
      vue: path.dirname(require.resolve("vue")),
    },
    dedupe: ["react", "react-dom", "vue"],
  },
  optimizeDeps: {
    include: ["vue"],
  },
});
