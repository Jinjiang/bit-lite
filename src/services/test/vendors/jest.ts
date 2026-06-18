import { watch as watchDirectory, type FSWatcher } from "node:fs";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { buildArgv, runCLI } from "jest";
import { findFilesByKind } from "../../../utils/file-matcher.js";
import { createServiceTask } from "../../../runtime.js";
import { readObjectConfig } from "../../../service-config.js";
import { serviceResult } from "../../../utils/service-result.js";
import type { AggregatedResult, AssertionResult, TestResult as JestSuiteResult } from "@jest/test-result";
import type { Config } from "@jest/types";
import type { ComponentRef } from "../../../types/index.js";
import type { TestResult, TestResultJson, TestSuiteResultJson, TestVendor } from "../../../types/services/test.js";

const require = createRequire(import.meta.url);

export const jestTestVendor: TestVendor = {
  name: "jest",
  run(input, context) {
    let handleStdin: ((payload: unknown) => void) | undefined;
    return createServiceTask(async ({ signal, emit }) => {
      const workspaceRoot = requireWorkspaceRoot(context);
      const testFiles = await findTestFiles(input.components);
      if (testFiles.length === 0) {
        const message = `no test files found for ${context?.envName}`;
        emit("output", { stream: "stdout", chunk: `${message}\n` });
        const result = serviceResult({
          ok: true,
          toJSON: () => ({
            vendor: "jest",
            envName: context?.envName,
            files: 0,
            tests: 0,
          }),
          toString: () => message,
        });
        emit("result", result);
        return result;
      }

      const config = readObjectConfig(input.config);
      const configPath = await writeJestConfig(workspaceRoot, require.resolve("typescript"));
      const watch = input.args.watch === true;
      if (!watch) {
        return runJestOnce({
          workspaceRoot,
          config,
          configPath,
          testFiles,
          envName: context?.envName,
          emit,
        });
      }

      let latestResult: TestResult | undefined;
      let running: Promise<void> | undefined;
      let pending = false;
      let stop: (() => void) | undefined;
      const stopped = new Promise<void>((resolve) => {
        stop = resolve;
      });
      const watchers = await watchComponentRoots(input.components, () => scheduleRun("file change"));

      handleStdin = (payload) => {
        const value = readStdinPayload(payload).toString("utf8");
        if (value.includes("\u0003") || value === "q") {
          stop?.();
          return;
        }
        if (value === "\r" || value === "\n" || value === "r") {
          scheduleRun("manual rerun");
        }
      };

      emit("status", {
        status: "running",
        message: `watching jest tests for ${context?.envName}`,
      });
      scheduleRun("initial run");
      await Promise.race([waitForAbort(signal), stopped]);
      closeWatchers(watchers);
      if (running) await running;
      const result = latestResult ?? stoppedJestResult(context?.envName);
      emit("status", { status: result.ok ? "passed" : "failed", message: result.toString() });
      emit("result", result);
      return result;

      function scheduleRun(reason: string) {
        pending = true;
        if (!running) {
          running = runQueued(reason).finally(() => {
            running = undefined;
          });
        }
      }

      async function runQueued(reason: string) {
        while (pending && !signal.aborted) {
          pending = false;
          latestResult = await runJestOnce({
            workspaceRoot,
            config,
            configPath,
            testFiles,
            envName: context?.envName,
            emit,
            reason,
            continuous: true,
          });
        }
      }
    }, (type, payload) => {
      if (type === "stdin") handleStdin?.(payload);
    });
  },
};

export default jestTestVendor;

