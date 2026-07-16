import {
  getSelectedEnvKey,
  resolveVendorSpecifier,
} from "bit-lite-context";
import {
  createVendorContext,
  createWatchVendorTasks,
  runVendorTasks,
  superviseVendorTasks,
} from "bit-lite-vendors";
import type {
  CliArguments,
  ParsedCliArgs,
  Workspace,
  WorkspaceEnvGroup,
} from "bit-lite-context";
import type {
  JsonObject,
  JsonValue,
  VendorTask,
  VendorTaskRunResult,
  VendorTaskStartOptions,
} from "bit-lite-vendors";
import { createResultStore } from "../utils/result-store.js";
import type { ResultStore, ResultStoreEntry } from "../utils/result-store.js";
import { prepareResolvedCommandSelection } from "../utils/command-selection.js";
import type { ResolvedCommandSelection } from "../utils/command-selection.js";
import type { WatchCommandContribution } from "./watch-contribution.js";
import { createTestResultRoutes } from "./test-routes.js";

export type TestServiceResult = JsonObject & {
  mode: "run" | "watch";
  run: number;
  stats: TestStats;
  componentResults: TestComponentResult[];
};

export type TestStats = JsonObject & {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  summary: string;
};

export type TestComponentResult = JsonObject & {
  componentId: string;
  files: string[];
  stats: TestStats;
  durationMs: number;
  errors: string[];
};

export type TestWatchResultEntry = ResultStoreEntry<TestServiceResult>;
export type TestWatchResultStore = ResultStore<TestServiceResult>;

export type RunTestCommandOptions = {
  resultStore?: ResultStore<TestServiceResult>;
};

export type TestWatchTaskBinding = {
  task: VendorTask<unknown, TestServiceResult>;
  componentIds: string[];
};

export type TestWatchContribution = WatchCommandContribution<VendorTask<unknown, TestServiceResult>> & {
  groups: readonly WorkspaceEnvGroup[];
  resultStore: ResultStore<TestServiceResult>;
  bindings: TestWatchTaskBinding[];
  effectiveArgs: CliArguments;
};

export type CreateTestWatchContributionOptions = {
  resultStore?: ResultStore<TestServiceResult> | undefined;
};

const serviceId = "test";
const label = "Test";

export async function runTestCommand(parsed: ParsedCliArgs, options: RunTestCommandOptions = {}) {
  const selection = await prepareResolvedCommandSelection(parsed);

  if (parsed.args.options.watch === true && isInteractiveTerminal()) {
    const contribution = await createTestWatchContribution(selection, {
      resultStore: options.resultStore,
    });
    if (contribution.tasks.length === 0) {
      printNoTestTasks(contribution.groups);
      await contribution.dispose();
      return;
    }

    try {
      await superviseVendorTasks(contribution.tasks, {
        title: "bit-lite test --watch",
        formatStoppingMessage: (reason) => `Stopping bit-lite test (${reason})...\n`,
        onTasksStarted() {
          return contribution.dispose;
        },
      });
    } finally {
      await contribution.dispose();
    }
    return;
  }

  const tasks = (await Promise.all(selection.groups.map((group) =>
    createTestVendorTaskOptions(selection.context.workspace, group, parsed.args)
  ))).filter((task): task is VendorTaskStartOptions => task !== undefined);

  if (tasks.length === 0) {
    printNoTestTasks(selection.groups);
    return;
  }

  await runVendorTasks(tasks, {
    serviceId,
    label,
    formatResult: formatTestRunResult,
    printResults: printTestResults,
  });
}

export async function createTestWatchContribution(
  selection: ResolvedCommandSelection,
  options: CreateTestWatchContributionOptions = {}
): Promise<TestWatchContribution> {
  const effectiveArgs = createTestWatchArguments(selection.parsed.args);
  const taskSpecs = (await Promise.all(selection.groups.map(async (group) => {
    const taskOptions = await createTestVendorTaskOptions(selection.context.workspace, group, effectiveArgs);
    return taskOptions ? { group, taskOptions } : undefined;
  }))).filter((spec): spec is { group: WorkspaceEnvGroup; taskOptions: VendorTaskStartOptions } => spec !== undefined);
  const resultStore = options.resultStore ?? createResultStore<TestServiceResult>();
  const tasks = await createWatchVendorTasks<TestServiceResult>(
    taskSpecs.map((spec) => spec.taskOptions),
    {
      serviceId,
      label,
      formatResult: formatTestWatchResult,
      onResult(result, task) {
        addTestWatchResult(resultStore, task, result);
      },
    }
  );
  const tasksByEnv = new Map(tasks.map((task) => [getSelectedEnvKey(task.context.env), task]));
  const bindings = taskSpecs.flatMap(({ group }) => {
    const task = tasksByEnv.get(getSelectedEnvKey(group.env.env));
    return task
      ? [{ task, componentIds: group.components.map((component) => component.id) }]
      : [];
  });
  let disposed = false;

  const contribution: TestWatchContribution = {
    serviceId,
    tasks,
    routes: [],
    groups: selection.groups,
    resultStore,
    bindings,
    effectiveArgs,
    dispose() {
      if (disposed) return;
      disposed = true;
    },
  };
  contribution.routes.push(...createTestResultRoutes(contribution));
  return contribution;
}

