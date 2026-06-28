import { defineConfig } from "@playwright/test";

export default defineConfig({
  outputDir: "../results/playwright",
  reporter: "json",
  testDir: "../targets/test/playwright",
  workers: 1,
});
