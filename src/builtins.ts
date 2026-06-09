import { createRequire } from "node:module";
import path from "node:path";
import { findFilesByKind } from "./file-matcher.js";
import type { BitLiteService, ServiceFactory } from "./types.js";
import { runNodeScript } from "./process.js";
import { createPreviewService } from "./preview.js";

const require = createRequire(import.meta.url);

export const builtinServices: Record<string, ServiceFactory> = {
  preview: createPreviewService,
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
    scope: "workspace",
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
        message: exitCode === 0 ? "typescript passed" : "typescript failed",
      };
    },
  }),
  test: (config) => ({
    name: "test",
    async run(context) {
      const serviceConfig = {
        ...readObjectConfig(config),
        ...readObjectConfig(context.serviceConfig),
      };
      const args = await readTestArgs(serviceConfig, context.components);
      const vitestPath = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
      const runOptions = {
        cwd: context.workspaceRoot,
        args,
        ...(typeof serviceConfig.outputPrefix === "string" ? { outputPrefix: serviceConfig.outputPrefix } : {}),
        ...(serviceConfig.watch === true ? { preserveOutputTty: true } : {}),
        ...(serviceConfig.signal instanceof AbortSignal ? { signal: serviceConfig.signal } : {}),
      };
      const exitCode = await runNodeScript(vitestPath, runOptions);
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

async function readTestArgs(config: Record<string, unknown>, components: Array<{ rootDir: string }>) {
  const configuredArgs = Array.isArray(config.args) ? config.args.filter(isString) : [];
  const testFiles = await findTestFiles(components);
  const modeArgs = config.watch === true ? ["watch"] : configuredArgs.length ? configuredArgs : ["run"];
  return [...modeArgs, ...testFiles];
}

async function findTestFiles(components: Array<{ rootDir: string }>) {
  const files = await Promise.all(
    components.map(async (component) => {
      const testFiles = await findFilesByKind(component.rootDir, "test");
      const specFiles = await findFilesByKind(component.rootDir, "spec");
      return [...testFiles, ...specFiles];
    })
  );
  return files.flat().sort();
}
