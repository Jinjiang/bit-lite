import { Writable } from "node:stream";
import path from "node:path";
import { createVitest } from "vitest/node";
import type { TestModule, TestRunResult, Vitest } from "vitest/node";
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
  const workspaceRoot = runtime.data.context?.workspaceRoot ?? process.cwd();
  const mode = runtime.data.args.options.watch === true ? "watch" : "run";
  let run = 0;
  let stopped = false;
  let keepAlive: NodeJS.Timeout | undefined;
  let activeVitest: Vitest | undefined;

  const finish = (status: string) => {
    if (stopped) return;
    stopped = true;
    if (keepAlive) clearInterval(keepAlive);
    runtime.postMessage({ type: "status", status });
  };

  const unsubscribe = runtime.onMessage((message) => {
    if (isShutdownMessage(message)) {
      void activeVitest?.close();
      finish("stopped");
      unsubscribe();
    }
  });

  runtime.postMessage({ type: "ready" });

  if (mode === "watch") {
    runtime.postMessage({ type: "status", status: "watching" });
    keepAlive = setInterval(() => undefined, 2 ** 30);
    void runSnapshot().catch((error) => {
      runtime.postMessage({ type: "error", message: formatError(error) });
      finish("error");
    });
    return {
      async stop() {
        await activeVitest?.close();
        finish("stopped");
        unsubscribe();
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
    const componentResults = createEmptyComponentResults(targets);
    const allFiles = targets.flatMap((target) => target.files);
    const testRun = allFiles.length === 0 ? undefined : await runVitestFiles(vendorConfig.configFile, allFiles);

    applyVitestResults(targets, componentResults, testRun);
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

  async function runVitestFiles(configFile: string, files: string[]) {
    activeVitest = await createVitest(
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

    try {
      return await activeVitest.start(files);
    } finally {
      await activeVitest.close();
      activeVitest = undefined;
    }
  }
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

function createNullWritable() {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}
