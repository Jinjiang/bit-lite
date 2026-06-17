import { createPreviewHost, type HostTestState } from "../host/server.js";
import { createStartRunReporter } from "../reporter/start-reporter.js";
import { isOutputPayload } from "../reporter/output-reporter.js";
import { resolveRunnableGroups, runRunnableGroup } from "../runtime.js";
import { closePreviewVendorServers } from "../services/preview/runtime.js";
import { BitLiteError } from "../utils/errors.js";
import type { PreviewResult } from "../types/services/preview.js";
import type { ServiceRunEventContext, RunnableGroup } from "../runtime.js";
import type { ServiceRunResult, WorkspaceRuntime } from "../types/index.js";
import { installRunControls, printServiceResults, waitForAbort } from "./helpers.js";
import type { BitLiteCommand } from "./types.js";

const FIRST_ENV_PORT = 3301;

export const startCommand: BitLiteCommand = {
  name: "start",
  async run({ workspace, args }) {
    if (args.length > 0) {
      throw new Error(`start does not accept arguments: ${args.join(" ")}`);
    }

    const controller = new AbortController();
    const reporter = createStartRunReporter(workspace);
    const cleanupControls = installRunControls(controller, (chunk) => reporter.onInput?.(chunk));
    const host = await createPreviewHost({ title: "bit-lite start" });
    const tests = createTestResultStore();
    host.setTestProvider((envName) => tests.get(envName));

    try {
      const previewGroups = await resolveRunnableGroups(workspace, "preview");
      const testGroups = await resolveOptionalRunnableGroups(workspace, "test");
      const testResultsPromise = runStartTestWatchers(workspace, testGroups, controller.signal, reporter, tests).catch(
        () => []
      );
      const previewResults = await Promise.all(
        previewGroups.map(async (runnableGroup, index) => {
          const envName = runnableGroup.group.envName;
          const result = await runRunnableGroup(runnableGroup, {
            workspaceRoot: workspace.workspaceRoot,
            args: {
              port: FIRST_ENV_PORT + index,
              base: `/env/${encodeURIComponent(envName)}/`,
            },
            signal: controller.signal,
            onEvent: reporter.onEvent,
            ...(reporter.onTask ? { onTask: reporter.onTask } : {}),
          });
          host.registerPreview(result.envName, result.result as PreviewResult, {
            docs: true,
            source: true,
            tests: true,
          });
          return result;
        })
      );

      reporter.flush();
      printServiceResults("start", previewResults);
      if (previewResults.every(({ result }) => result.ok)) {
        console.log(`start UI running at ${host.url}`);
        await waitForAbort(controller.signal);
      }
      controller.abort();
      await testResultsPromise.catch(() => undefined);
      return previewResults.every(({ result }) => result.ok) ? 0 : 1;
    } finally {
      controller.abort();
      cleanupControls();
      reporter.close?.();
      await host.stop();
      await closePreviewVendorServers();
    }
  },
};

async function resolveOptionalRunnableGroups(workspace: WorkspaceRuntime, serviceName: string) {
  try {
    return await resolveRunnableGroups(workspace, serviceName);
  } catch (error) {
    if (error instanceof BitLiteError && error.message.includes(`service "${serviceName}" is not configured`)) {
      return [];
    }
    throw error;
  }
}

function runStartTestWatchers(
  workspace: WorkspaceRuntime,
  runnableGroups: RunnableGroup[],
  signal: AbortSignal,
  reporter: ReturnType<typeof createStartRunReporter>,
  store: TestResultStore
) {
  for (const runnableGroup of runnableGroups) {
    store.start(runnableGroup.group.envName);
  }
  return Promise.all(
    runnableGroups.map(async (runnableGroup) => {
      const envName = runnableGroup.group.envName;
      try {
        const result = await runRunnableGroup(runnableGroup, {
          workspaceRoot: workspace.workspaceRoot,
          args: { watch: true },
          execution: "parallel",
          signal,
          onEvent(type, payload, context) {
            store.event(type, payload, context);
            reporter.onEvent(type, payload, context);
          },
          ...(reporter.onTask ? { onTask: reporter.onTask } : {}),
        });
        store.exit(envName, result);
        return result;
      } catch (error) {
        store.error(envName, error);
        throw error;
      }
    })
  );
}

type TestResultStore = ReturnType<typeof createTestResultStore>;

function createTestResultStore() {
  const states = new Map<string, HostTestState>();
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
    exit(envName: string, result: ServiceRunResult) {
      const state = ensureState(states, envName);
      state.status = "ended";
      if (!result.result.ok) state.exitCode = 1;
      appendOutput(state, `\n${result.result.message ?? `Test watcher for ${envName} ended.`}\n`);
    },
    error(envName: string, error: unknown) {
      const state = ensureState(states, envName);
      state.status = "ended";
      state.exitCode = 1;
      const message = error instanceof Error ? error.message : String(error);
      appendOutput(state, `\nTest watcher for ${envName} failed: ${message}\n`);
    },
    get(envName?: string): HostTestState {
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

function ensureState(states: Map<string, HostTestState>, envName: string) {
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

function appendOutput(state: HostTestState, chunk: string) {
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
