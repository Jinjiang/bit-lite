import { superviseVendorTasks } from "bit-lite-vendors";
import { isTestServiceResult } from "bit-lite-tester";
import type { TestComponentResult, TestServiceResult } from "bit-lite-tester";
import { isInteractiveTerminal } from "bit-lite-utils/node";
import type { Workspace } from "bit-lite-context";
import type { ParsedCliArgs } from "../cli/arg-types.js";
import type { SelectedEnvIdentity, WorkspaceEnvGroup } from "bit-lite-env-resolution";
import type { VendorTask } from "bit-lite-vendors";
import { prepareResolvedCommandSelection } from "./selection.js";
import { printNoTasks } from "./no-tasks.js";
import type { ResolvedCommandSelection } from "./selection.js";
import {
  createEnvServiceExecutionPlan,
  createVendorWatchExecution,
  defineVendorExecution,
  prepareResolvedServiceTaskOptions,
  runVendorExecutionPlan,
} from "../execution/vendor-execution.js";
import type {
  ImmutableCliArguments,
  PlannedEnvServiceUnit,
  VendorRunOutcome,
} from "../execution/vendor-execution.js";
import type { WatchCommandContribution } from "../session/contribution.js";
import { createTestResultRoutes } from "./test-routes.js";
import { readFlagOption } from "../cli/options.js";

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

  if (readFlagOption(parsed.args.options.watch, "--watch") && isInteractiveTerminal()) {
    const contribution = await createTestWatchContribution(selection, {
      resultStore: options.resultStore,
    });
    if (contribution.tasks.length === 0) {
      printNoTasks("test", contribution.groups);
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
    printNoTasks("test", selection.groups);
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