function requireWorkspaceRoot(context: { workspaceRoot?: string } | undefined) {
  if (!context?.workspaceRoot) throw new Error("test requires workspaceRoot in context");
  return context.workspaceRoot;
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

type RunJestOnceOptions = {
  workspaceRoot: string;
  config: Record<string, unknown>;
  configPath: string;
  testFiles: string[];
  envName?: string | undefined;
  emit(type: string, payload: unknown): void;
  reason?: string;
  continuous?: boolean;
};

async function runJestOnce(options: RunJestOnceOptions): Promise<TestResult> {
  options.emit("status", {
    status: "running",
    message: options.reason
      ? `running jest tests for ${options.envName} (${options.reason})`
      : `running jest tests for ${options.envName}`,
  });
  try {
    const { results } = await runCLI(await readJestArgv(options.config, options.configPath, options.testFiles), [
      options.configPath,
    ]);
    const result = createJestResult(results, options.envName);
    options.emit("output", { stream: "stdout", chunk: `${formatJestOutput(results, options.workspaceRoot)}\n` });
    options.emit("status", {
      status: options.continuous && result.ok ? "running" : result.ok ? "passed" : "failed",
      message: result.toString(),
    });
    options.emit("result", result);
    return result;
  } catch (error) {
    const result = createJestErrorResult(error, options.envName);
    options.emit("output", { stream: "stderr", chunk: `${formatError(error)}\n` });
    options.emit("status", { status: "failed", message: result.toString() });
    options.emit("result", result);
    return result;
  }
}

async function readJestArgv(
  config: Record<string, unknown>,
  configPath: string,
  testFiles: string[]
): Promise<Config.Argv> {
  const parsedArgv = await buildArgv(["--config", configPath, "--runTestsByPath", ...testFiles, "--runInBand"]);
  const argv = readObjectConfig(config.argv) as Partial<Config.Argv>;
  return {
    ...parsedArgv,
    ...argv,
    silent: true,
    watch: false,
    watchAll: false,
  } as Config.Argv;
}

function createJestResult(results: AggregatedResult, envName: string | undefined): TestResult {
  const failed = results.numFailedTests + results.numRuntimeErrorTestSuites;
  const skipped = results.numPendingTests + results.numTodoTests;
  return {
    ...serviceResult({
      ok: results.success,
      toJSON: (): TestResultJson => ({
        vendor: "jest",
        envName,
        files: results.numTotalTestSuites,
        tests: results.numTotalTests,
        passed: results.numPassedTests,
        failed,
        skipped,
        durationMs: readDuration(results),
        suites: results.testResults.map(mapSuiteResult),
      }),
      toString: () =>
        results.success
          ? `jest tests passed for ${envName} (${results.numTotalTestSuites} files, ${results.numTotalTests} tests)`
          : `jest tests failed for ${envName} (${results.numFailedTestSuites} files, ${failed} tests failed)`,
    }),
    files: results.numTotalTestSuites,
    tests: results.numTotalTests,
    passed: results.numPassedTests,
    failed,
    skipped,
  };
}

function createJestErrorResult(error: unknown, envName: string | undefined): TestResult {
  let message: string | undefined;
  const readMessage = () => {
    message ??= formatError(error);
    return message;
  };
  return {
    ...serviceResult({
      ok: false,
      toJSON: () => ({
        vendor: "jest",
        envName,
        error: readMessage(),
      }),
      toString: () => `jest tests failed for ${envName}: ${readMessage()}`,
    }),
    failed: 1,
  };
}

function stoppedJestResult(envName: string | undefined): TestResult {
  return {
    ...serviceResult({
      ok: true,
      toJSON: () => ({
        vendor: "jest",
        envName,
        files: 0,
        tests: 0,
      }),
      toString: () => `jest tests ended for ${envName}`,
    }),
    files: 0,
    tests: 0,
  };
}

function mapSuiteResult(suite: JestSuiteResult): TestSuiteResultJson {
  const failed = suite.numFailingTests > 0 || Boolean(suite.testExecError);
  const status: TestSuiteResultJson["status"] = suite.skipped ? "skipped" : failed ? "failed" : "passed";
  return {
    file: suite.testFilePath,
    status,
    durationMs: suite.perfStats.end - suite.perfStats.start,
    tests: suite.testResults.map(mapAssertionResult),
    ...(suite.failureMessage ? { failureMessage: suite.failureMessage } : {}),
  };
}

function mapAssertionResult(assertion: AssertionResult) {
  return {
    title: assertion.title,
    fullName: assertion.fullName,
    status: assertion.status,
    ...(typeof assertion.duration === "number" ? { durationMs: assertion.duration } : {}),
    ...(assertion.failureMessages.length > 0 ? { failureMessages: assertion.failureMessages } : {}),
  };
}

function readDuration(results: AggregatedResult) {
  const end = Math.max(results.startTime, ...results.testResults.map((result) => result.perfStats.end));
  return end - results.startTime;
}

function formatJestOutput(results: AggregatedResult, workspaceRoot: string) {
  const lines: string[] = [];
  for (const suite of results.testResults) {
    lines.push(`${formatSuiteStatus(suite)} ${path.relative(workspaceRoot, suite.testFilePath)}`);
    for (const assertion of suite.testResults) {
      lines.push(`  ${formatAssertionStatus(assertion)} ${assertion.fullName}`);
    }
    if (suite.failureMessage) {
      lines.push(indent(suite.failureMessage.trimEnd(), "  "));
    }
  }
  lines.push("");
  lines.push(
    `Test Suites: ${formatCounts([
      [results.numFailedTestSuites, "failed"],
      [results.numPassedTestSuites, "passed"],
      [results.numTotalTestSuites, "total"],
    ])}`
  );
  lines.push(
    `Tests: ${formatCounts([
      [results.numFailedTests, "failed"],
      [results.numPendingTests + results.numTodoTests, "skipped"],
      [results.numPassedTests, "passed"],
      [results.numTotalTests, "total"],
    ])}`
  );
  lines.push(`Time: ${(readDuration(results) / 1000).toFixed(3)} s`);
  return lines.join("\n");
}

function formatSuiteStatus(suite: JestSuiteResult) {
  if (suite.skipped) return "SKIP";
  if (suite.numFailingTests > 0 || suite.testExecError) return "FAIL";
  return "PASS";
}

function formatAssertionStatus(assertion: AssertionResult) {
  if (assertion.status === "passed") return "PASS";
  if (assertion.status === "pending" || assertion.status === "todo") return "SKIP";
  return "FAIL";
}

function formatCounts(counts: Array<[number, string]>) {
  return counts
    .filter(([count, label]) => count > 0 || label === "total")
    .map(([count, label]) => `${count} ${label}`)
    .join(", ");
}

async function watchComponentRoots(components: ComponentRef[], onChange: () => void) {
  const directories = new Set<string>();
  for (const component of components) {
    for (const directory of await collectDirectories(component.rootDir)) {
      directories.add(directory);
    }
  }
  const watchers: FSWatcher[] = [];
  for (const directory of directories) {
    try {
      watchers.push(watchDirectory(directory, { persistent: false }, debounce(onChange, 100)));
    } catch {
      // Ignore directories that disappear while watch mode is starting.
    }
  }
  return watchers;
}

async function collectDirectories(root: string): Promise<string[]> {
  const directories = [root];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return directories;
  }
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
      .map((entry) => collectDirectories(path.join(root, entry.name)))
  );
  return [...directories, ...nested.flat()];
}

