import { findFilesByKind } from "../../../file-matcher.js";
import { createServiceTask } from "../../../runtime.js";
import type { TestResult, TestVendor } from "../types.js";

export const filelistTestVendor: TestVendor = {
  name: "filelist",
  run(input, context) {
    return createServiceTask(async ({ signal, emit }) => {
      const files = await findTestFiles(input.components);
      const message =
        files.length === 0
          ? `filelist found no test files for ${context?.envName}`
          : `filelist found ${files.length} test file${files.length === 1 ? "" : "s"} for ${context?.envName}`;
      const output = [message, ...files.map((file) => `- ${file}`)].join("\n");
      const result: TestResult = {
        ok: true,
        message,
        files: files.length,
        tests: files.length,
        passed: files.length,
        failed: 0,
      };
      emit("output", { stream: "stdout", chunk: `${output}\n` });
      emit("status", { status: "passed", message });
      emit("result", result);

      if (input.args.watch) {
        emit("status", { status: "running", message: `watching filelist tests for ${context?.envName}` });
        await waitForAbort(signal);
        emit("status", { status: "stopped", message: `stopped filelist tests for ${context?.envName}` });
      }

      return result;
    });
  },
};

export default filelistTestVendor;

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

function waitForAbort(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
