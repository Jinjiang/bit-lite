import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["targets/test/vitest/**/*.test.ts"],
    watch: false,
  },
});
