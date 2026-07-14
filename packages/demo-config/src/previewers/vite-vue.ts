import mdx from "@mdx-js/rollup";
import vue from "@vitejs/plugin-vue";
import { mdxOptions } from "demo-utils";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [mdx({ ...mdxOptions, include: /\.docs\.mdx?$/ }), vue()],
  optimizeDeps: {
    include: ["vue"],
  },
});
