import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { VendorDefinition, VendorRuntime, VendorStartResult } from "bit-lite-vendors";
import { readTestVendorConfig } from "../config.js";
import { findComponentTestTargets } from "../files.js";
import type { ComponentTestTarget } from "../files.js";
import {
  addFileLoadFailure,
  createEmptyComponentResults,
  createTestServiceResult,
  finishComponentResults,
  formatError,
  type MutableComponentResult,
  type TestServiceResult,
} from "../result.js";
import { registerJestWatchReporter, unregisterJestWatchReporter } from "./reporter.js";
import { isShutdownMessage } from "../vendor-utils.js";

export const meta: VendorDefinition = {
  id: "jest",
  label: "Jest",
  hint: "Run component tests with Jest",
  moduleUrl: import.meta.url,
};

type JestAssertionResult = {
  status?: string;
  failureMessages?: string[];
};

type JestTestResult = {
  testFilePath: string;
  numPassingTests?: number;
  numFailingTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  perfStats?: {
    start?: number;
    end?: number;
    runtime?: number;
  };
  failureMessage?: string | null;
  testExecError?: unknown;
  testResults?: JestAssertionResult[];
};

type JestAggregatedResult = {
  testResults: JestTestResult[];
  wasInterrupted?: boolean;
};

type JestRunCLI = (
  argv: Record<string, unknown>,
  projects: string[]
) => Promise<{ results: JestAggregatedResult }>;

export default async function startJestVendor(
  runtime: VendorRuntime<Record<string, unknown>, TestServiceResult>
): Promise<VendorStartResult<TestServiceResult>> {
  const workspaceRoot = runtime.data.context?.workspaceRoot ?? process.cwd();
  const watch = runtime.data.args.options.watch === true && isInteractiveTerminal();
  const mode = watch ? "watch" : "run";
  let run = 0;
  let stopped = false;
  let watchPromise: Promise<void> | undefined;
  let stopJestWatch: (() => void) | undefined;
  let stoppingWatch: Promise<void> | undefined;

  const finish = (status: string) => {
    if (stopped) return;
    stopped = true;
    runtime.postMessage({ type: "status", status });
  };

  const unsubscribe = runtime.onMessage(async (message) => {
    if (isShutdownMessage(message)) {
      await stopWatch();
    }
  });

  runtime.postMessage({ type: "ready" });

  if (watch) {
    runtime.postMessage({ type: "status", status: "watching" });
    watchPromise = runWatch().catch((error) => {
      runtime.postMessage({ type: "error", message: formatError(error) });
      finish("error");
    });
    return {
      async stop() {
        await stopWatch();
      },
    };
  }

  const data = await runSnapshot();
  finish(data.stats.failed > 0 ? "failed" : "success");
  unsubscribe();
  return { data };

  async function runSnapshot(): Promise<TestServiceResult> {
    run += 1;
    runtime.postMessage({ type: "status", status: "running" });

    const vendorConfig = readTestVendorConfig(runtime.data.config, workspaceRoot);
    const targets = await findComponentTestTargets(runtime.data.components);
    const runTargets = await realpathTargets(targets);
    const componentResults = createEmptyComponentResults(targets);
    const allFiles = runTargets.flatMap((target) => target.files);
    const jestResult = allFiles.length === 0 ? undefined : await runJestFiles(vendorConfig.configFile, allFiles);

    applyJestResults(runTargets, componentResults, jestResult);
    const data = createTestServiceResult({
      envName: runtime.data.envName,
      vendor: meta.id,
      mode,
      run,
      componentResults: finishComponentResults(componentResults),
      args: runtime.data.args,
      config: runtime.data.config,
    });

    runtime.postMessage({ type: "result", data });
    runtime.postMessage({ type: "status", status: mode === "watch" ? "watching" : "completed" });
    return data;
  }

  async function runWatch() {
    const vendorConfig = readTestVendorConfig(runtime.data.config, workspaceRoot);
    const targets = await findComponentTestTargets(runtime.data.components);
    const runTargets = await realpathTargets(targets);
    const allFiles = runTargets.flatMap((target) => target.files);

    if (allFiles.length === 0) {
      run += 1;
      const data = createTestServiceResult({
        envName: runtime.data.envName,
        vendor: meta.id,
        mode,
        run,
        componentResults: finishComponentResults(createEmptyComponentResults(targets)),
        args: runtime.data.args,
        config: runtime.data.config,
      });
      runtime.postMessage({ type: "result", data });
      return;
    }

    await runJestWatch(vendorConfig.configFile, allFiles, targets, runTargets);
  }

  async function runJestFiles(configFile: string, files: string[]) {
    const { runCLI } = (await import("jest")) as unknown as { runCLI: JestRunCLI };
    const config = await importJestConfig(configFile);
    const realWorkspaceRoot = await safeRealpath(workspaceRoot);
    const { results } = await runCLI(
      {
        _: files,
        $0: "bit-lite",
        config: JSON.stringify({
          ...config,
          rootDir: realWorkspaceRoot,
        }),
        runInBand: true,
        runTestsByPath: true,
        watch: false,
        watchAll: false,
        silent: true,
        colors: false,
        passWithNoTests: true,
      },
      [realWorkspaceRoot]
    );
    return results;
  }

  async function runJestWatch(
    configFile: string,
    files: string[],
    targets: readonly ComponentTestTarget[],
    runTargets: readonly ComponentTestTarget[]
  ) {
    const { runCLI } = (await import("jest")) as unknown as { runCLI: JestRunCLI };
    const config = await importJestConfig(configFile);
    const realWorkspaceRoot = await safeRealpath(workspaceRoot);
    stopJestWatch = requestJestWatchQuit;
    const reporterId = registerJestWatchReporter({
      onRunStart() {
        runtime.postMessage({ type: "status", status: "running" });
      },
      onRunComplete(results) {
        run += 1;
        const componentResults = createEmptyComponentResults(targets);
        applyJestResults(runTargets, componentResults, results as JestAggregatedResult);
        const data = createTestServiceResult({
          envName: runtime.data.envName,
          vendor: meta.id,
          mode,
          run,
          componentResults: finishComponentResults(componentResults),
          args: runtime.data.args,
          config: runtime.data.config,
        });

        runtime.postMessage({ type: "result", data });
        runtime.postMessage({ type: "status", status: "watching" });
      },
    });

    try {
      await runCLI(
        {
          _: [],
          $0: "bit-lite jest-watch",
          config: JSON.stringify({
            ...config,
            rootDir: realWorkspaceRoot,
            testMatch: files.map((file) => toRootDirPattern(realWorkspaceRoot, file)),
            reporters: ["default", [resolveJestReporterPath(), { reporterId }]],
          }),
          runInBand: true,
          watch: false,
          watchAll: true,
          colors: true,
          passWithNoTests: true,
        },
        [realWorkspaceRoot]
      );
    } finally {
      stopJestWatch = undefined;
      unregisterJestWatchReporter(reporterId);
    }
  }

  async function stopWatch() {
    if (stoppingWatch) return stoppingWatch;

    stoppingWatch = (async () => {
      stopJestWatch?.();
      await Promise.race([watchPromise ?? Promise.resolve(), wait(1000)]);
      finish("stopped");
      unsubscribe();
    })();

    return stoppingWatch;
  }
}

