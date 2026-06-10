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
    async run(context) {
      const serviceConfig = readObjectConfig(config);
      const tsconfig = typeof serviceConfig.tsconfig === "string" ? serviceConfig.tsconfig : "tsconfig.json";
      const tscPath = require.resolve("typescript/bin/tsc");
      const exitCode = await runNodeScript(tscPath, {
        cwd: context.workspaceRoot,
        args: ["-p", path.resolve(context.workspaceRoot, tsconfig)],
        ...(context.host.outputMode === "capture"
          ? { onOutput: (stream: "stdout" | "stderr", chunk: string) => context.host.emit({ type: "output", stream, chunk }) }
          : {}),
        signal: context.host.signal,
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
      const serviceConfig = {
        ...readObjectConfig(config),
        ...readObjectConfig(context.serviceConfig),
      };
      const testFiles = await findTestFiles(context.components);
      if (testFiles.length === 0) {
        const message = `no test files found for ${context.envName}`;
        context.host.emit({ type: "output", stream: "stdout", chunk: `${message}\n` });
        return { ok: true, message };
      }
      const watch = serviceConfig.watch === true;
      const args = readTestArgs(serviceConfig, watch, testFiles);
      const vitestPath = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
      const runOptions = {
        cwd: context.workspaceRoot,
        args,
        ...(typeof serviceConfig.outputPrefix === "string" ? { outputPrefix: serviceConfig.outputPrefix } : {}),
        ...(watch && context.host.outputMode === "inherit" ? { preserveOutputTty: true } : {}),
        ...(context.host.outputMode === "capture"
          ? { onOutput: (stream: "stdout" | "stderr", chunk: string) => context.host.emit({ type: "output", stream, chunk }) }
          : {}),
        signal: context.host.signal,
      };
      context.host.emit({
        type: "status",
        status: "running",
        message: watch ? `watching tests for ${context.envName}` : `running tests for ${context.envName}`,
      });
      const exitCode = await runNodeScript(vitestPath, runOptions);
      context.host.emit({
        type: "status",
        status: exitCode === 0 ? "passed" : "failed",
        message: exitCode === 0 ? `tests passed for ${context.envName}` : `tests failed for ${context.envName}`,
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

function readTestArgs(config: Record<string, unknown>, watch: boolean, testFiles: string[]) {
  const configuredArgs = Array.isArray(config.args) ? config.args.filter(isString) : [];
  const modeArgs = watch ? ["watch"] : configuredArgs.length ? configuredArgs : ["run"];
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