export function createTestWatchArguments(args: CliArguments): CliArguments {
  return {
    raw: [...args.raw],
    positional: [...args.positional],
    options: { ...args.options, watch: true },
    passthrough: [...args.passthrough],
  };
}

function isInteractiveTerminal() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

async function createTestVendorTaskOptions(
  workspace: Workspace,
  group: WorkspaceEnvGroup,
  args: CliArguments
): Promise<VendorTaskStartOptions | undefined> {
  const service = group.env.services.test;
  if (!service) return undefined;
  const vendorUrl = await resolveVendorSpecifier({
    specifier: service.definition.vendor,
    service,
    workspaceRoot: workspace.rootDir,
    selectedEnv: group.env.env.packageName,
    serviceName: serviceId,
  });
  return {
    vendorUrl,
    context: createVendorContext({ workspace, args, env: group.env, service }),
    components: group.components,
    config: service.definition.config ?? {},
  };
}

function printNoTestTasks(groups: readonly WorkspaceEnvGroup[]) {
  console.log("No test tasks found.");
  if (groups.length === 0) {
    console.log("No components were selected from this workspace.");
    return;
  }
  console.log(`Selected envs: ${groups.map((group) => group.env.env.packageName).join(", ")}`);
  console.log("Make sure each selected env defines services.test in the workspace config.");
}

function printTestResults(
  results: VendorTaskRunResult<TestServiceResult>[],
  tasks: VendorTask<TestServiceResult>[]
) {
  if (results.length === 0) return;
  console.log("Test results:");
  for (const [index, result] of results.entries()) {
    const task = tasks[index];
    console.log(`- ${task?.label ?? result.vendor.label}: ${result.data.stats.summary}`);
    for (const componentResult of result.data.componentResults) {
      console.log(`  - ${componentResult.componentId}: ${formatComponentResult(componentResult)}`);
    }
  }
}

function addTestWatchResult(
  resultStore: ResultStore<TestServiceResult>,
  task: VendorTask<unknown, TestServiceResult>,
  result: TestServiceResult
) {
  const observedAt = new Date().toISOString();
  resultStore.add({
    observedAt,
    taskId: task.id,
    env: task.context.env,
    vendor: task.vendor.id,
    json: result,
    text: `# ${task.vendor.id} run ${result.run} @ ${observedAt}\n${formatTestResultText(task.vendor.id, result)}`,
  });
}

function formatTestRunResult(result: unknown) {
  if (!isTestServiceResult(result)) return new Error("Invalid test run result");
  return result;
}

function formatTestWatchResult(result: unknown) {
  const runResult = formatTestRunResult(result);
  if (runResult instanceof Error) return runResult;
  return formatTestDetails(runResult);
}

function formatTestDetails(result: TestServiceResult) {
  return [
    result.stats.summary,
    ...result.componentResults.map((componentResult) =>
      `${componentResult.componentId}: ${formatComponentResult(componentResult)}`
    ),
  ];
}

export function isTestServiceResult(value: unknown): value is TestServiceResult {
  return (
    isJsonObject(value) &&
    (value.mode === "run" || value.mode === "watch") &&
    typeof value.run === "number" &&
    isTestStats(value.stats) &&
    Array.isArray(value.componentResults) &&
    value.componentResults.every(isTestComponentResult)
  );
}

function isTestStats(value: unknown): value is TestStats {
  return (
    isJsonObject(value) &&
    typeof value.total === "number" &&
    typeof value.passed === "number" &&
    typeof value.failed === "number" &&
    typeof value.skipped === "number" &&
    typeof value.summary === "string"
  );
}

function isTestComponentResult(value: unknown): value is TestComponentResult {
  return (
    isJsonObject(value) &&
    typeof value.componentId === "string" &&
    Array.isArray(value.files) &&
    value.files.every((file) => typeof file === "string") &&
    isTestStats(value.stats) &&
    typeof value.durationMs === "number" &&
    Array.isArray(value.errors) &&
    value.errors.every((error) => typeof error === "string")
  );
}

function formatComponentResult(result: TestComponentResult) {
  const fileLabel = result.files.length === 1 ? "1 file" : `${result.files.length} files`;
  return `${result.stats.summary} (${fileLabel})`;
}

function formatTestResultText(vendor: string, result: TestServiceResult) {
  return [
    `${vendor}: ${result.stats.summary}`,
    ...result.componentResults.map((componentResult) =>
      `${componentResult.componentId}: ${formatComponentResult(componentResult)}`
    ),
  ].join("\n");
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