function resolveJestReporterPath() {
  return fileURLToPath(new URL("./reporter.js", import.meta.url));
}

function toRootDirPattern(rootDir: string, filePath: string) {
  return `<rootDir>/${toPosixPath(path.relative(rootDir, filePath))}`;
}

async function realpathTargets<Target extends { files: string[] }>(targets: readonly Target[]) {
  return Promise.all(
    targets.map(async (target) => ({
      ...target,
      files: await Promise.all(target.files.map(safeRealpath)),
    }))
  );
}

async function importJestConfig(configFile: string) {
  const moduleUrl = path.isAbsolute(configFile) ? pathToFileURL(configFile).href : configFile;
  const configModule = (await import(moduleUrl)) as { default?: unknown };
  if (!isRecord(configModule.default)) {
    throw new Error(`Jest config "${configFile}" must default export an object`);
  }
  return configModule.default;
}

function applyJestResults(
  targets: readonly { files: string[] }[],
  componentResults: MutableComponentResult[],
  jestResult: JestAggregatedResult | undefined
) {
  const componentByFile = createComponentFileMap(targets, componentResults);

  for (const testResult of jestResult?.testResults ?? []) {
    const result = componentByFile.get(normalizeFilePath(testResult.testFilePath));
    if (result === undefined) continue;
    applyJestTestResult(result, testResult);
  }

  if (jestResult?.wasInterrupted) {
    const firstResult = componentResults[0];
    if (firstResult) addFileLoadFailure(firstResult, new Error("Jest run was interrupted"));
  }
}

function applyJestTestResult(result: MutableComponentResult, testResult: JestTestResult) {
  const passed = testResult.numPassingTests ?? 0;
  const failed = testResult.numFailingTests ?? 0;
  const skipped = (testResult.numPendingTests ?? 0) + (testResult.numTodoTests ?? 0);
  result.stats.passed += passed;
  result.stats.failed += failed;
  result.stats.skipped += skipped;
  result.stats.total += passed + failed + skipped;

  for (const assertion of testResult.testResults ?? []) {
    if (assertion.status === "failed") result.errors.push(...(assertion.failureMessages ?? []));
  }

  if (testResult.failureMessage) result.errors.push(testResult.failureMessage);
  if (testResult.testExecError !== undefined) {
    result.errors.push(formatError(testResult.testExecError));
    if (failed === 0) {
      result.stats.failed += 1;
      result.stats.total += 1;
    }
  }

  result.durationMs +=
    testResult.perfStats?.runtime ??
    Math.max(0, (testResult.perfStats?.end ?? 0) - (testResult.perfStats?.start ?? 0));
}

function createComponentFileMap(
  targets: readonly { files: string[] }[],
  componentResults: MutableComponentResult[]
) {
  const componentByFile = new Map<string, MutableComponentResult>();
  targets.forEach((target, index) => {
    const result = componentResults[index];
    if (result === undefined) return;
    for (const file of target.files) componentByFile.set(normalizeFilePath(file), result);
  });
  return componentByFile;
}

function normalizeFilePath(filePath: string) {
  return path.resolve(filePath);
}

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function safeRealpath(filePath: string) {
  try {
    return await realpath(filePath);
  } catch {
    return filePath;
  }
}

function requestJestWatchQuit() {
  process.stdin.emit("data", Buffer.from("q"));
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isInteractiveTerminal() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}
