import { superviseVendorTasks } from "bit-lite-vendors";
import type {
  ParsedCliArgs,
  SelectedEnvIdentity,
  Workspace,
  WorkspaceEnvGroup,
} from "bit-lite-context";
import type {
  JsonObject,
  JsonValue,
  VendorTask,
} from "bit-lite-vendors";
import { prepareResolvedCommandSelection } from "../utils/command-selection.js";
import type { ResolvedCommandSelection } from "../utils/command-selection.js";
import {
  createEnvServiceExecutionPlan,
  createVendorWatchExecution,
  defineVendorExecution,
  prepareResolvedServiceTaskOptions,
  runVendorExecutionPlan,
} from "../utils/vendor-execution.js";
import type {
  ImmutableCliArguments,
  PlannedEnvServiceUnit,
  VendorRunOutcome,
} from "../utils/vendor-execution.js";
import type { WatchCommandContribution } from "../utils/watch-contribution.js";
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

export type TestWatchResultEntry = {
  observedAt: string;
  taskId: string;
  env: SelectedEnvIdentity;
  vendor: string;
  json: TestServiceResult;
  text: string;
};

export type TestWatchResultStore = {
  add(
    entry: Omit<TestWatchResultEntry, "observedAt"> & {
      observedAt?: string | Date;
    }
  ): TestWatchResultEntry;
  entries(vendor?: string): TestWatchResultEntry[];
  json(vendor?: string): TestServiceResult[];
  text(vendor?: string): string;
};

export type RunTestCommandOptions = {
  resultStore?: TestWatchResultStore;
};

export type TestWatchTaskBinding = {
  task: VendorTask<unknown, TestServiceResult>;
  componentIds: string[];
};

export type TestWatchContribution = WatchCommandContribution<VendorTask<unknown, TestServiceResult>> & {
  groups: readonly WorkspaceEnvGroup[];
  resultStore: TestWatchResultStore;
  bindings: TestWatchTaskBinding[];
  effectiveArgs: ImmutableCliArguments;
};

export type CreateTestWatchContributionOptions = {
  resultStore?: TestWatchResultStore | undefined;
};

const serviceId = "test";
const label = "Test";

type TestExecutionContext = {
  workspace: Workspace;
  resultStore?: TestWatchResultStore | undefined;
};

const testVendorExecution = defineVendorExecution<
  PlannedEnvServiceUnit,
  TestExecutionContext,
  undefined,
  TestServiceResult,
  TestServiceResult
>({
  serviceId,
  label,
  prepare: async ({ unit, args, context }) => ({
    taskOptions: await prepareResolvedServiceTaskOptions({
      workspace: context.workspace,
      args,
      unit: unit.value,
    }),
  }),
  run: {
    formatResult: formatTestRunResult,
  },
  watch: {
    activation: "eager",
    formatResult: formatTestWatchResult,
    onResult(result, task, _unit, context) {
      if (context.resultStore) addTestWatchResult(context.resultStore, task, result);
    },
  },
});

export async function runTestCommand(parsed: ParsedCliArgs, options: RunTestCommandOptions = {}) {
  const selection = await prepareResolvedCommandSelection(parsed);
  const plan = createEnvServiceExecutionPlan(selection, serviceId);

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
        dispose: contribution.dispose,
      });
    } finally {
      await contribution.dispose();
    }
    return;
  }

  if (plan.layers[0]?.length === 0) {
    printNoTestTasks(selection.groups);
    return;
  }

  const execution = await runVendorExecutionPlan({
    plan,
    definition: testVendorExecution,
    context: { workspace: selection.context.workspace },
    args: parsed.args,
  });
  const failure = execution.outcomes.find((outcome) => outcome.status === "failed");
  if (failure?.status === "failed") throw failure.error;
  const successful = execution.outcomes.filter(
    (outcome): outcome is Extract<typeof outcome, { status: "successful" }> =>
      outcome.status === "successful"
  );
  printTestResults(successful);
}

export async function createTestWatchContribution(
  selection: ResolvedCommandSelection,
  options: CreateTestWatchContributionOptions = {}
): Promise<TestWatchContribution> {
  const resultStore = options.resultStore ?? createTestWatchResultStore();
  const plan = createEnvServiceExecutionPlan(selection, serviceId);
  const execution = await createVendorWatchExecution({
    plan,
    definition: testVendorExecution,
    context: { workspace: selection.context.workspace, resultStore },
    args: selection.parsed.args,
  });
  const bindings = execution.preparedUnits.map(({ unit, task }) => ({
    task,
    componentIds: unit.value.group.components.map((component) => component.id),
  }));

  const contribution: TestWatchContribution = {
    serviceId,
    tasks: execution.tasks,
    routes: [],
    groups: selection.groups,
    resultStore,
    bindings,
    effectiveArgs: execution.args,
    dispose: execution.dispose,
  };
  try {
    contribution.routes.push(...createTestResultRoutes(contribution));
    return contribution;
  } catch (error) {
    await contribution.dispose();
    throw error;
  }
}

function isInteractiveTerminal() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
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
  outcomes: Array<
    Extract<
      VendorRunOutcome<PlannedEnvServiceUnit, undefined, TestServiceResult>,
      { status: "successful" }
    >
  >
) {
  if (outcomes.length === 0) return;
  console.log("Test results:");
  for (const { result, task } of outcomes) {
    console.log(`- ${task.label}: ${result.data.stats.summary}`);
    for (const componentResult of result.data.componentResults) {
      console.log(`  - ${componentResult.componentId}: ${formatComponentResult(componentResult)}`);
    }
  }
}

function addTestWatchResult(
  resultStore: TestWatchResultStore,
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

export function createTestWatchResultStore(): TestWatchResultStore {
  const entries: TestWatchResultEntry[] = [];

  const filterEntries = (vendor: string | undefined) =>
    vendor === undefined
      ? [...entries]
      : entries.filter((entry) => entry.vendor === vendor);

  return {
    add(entry) {
      const storedEntry: TestWatchResultEntry = {
        observedAt:
          entry.observedAt === undefined
            ? new Date().toISOString()
            : typeof entry.observedAt === "string"
              ? entry.observedAt
              : entry.observedAt.toISOString(),
        taskId: entry.taskId,
        env: entry.env,
        vendor: entry.vendor,
        json: entry.json,
        text: entry.text,
      };
      entries.push(storedEntry);
      return storedEntry;
    },
    entries(vendor) {
      return filterEntries(vendor);
    },
    json(vendor) {
      return filterEntries(vendor).map((entry) => entry.json);
    },
    text(vendor) {
      return filterEntries(vendor)
        .map((entry) => entry.text)
        .join("\n---\n");
    },
  };
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
