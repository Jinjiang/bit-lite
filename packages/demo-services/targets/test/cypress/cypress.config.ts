import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    specPattern: "e2e/**/*.cy.ts",
    supportFile: false,
  },
  screenshotsFolder: "../../../results/cypress/screenshots",
  videosFolder: "../../../results/cypress/videos",
  video: false,
});
