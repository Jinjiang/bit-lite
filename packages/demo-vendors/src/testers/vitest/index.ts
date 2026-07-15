import path from "node:path";
import { createVitest, startVitest } from "vitest/node";
import type { Reporter, TestModule, TestRunResult, Vitest } from "vitest/node";
import type { VendorDefinition, VendorRuntime, VendorStartResult } from "bit-lite-vendors";
import { readTestVendorConfig } from "../config.js";
import { findComponentTestTargets } from "../files.js";
import {
  addFileLoadFailure,
  createEmptyComponentResults,
  createTestServiceResult,
  finishComponentResults,
  formatError,
  type MutableComponentResult,
  type TestServiceResult,
} from "../result.js";
import { isShutdownMessage } from "../vendor-utils.js";

export const meta: VendorDefinition = {
  id: "vitest",
  label: "Vitest",
  hint: "Run component tests with Vitest",
  moduleUrl: import.meta.url,
};

export default async function startVitestVendor(
  runtime: VendorRuntime<Record<string, unknown>, TestServiceResult>
): Promise<VendorStartResult<TestServiceResult>> {
  const workspaceRoot = readWorkspaceRoot(runtime.data.runtime) ?? process.cwd();
  const watch = runtime.data.args.options.watch === true && isInteractiveTerminal();
  const mode = watch ? "watch" : "run";
  let run = 0;
  let stopped = false;
  let activeVitest: Vitest | undefined;
  let stoppingVitest: Promise<void> | undefined;

  const finish = (status: string) => {
    if (stopped) return;
    stopped = true;
    runtime.postMessage({ type: "status", status });
  };

  const unsubscribe = runtime.onMessage(async (message) => {
    if (isShutdownMessage(message)) {
      await stopVitest();
    }
  });

  runtime.postMessage({ type: "ready" });

  if (watch) {
    runtime.postMessage({ type: "status", status: "watching" });
    void runWatch().catch((error) => {
      runtime.postMessage({ type: "error", message: formatError(error) });
      finish("error");
    });
    return {
      stop: stopVitest,
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
    const componentResults = createEmptyComponentResults(targets);
    const allFiles = targets.flatMap((target) => target.files);
    const testRun = allFiles.length === 0 ? undefined : await runVitestFiles(vendorConfig.configFile, allFiles);

    applyVitestResults(targets, componentResults, testRun);
    const data = createTestServiceResult({
      env: runtime.data.env,
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
    const allFiles = targets.flatMap((target) => target.files);

    if (allFiles.length === 0) {
      run += 1;
      const data = createTestServiceResult({
        env: runtime.data.env,
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

    await runVitestWatch(vendorConfig.configFile, allFiles, targets);
  }

  async function runVitestFiles(configFile: string, files: string[]) {
    const vitest = await createVitest(
      "test",
      {
        root: workspaceRoot,
        config: configFile,
        run: true,
        watch: false,
        reporters: [],
        passWithNoTests: true,
      },
    );
    activeVitest = vitest;

    try {
      return await vitest.start(files);
    } finally {
      if (activeVitest === vitest) {
        activeVitest = undefined;
        await vitest.close();
      }
    }
  }

  async function runVitestWatch(
    configFile: string,
    files: string[],
    targets: Awaited<ReturnType<typeof findComponentTestTargets>>
  ) {
    const reporter: Reporter = {
      onTestRunStart() {
        runtime.postMessage({ type: "status", status: "running" });
      },
      onTestRunEnd(testModules, unhandledErrors) {
        run += 1;
        const componentResults = createEmptyComponentResults(targets);
        applyVitestResults(targets, componentResults, {
          testModules: Array.from(testModules),
          unhandledErrors: Array.from(unhandledErrors),
        } as TestRunResult);
        const data = createTestServiceResult({
          env: runtime.data.env,
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
    };

    activeVitest = await startVitest(
      "test",
      [],
      {
        root: workspaceRoot,
        config: configFile,
        include: files,
        run: false,
        watch: true,
        reporters: ["default", reporter],
        passWithNoTests: true,
      },
    );
  }

  async function stopVitest() {
    if (stoppingVitest) return stoppingVitest;

    stoppingVitest = (async () => {
      const vitest = activeVitest;
      activeVitest = undefined;
      await vitest?.close();
      finish("stopped");
      unsubscribe();
    })();

    return stoppingVitest;
  }
}

function readWorkspaceRoot(runtime: Record<string, unknown> | undefined) {
  return runtime && typeof runtime.workspaceRoot === "string" ? runtime.workspaceRoot : undefined;
}

function applyVitestResults(
  targets: readonly { files: string[] }[],
  componentResults: MutableComponentResult[],
  testRun: TestRunResult | undefined
) {
  const componentByFile = createComponentFileMap(targets, componentResults);

  for (const module of testRun?.testModules ?? []) {
    const result = componentByFile.get(normalizeFilePath(module.moduleId));
    if (result === undefined) continue;
    applyVitestModuleResult(result, module);
  }

  for (const error of testRun?.unhandledErrors ?? []) {
    const firstResult = componentResults[0];
    if (firstResult) addFileLoadFailure(firstResult, error);
  }
}

function applyVitestModuleResult(result: MutableComponentResult, module: TestModule) {
  const tests = Array.from(module.children.allTests());
  for (const test of tests) {
    const state = test.result().state;
    result.stats.total += 1;
    if (state === "passed") result.stats.passed += 1;
    else if (state === "failed") {
      result.stats.failed += 1;
      result.errors.push(...(test.result().errors ?? []).map(formatError));
    } else {
      result.stats.skipped += 1;
    }
  }

  const moduleErrors = module.errors();
  if (moduleErrors.length > 0) {
    result.errors.push(...moduleErrors.map(formatError));
    if (tests.length === 0) {
      result.stats.total += moduleErrors.length;
      result.stats.failed += moduleErrors.length;
    }
  }

  result.durationMs += module.diagnostic().duration;
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

function isInteractiveTerminal() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}
