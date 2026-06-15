import { createRequire } from "node:module";
import path from "node:path";
import { findFilesByKind } from "../../../file-matcher.js";
import { runNodeScript } from "../../../process.js";
import { readObjectConfig } from "../../../service-config.js";
import { createServiceTask } from "../../../runtime.js";
import type { TestVendor } from "../types.js";

const require = createRequire(import.meta.url);

export const vitestTestVendor: TestVendor = {
  name: "vitest",
  run(input, context) {
    let writeStdin: ((chunk: Buffer | string) => void) | undefined;
    return createServiceTask(async ({ signal, emit }) => {
      const workspaceRoot = requireWorkspaceRoot(context);
      const config = readObjectConfig(input.config);
      const testFiles = await findTestFiles(input.components);
      if (testFiles.length === 0) {
        const message = `no test files found for ${context?.envName}`;
        emit("output", { stream: "stdout", chunk: `${message}\n` });
        emit("result", { ok: true, message });
        return { ok: true, message };
      }

      const watch = input.args.watch === true;
      const args = readVitestArgs(config, watch, testFiles);
      const vitestPath = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
      emit("status", {
        status: "running",
        message: watch ? `watching tests for ${context?.envName}` : `running tests for ${context?.envName}`,
      });
      const exitCode = await runNodeScript(vitestPath, {
        cwd: workspaceRoot,
        args,
        tty: watch,
        stdin: watch ? "pipe" : "ignore",
        onProcess: (process) => {
          writeStdin = process.writeStdin;
        },
        ...(typeof config.outputPrefix === "string" ? { outputPrefix: config.outputPrefix } : {}),
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
    }, (type, payload) => {
      if (type === "stdin") writeStdin?.(readStdinPayload(payload));
    });
  },
};

export default vitestTestVendor;

function requireWorkspaceRoot(context: { workspaceRoot?: string } | undefined) {
  if (!context?.workspaceRoot) throw new Error("test requires workspaceRoot in context");
  return context.workspaceRoot;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function readVitestArgs(config: Record<string, unknown>, watch: boolean, testFiles: string[]) {
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

function readStdinPayload(payload: unknown) {
  if (Buffer.isBuffer(payload)) return payload;
  return typeof payload === "string" ? payload : "";
}
