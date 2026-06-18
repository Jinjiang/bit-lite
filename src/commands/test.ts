import {
  createDashboardOutputReporter,
  createPrefixedOutputReporter,
  getServiceVendorLabels,
  isOutputPayload,
  type ServiceRunReporter,
} from "../reporter/output-reporter.js";
import { resolveRunnableGroups, runRunnableGroup, type RunnableGroup, type ServiceRunEventContext } from "../runtime.js";
import type { ServiceRunResult, WorkspaceRuntime } from "../types/index.js";
import { BitLiteError } from "../utils/errors.js";
import { installRunControls, printServiceResults } from "./helpers.js";
import type { BitLiteCommand } from "./types.js";

export type TestRunState = {
  envName?: string;
  status?: string;
  exitCode?: number;
  output?: string;
  envs?: TestRunState[];
};

export type RunTestServicesOptions = {
  args?: unknown;
  signal?: AbortSignal;
  reporter?: ServiceRunReporter;
  optional?: boolean;
  onStart?(envName: string): void;
  onEvent?(type: string, payload: unknown, context: ServiceRunEventContext): void;
  onResult?(result: ServiceRunResult): void;
  onError?(envName: string, error: unknown): void;
};

export const testCommand: BitLiteCommand = {
  name: "test",
  async run({ workspace, args }) {
    const controller = new AbortController();
    const reporter = createTestRunReporter(workspace, args.includes("--watch"));
    const cleanupControls = installRunControls(controller, (chunk) => reporter.onInput?.(chunk));
    try {
      const results = await runTestServices(workspace, {
        args,
        signal: controller.signal,
        reporter,
      });
      reporter.flush();
      printServiceResults("test", results);
      return results.every(({ result }) => result.ok) ? 0 : 1;
    } finally {
      cleanupControls();
      reporter.close?.();
    }
  },
};

export async function runTestServices(workspace: WorkspaceRuntime, options: RunTestServicesOptions = {}) {
  const runnableGroups = await resolveTestRunnableGroups(workspace, Boolean(options.optional));
  for (const runnableGroup of runnableGroups) {
    options.onStart?.(runnableGroup.group.envName);
  }
  return Promise.all(
    runnableGroups.map(async (runnableGroup) => {
      const envName = runnableGroup.group.envName;
      try {
        const result = await runRunnableGroup(runnableGroup, {
          workspaceRoot: workspace.workspaceRoot,
          args: options.args,
          ...(options.signal ? { signal: options.signal } : {}),
          onEvent(type, payload, context) {
            options.onEvent?.(type, payload, context);
            options.reporter?.onEvent(type, payload, context);
          },
          ...(options.reporter?.onTask ? { onTask: options.reporter.onTask } : {}),
        });
        options.onResult?.(result);
        return result;
      } catch (error) {
        options.onError?.(envName, error);
        throw error;
      }
    })
  );
}

export function createTestResultStore() {
  const states = new Map<string, TestRunState>();
  return {
    start(envName: string) {
      states.set(envName, {
        envName,
        status: "running",
        output: `Starting tests for ${envName}...`,
      });
    },
    event(type: string, payload: unknown, context: ServiceRunEventContext) {
      const state = ensureState(states, context.envName);
      if (type === "output" && isOutputPayload(payload)) {
        appendOutput(state, payload.chunk);
        return;
      }
      if (type === "status" && isStatusPayload(payload)) {
        state.status = payload.status === "passed" || payload.status === "failed" ? "ended" : payload.status;
      }
    },
    exit(result: ServiceRunResult) {
      const state = ensureState(states, result.envName);
      state.status = "ended";
      if (!result.result.ok) state.exitCode = 1;
      appendOutput(state, `\n${result.result.message ?? `Test watcher for ${result.envName} ended.`}\n`);
    },
    error(envName: string, error: unknown) {
      const state = ensureState(states, envName);
      state.status = "ended";
      state.exitCode = 1;
      const message = error instanceof Error ? error.message : String(error);
      appendOutput(state, `\nTest watcher for ${envName} failed: ${message}\n`);
    },
    get(envName?: string): TestRunState {
      if (envName) {
        const state = states.get(envName);
        return state ?? {
          envName,
          status: "idle",
          output: `Tests have not started for ${envName}.`,
        };
      }
      return {
        envs: Array.from(states.values()).sort((left, right) => (left.envName ?? "").localeCompare(right.envName ?? "")),
      };
    },
  };
}

function createTestRunReporter(workspace: WorkspaceRuntime, watch: boolean): ServiceRunReporter {
  const labels = getServiceVendorLabels(workspace, "test");
  return watch
    ? createDashboardOutputReporter({
        title: "bit-lite test watch",
        labels,
        formatStatus,
      })
    : createPrefixedOutputReporter(labels);
}

async function resolveTestRunnableGroups(workspace: WorkspaceRuntime, optional: boolean) {
  try {
    return await resolveRunnableGroups(workspace, "test");
  } catch (error) {
    if (optional && error instanceof BitLiteError && error.message.includes('service "test" is not configured')) {
      return [] as RunnableGroup[];
    }
    throw error;
  }
}

function ensureState(states: Map<string, TestRunState>, envName: string) {
  let state = states.get(envName);
  if (!state) {
    state = {
      envName,
      status: "idle",
      output: "",
    };
    states.set(envName, state);
  }
  return state;
}

function appendOutput(state: TestRunState, chunk: string) {
  state.output = `${state.output ?? ""}${stripAnsi(chunk)}`;
  if (state.output.length > 20000) {
    state.output = state.output.slice(state.output.length - 20000);
  }
}

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function isStatusPayload(value: unknown): value is { status: string } {
  return typeof value === "object" && value !== null && typeof (value as { status?: unknown }).status === "string";
}

function formatStatus(status: string) {
  if (status === "passed") return "ended";
  return status;
}
