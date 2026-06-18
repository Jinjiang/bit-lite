import { createRequire } from "node:module";
import { findFilesByKind } from "../../../utils/file-matcher.js";
import { runNodeScript } from "../../../utils/process.js";
import { createServiceTask } from "../../../runtime.js";
import { readObjectConfig } from "../../../service-config.js";
import { serviceResult } from "../../../utils/service-result.js";
import type { TestVendor } from "../../../types/services/test.js";

const require = createRequire(import.meta.url);

export const mochaTestVendor: TestVendor = {
  name: "mocha",
  run(input, context) {
    let writeStdin: ((chunk: Buffer | string) => void) | undefined;
    return createServiceTask(async ({ signal, emit }) => {
      const workspaceRoot = requireWorkspaceRoot(context);
      const testFiles = await findTestFiles(input.components);
      if (testFiles.length === 0) {
        const message = `no test files found for ${context?.envName}`;
        emit("output", { stream: "stdout", chunk: `${message}\n` });
        return serviceResult({
          ok: true,
          toJSON: () => ({
            vendor: "mocha",
            envName: context?.envName,
            files: 0,
            tests: 0,
          }),
          toString: () => message,
        });
      }

      const config = readObjectConfig(input.config);
      const mochaPath = require.resolve("mocha/bin/mocha.js");
      const tsxLoader = require.resolve("tsx");
      const watch = input.args.watch === true;
      const args = [
        "--node-option",
        `import=${tsxLoader}`,
        ...(watch ? ["--watch"] : []),
        ...readStringArray(config.args),
        ...testFiles,
      ];
      emit("status", {
        status: "running",
        message: watch ? `watching mocha tests for ${context?.envName}` : `running mocha tests for ${context?.envName}`,
      });
      const exitCode = await runNodeScript(mochaPath, {
        cwd: workspaceRoot,
        args,
        tty: watch,
        stdin: watch ? "pipe" : "ignore",
        onProcess: (process) => {
          writeStdin = process.writeStdin;
        },
        onOutput: (stream, chunk) => emit("output", { stream, chunk }),
        signal,
      });
      const result = {
        ...serviceResult({
          ok: exitCode === 0,
          toJSON: () => ({
            vendor: "mocha",
            envName: context?.envName,
          }),
          toString: () =>
            exitCode === 0 ? `mocha tests passed for ${context?.envName}` : `mocha tests failed for ${context?.envName}`,
        }),
      };
      emit("status", { status: result.ok ? "passed" : "failed", message: result.toString() });
      emit("result", result);
      return result;
    }, (type, payload) => {
      if (type === "stdin") writeStdin?.(readStdinPayload(payload));
    });
  },
};

export default mochaTestVendor;

function requireWorkspaceRoot(context: { workspaceRoot?: string } | undefined) {
  if (!context?.workspaceRoot) throw new Error("test requires workspaceRoot in context");
  return context.workspaceRoot;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
