import { createRequire } from "node:module";
import type { Config } from "jest";

const require = createRequire(import.meta.url);

export function createJestConfig(overrides: Config = {}): Config {
  return {
    testEnvironment: "node",
    testMatch: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
    moduleNameMapper: {
      "^(\\.{1,2}/.*)\\.js$": "$1",
      ...(overrides.moduleNameMapper ?? {}),
    },
    transform: {
      "^.+\\.[cm]?[tj]sx?$": [
        require.resolve("@swc/jest"),
        {
          jsc: {
            parser: {
              syntax: "typescript",
              tsx: true,
            },
            transform: {
              react: {
                runtime: "automatic",
              },
            },
            target: "es2022",
          },
          module: {
            type: "commonjs",
          },
        },
      ],
      ...(overrides.transform ?? {}),
    },
    ...overrides,
  };
}
