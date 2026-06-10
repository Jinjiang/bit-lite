import { createRequire } from "node:module";
import path from "node:path";
import { findFilesByKind } from "./file-matcher.js";
import type { BitLiteService, ServiceDefinition, ServiceFactory } from "./types.js";
import { runNodeScript } from "./process.js";
import { createPreviewService } from "./preview.js";
import { createServiceTask } from "./runtime.js";

const require = createRequire(import.meta.url);

export const builtinServiceDefinitions: Record<string, ServiceDefinition> = {
  preview: {
    factory: createPreviewService,
  },
  inspect: {
    factory: () => ({
      name: "inspect",
      run(input, context) {
        return createServiceTask(async () => ({
          ok: true,
          message: JSON.stringify(
            {
              workspaceRoot: context?.workspaceRoot,
              envName: context?.envName,
              serviceConfig: input.config,
              components: input.components,
            },
            null,
            2
          ),
        }));
      },
    }),
  },
  typescript: {
    factory: () => ({
      name: "typescript",
      run(input, context) {
        return createServiceTask(async ({ signal, emit }) => {
          const workspaceRoot = requireWorkspaceRoot(context);
          rejectCliArgs(input.args, "typescript");
          const serviceConfig = readObjectConfig(input.config);
          const tsconfig = typeof serviceConfig.tsconfig === "string" ? serviceConfig.tsconfig : "tsconfig.json";
          const tscPath = require.resolve("typescript/bin/tsc");
          const exitCode = await runNodeScript(tscPath, {
            cwd: workspaceRoot,
            args: ["-p", path.resolve(workspaceRoot, tsconfig)],
            onOutput: (stream, chunk) => emit("output", { stream, chunk }),
            signal,
          });
          return {
            ok: exitCode === 0,
            message: exitCode === 0 ? `typescript passed for ${context?.envName}` : `typescript failed for ${context?.envName}`,
          };
        });
      },
    }),
  },
  test: {
    factory: () => ({
      name: "test",
      run(input, context) {
        return createServiceTask(async ({ signal, emit }) => {
          const workspaceRoot = requireWorkspaceRoot(context);
          const serviceConfig = readObjectConfig(input.config);
          const serviceArgs = readTestServiceArgs(input.args);
          const testFiles = await findTestFiles(input.components);
          if (testFiles.length === 0) {
            const message = `no test files found for ${context?.envName}`;
            emit("output", { stream: "stdout", chunk: `${message}\n` });
            emit("result", { ok: true, message });
            return { ok: true, message };
          }
          const watch = serviceArgs.watch === true;
          const args = readTestArgs(serviceConfig, watch, testFiles);
          const vitestPath = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
          emit("status", {
            status: "running",
            message: watch ? `watching tests for ${context?.envName}` : `running tests for ${context?.envName}`,
          });
          const exitCode = await runNodeScript(vitestPath, {
            cwd: workspaceRoot,
            args,
            ...(typeof serviceConfig.outputPrefix === "string" ? { outputPrefix: serviceConfig.outputPrefix } : {}),
            onOutput: (stream, chunk) => emit("output", { stream, chunk }),
            signal,
          });
          const result = {
            ok: exitCode === 0,
            message: exitCode === 0 ? `tests passed for ${context?.envName}` : `tests failed for ${context?.envName}`,
          };
          emit("status", {
            status: result.ok ? "passed" : "failed",
            message: result.message,
          });
          emit("result", result);
          return result;
        });
      },
    }),
  },
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

function readTestServiceArgs(args: unknown) {
  if (Array.isArray(args)) {
    return parseTestCliArgs(args);
  }
  return readObjectConfig(args);
}

function rejectCliArgs(args: unknown, serviceName: string) {
  if (!Array.isArray(args) || args.length === 0) return;
  throw new Error(`service "${serviceName}" does not accept arguments: ${args.map(String).join(" ")}`);
}

function parseTestCliArgs(args: unknown[]) {
  const parsed: { watch?: boolean } = {};
  for (const arg of args) {
    if (arg === "--watch") {
      parsed.watch = true;
      continue;
    }
    throw new Error(`unknown test argument "${String(arg)}"`);
  }
  return parsed;
}

function requireWorkspaceRoot(context: { workspaceRoot?: string } | undefined) {
  if (!context?.workspaceRoot) throw new Error("service requires workspaceRoot in context");
  return context.workspaceRoot;
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
