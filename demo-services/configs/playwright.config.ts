import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: "json",
  testDir: "../targets/test/playwright",
  workers: 1,
});