function closeWatchers(watchers: FSWatcher[]) {
  for (const watcher of watchers) {
    watcher.close();
  }
}

function debounce(callback: () => void, delay: number) {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(callback, delay);
  };
}

function indent(value: string, prefix: string) {
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function formatError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function waitForAbort(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

async function writeJestConfig(workspaceRoot: string, typescriptPath: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-jest-"));
  const transformerPath = path.join(tempRoot, "ts-transformer.cjs");
  const configPath = path.join(tempRoot, "jest.config.cjs");
  await writeFile(transformerPath, renderJestTransformer(typescriptPath), "utf8");
  await writeFile(
    configPath,
    `module.exports = ${JSON.stringify(
      {
        rootDir: workspaceRoot,
        testEnvironment: "node",
        transform: {
          "^.+\\.tsx?$": transformerPath,
        },
        reporters: [],
        moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
      },
      null,
      2
    )};\n`,
    "utf8"
  );
  return configPath;
}

function renderJestTransformer(typescriptPath: string) {
  return `const ts = require(${JSON.stringify(typescriptPath)});

module.exports = {
  process(source, filename) {
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        jsx: ts.JsxEmit.ReactJSX
      }
    });
    return { code: output.outputText.replace(/require\\((["'])(\\.{1,2}\\/[^"']+)\\.js\\1\\)/g, 'require($1$2.ts$1)') };
  }
};
`;
}

function readStdinPayload(payload: unknown) {
  if (Buffer.isBuffer(payload)) return payload;
  return typeof payload === "string" ? payload : "";
}
