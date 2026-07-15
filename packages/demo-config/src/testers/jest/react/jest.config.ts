import { createRequire } from "node:module";
import { createJestConfig } from "../base.js";

const require = createRequire(import.meta.url);

const config = createJestConfig({
  testEnvironment: require.resolve("jest-environment-jsdom"),
  transformIgnorePatterns: ["/node_modules/(?!@my-scope/)"],
});

export default config;
