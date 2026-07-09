import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
});
