import {
  groupWorkspaceComponentsByEnv,
  resolveVendorSpecifier,
  selectWorkspaceComponents,
} from "bit-lite-context";
import {
  createVendorContext,
  runVendorTasks,
  watchVendorTasks,
} from "bit-lite-vendors";
import type {
  ParsedCliArgs,
  Workspace,
  WorkspaceContext,
  WorkspaceEnvGroup,
} from "bit-lite-context";
import type {
  JsonObject,
  JsonValue,
  VendorTask,
  VendorTaskRunResult,
  VendorTaskStartOptions,
} from "bit-lite-vendors";
import type { ResultStore, ResultStoreEntry } from "../utils/result-store.js";
import { prepareWorkspaceForEnvLoading } from "../utils/prepare-workspace.js";

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

const serviceId = "test";
const label = "Test";

export async function runTestCommand(parsed: ParsedCliArgs, options: RunTestCommandOptions = {}) {
  const { workspace, context } = await prepareWorkspaceForEnvLoading(parsed.workspaceRoot);
  const components = selectWorkspaceComponents(workspace, parsed.componentFilters);
  const groups = groupWorkspaceComponentsByEnv(context, components);
  const tasks = (await Promise.all(groups
    .map((group) => createTestVendorTaskOptions(workspace, group, parsed))))
    .filter((task): task is VendorTaskStartOptions => task !== undefined);

  if (tasks.length === 0) {
    printNoTestTasks(groups);
    return;
  }

  if (parsed.args.options.watch === true && isInteractiveTerminal()) {
    const resultStore = options.resultStore;
    const resultStoreOptions = resultStore === undefined
      ? {}
      : {
          onResult(result: TestServiceResult, task: VendorTask<unknown, TestServiceResult>) {
            addTestWatchResult(resultStore, task, result);
          },
        };

    await watchVendorTasks<TestServiceResult>(tasks, {
      serviceId,
      label,
      title: "bit-lite test --watch",
      formatResult: formatTestWatchResult,
      ...resultStoreOptions,
      formatStoppingMessage: (reason) => `Stopping bit-lite test (${reason})...\n`,
    });
    return;
  }

  await runVendorTasks(tasks, {
    serviceId,
    label,
    formatResult: formatTestRunResult,
    printResults: printTestResults,
  });
}

function isInteractiveTerminal() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

async function createTestVendorTaskOptions(
  workspace: Workspace,
  group: WorkspaceEnvGroup,
  parsed: ParsedCliArgs
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
    context: createVendorContext({ workspace, args: parsed.args, env: group.env, service }),
    components: group.components,
    config: service.definition.config ?? {},
  };
}

function printNoTestTasks(groups: WorkspaceEnvGroup[]) {
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
