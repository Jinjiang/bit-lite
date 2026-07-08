import { groupSelectedComponentsByEnv, loadWorkspace, selectComponentRefs } from "bit-lite-context";
import {
  runVendorTasks,
  watchVendorTasks,
} from "bit-lite-vendors";
import type { CliArguments, ParsedCliArgs, SelectedEnvGroup, WorkspaceRuntime } from "bit-lite-context";
import type { JsonObject } from "bit-lite-env";
import type { VendorTask, VendorTaskRunResult, VendorTaskStartOptions } from "bit-lite-vendors";

export type TestServiceResult = {
  service: "test";
  vendor: string;
  mode: "run" | "watch";
  run: number;
  context: TestResultContext;
  stats: TestStats;
  componentResults: TestComponentResult[];
};

export type TestResultContext = {
  envName: string;
  componentIds: string[];
  args: CliArguments;
  config: JsonObject;
};

export type TestStats = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  summary: string;
};

export type TestComponentResult = {
  componentId: string;
  files: string[];
  stats: TestStats;
  durationMs: number;
  errors: string[];
};

const serviceId = "test";
const label = "Test";

export async function runTestCommand(parsed: ParsedCliArgs) {
  const workspace = await loadWorkspace(parsed.workspaceRoot);
  const components = selectComponentRefs(workspace.components, parsed.componentFilters);
  const groups = groupSelectedComponentsByEnv(workspace, components);
  const tasks = groups
    .map((group) => createTestVendorTaskOptions(workspace, group, parsed))
    .filter((task): task is VendorTaskStartOptions => task !== undefined);

  if (parsed.args.options.watch === true) {
    await watchVendorTasks(tasks, {
      serviceId,
      label,
      title: "bit-lite test --watch",
      formatResult: formatTestWatchResult,
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

function createTestVendorTaskOptions(
  workspace: WorkspaceRuntime,
  group: SelectedEnvGroup,
  parsed: ParsedCliArgs
): VendorTaskStartOptions | undefined {
  const serviceConfig = group.env.services[serviceId];
  if (serviceConfig === undefined) return undefined;

  return {
    envName: group.envName,
    components: group.components,
    args: parsed.args,
    context: workspace,
    serviceConfig,
  };
}

function printTestResults(
  results: VendorTaskRunResult<TestServiceResult>[],
  tasks: VendorTask<TestServiceResult>[]
) {
  if (results.length === 0) return;

  console.log("Test results:");
  for (const [index, result] of results.entries()) {
    const task = tasks[index];
    console.log(`- ${task?.label ?? result.vendor}: ${result.data.stats.summary}`);
    for (const componentResult of result.data.componentResults) {
      console.log(`  - ${componentResult.componentId}: ${formatComponentResult(componentResult)}`);
    }
  }
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
    ...result.componentResults.map((componentResult) => {
      return `${componentResult.componentId}: ${formatComponentResult(componentResult)}`;
    }),
  ];
}

export function isTestServiceResult(value: unknown): value is TestServiceResult {
  return (
    isRecord(value) &&
    value.service === "test" &&
    typeof value.vendor === "string" &&
    (value.mode === "run" || value.mode === "watch") &&
    typeof value.run === "number" &&
    isTestResultContext(value.context) &&
    isTestStats(value.stats) &&
    Array.isArray(value.componentResults) &&
    value.componentResults.every(isTestComponentResult)
  );
}

function isTestResultContext(value: unknown): value is TestResultContext {
  return (
    isRecord(value) &&
    typeof value.envName === "string" &&
    Array.isArray(value.componentIds) &&
    value.componentIds.every((componentId) => typeof componentId === "string") &&
    isRecord(value.args) &&
    isJsonObject(value.config)
  );
}

function isTestStats(value: unknown): value is TestStats {
  return (
    isRecord(value) &&
    typeof value.total === "number" &&
    typeof value.passed === "number" &&
    typeof value.failed === "number" &&
    typeof value.skipped === "number" &&
    typeof value.summary === "string"
  );
}

function isTestComponentResult(value: unknown): value is TestComponentResult {
  return (
    isRecord(value) &&
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonObject[keyof JsonObject] {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}
