import { createRequire } from "node:module";
import path from "node:path";
import type { BitLiteService, ServiceFactory } from "./types.js";
import { runNodeScript } from "./process.js";

const require = createRequire(import.meta.url);

export const builtinServices: Record<string, ServiceFactory> = {
  inspect: (config) => ({
    name: "inspect",
    async run(context) {
      return {
        ok: true,
        message: JSON.stringify(
          {
            workspaceRoot: context.workspaceRoot,
            envName: context.envName,
            serviceConfig: config,
            components: context.components,
          },
          null,
          2
        ),
      };
    },
  }),
  typescript: (config) => ({
    name: "typescript",
    async run(context) {
      const serviceConfig = readObjectConfig(config);
      const tsconfig = typeof serviceConfig.tsconfig === "string" ? serviceConfig.tsconfig : "tsconfig.json";
      const tscPath = require.resolve("typescript/bin/tsc");
      const exitCode = await runNodeScript(tscPath, {
        cwd: context.workspaceRoot,
        args: ["-p", path.resolve(context.workspaceRoot, tsconfig)],
      });
      return {
        ok: exitCode === 0,
        message: exitCode === 0 ? `typescript passed for ${context.envName}` : `typescript failed for ${context.envName}`,
      };
    },
  }),
  test: (config) => ({
    name: "test",
    async run(context) {
      const serviceConfig = readObjectConfig(config);
      const args = Array.isArray(serviceConfig.args) ? serviceConfig.args.filter(isString) : ["run"];
      const vitestPath = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
      const exitCode = await runNodeScript(vitestPath, {
        cwd: context.workspaceRoot,
        args,
      });
      return {
        ok: exitCode === 0,
        message: exitCode === 0 ? `tests passed for ${context.envName}` : `tests failed for ${context.envName}`,
      };
    },
  }),
};

export function isBitLiteService(value: unknown): value is BitLiteService {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BitLiteService>;
  return typeof candidate.name === "string" && typeof candidate.run === "function";
}

function readObjectConfig(config: unknown): Record<string, unknown> {
  if (typeof config === "object" && config !== null && !Array.isArray(config)) return config as Record<string, unknown>;
  return {};
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
