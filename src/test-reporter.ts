import type { ServiceRunEventContext } from "./runtime.js";
import type { ServiceTask } from "./types.js";
import type { WorkspaceRuntime } from "./types.js";

type OutputPayload = {
  stream: "stdout" | "stderr";
  chunk: string;
};

type OutputState = {
  context: ServiceRunEventContext;
  vendor: string | undefined;
  stdout: string;
  stderr: string;
  status: string;
  updatedAt: number;
};

export type TestRunReporter = {
  onTask?(task: ServiceTask, context: ServiceRunEventContext): void;
  onEvent(type: string, payload: unknown, context: ServiceRunEventContext): void;
  onInput?(chunk: Buffer): void;
  flush(): void;
  close?(): void;
};

export function createTestRunReporter(workspace: WorkspaceRuntime, watch: boolean): TestRunReporter {
  const vendors = getTestVendors(workspace);
  return watch ? createWatchTuiReporter(vendors) : createPrefixedReporter(vendors);
}

function createPrefixedReporter(vendors: Map<string, string | undefined>): TestRunReporter {
  return {
    onEvent(type, payload, context) {
      if (type !== "output" || !isOutputPayload(payload)) return;
      const target = payload.stream === "stderr" ? process.stderr : process.stdout;
      target.write(prefixChunk(`[${formatLabel(context, vendors.get(context.envName))}] `, payload.chunk));
    },
    flush() {},
  };
}

function createWatchTuiReporter(vendors: Map<string, string | undefined>): TestRunReporter {
  const outputs = new Map<string, OutputState>();
  const tasks = new Map<string, ServiceTask>();
  let selectedIndex = 0;
  let rendered = false;
  let focused = false;

  const render = () => {
    rendered = true;
    const states = sortedStates(outputs);
    const selected = states[selectedIndex] ?? states[0];
    process.stdout.write("\x1b[?25l\x1b[2J\x1b[H");
    process.stdout.write("bit-lite test watch\n\n");
    states.forEach((state, index) => {
      const marker = state === selected ? ">" : " ";
      process.stdout.write(
        `${marker} ${index + 1}. ${formatLabel(state.context, state.vendor)}  ${state.status}  ${formatTime(state.updatedAt)}\n`
      );
    });
    process.stdout.write("\n");
    if (focused && selected) {
      process.stdout.write(`mode: focused ${formatLabel(selected.context, selected.vendor)}\n`);
      process.stdout.write("keys: esc dashboard, ctrl+c quit all, input passes to watcher\n");
    } else {
      process.stdout.write("mode: dashboard\n");
      process.stdout.write("keys: 1-9 switch, tab next, enter focus, q quit\n");
    }
    process.stdout.write("────────────────────────────────────────\n");
    if (!selected) {
      process.stdout.write("waiting for test output...\n");
      return;
    }
    process.stdout.write(tail(`${selected.stdout}${selected.stderr}`, process.stdout.rows ? process.stdout.rows - 9 : 30));
  };

  return {
    onTask(task, context) {
      tasks.set(contextKey(context), task);
    },
    onEvent(type, payload, context) {
      const state = getOutputState(outputs, context, vendors.get(context.envName));
      if (type === "status" && isStatusPayload(payload)) {
        state.status = payload.status;
        state.updatedAt = Date.now();
        render();
        return;
      }
      if (type === "result") {
        state.updatedAt = Date.now();
        render();
        return;
      }
      if (type !== "output" || !isOutputPayload(payload)) return;
      if (payload.stream === "stderr") state.stderr += payload.chunk;
      else state.stdout += payload.chunk;
      state.updatedAt = Date.now();
      trimState(state);
      render();
    },
    onInput(chunk) {
      const value = chunk.toString("utf8");
      for (const key of parseKeys(value)) {
        handleKey(key);
      }
    },
    flush() {
      if (rendered) process.stdout.write("\n");
    },
    close() {
      if (rendered) process.stdout.write("\x1b[?25h");
    },
  };

  function handleKey(value: string) {
      const states = sortedStates(outputs);
      const selected = states[selectedIndex] ?? states[0];
      if (focused) {
        if (value === "\u001b") {
          focused = false;
          render();
          return;
        }
        if (value.includes("\u0003")) return;
        if (selected) tasks.get(contextKey(selected.context))?.call("stdin", value);
        return;
      }
      if (value === "\r" || value === "\n") {
        focused = true;
        render();
        return;
      }
      if (value === "\t" || value === "\u001b[C" || value === "\u001b[B") {
        selectedIndex = states.length === 0 ? 0 : (selectedIndex + 1) % states.length;
        render();
        return;
      }
      if (value === "\u001b[D" || value === "\u001b[A") {
        selectedIndex = states.length === 0 ? 0 : (selectedIndex - 1 + states.length) % states.length;
        render();
        return;
      }
      const numeric = Number(value);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= states.length) {
        selectedIndex = numeric - 1;
        render();
      }
  }
}

function getOutputState(
  outputs: Map<string, OutputState>,
  context: ServiceRunEventContext,
  vendor: string | undefined
) {
  const key = contextKey(context);
  let state = outputs.get(key);
  if (!state) {
    state = {
      context,
      vendor,
      stdout: "",
      stderr: "",
      status: "starting",
      updatedAt: Date.now(),
    };
    outputs.set(key, state);
  }
  return state;
}

function contextKey(context: ServiceRunEventContext) {
  return `${context.envName}\0${context.serviceRef}`;
}

function parseKeys(value: string) {
  const keys: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\u001b" && value[index + 1] === "[") {
      keys.push(value.slice(index, index + 3));
      index += 2;
      continue;
    }
    keys.push(value[index] ?? "");
  }
  return keys;
}

function compareStates(left: OutputState, right: OutputState) {
  return left.context.envName.localeCompare(right.context.envName);
}

function sortedStates(outputs: Map<string, OutputState>) {
  return Array.from(outputs.values()).sort(compareStates);
}

function prefixChunk(prefix: string, chunk: string) {
  const lines = chunk.split(/\r?\n/);
  return lines
    .map((line, index) => {
      if (line.length === 0 && index === lines.length - 1) return "";
      return `${prefix}${line}`;
    })
    .join("\n");
}

function formatLabel(context: ServiceRunEventContext, vendor: string | undefined) {
  return `${context.envName}/${vendor ?? context.serviceRef}`;
}

function formatTime(value: number) {
  return new Date(value).toISOString().slice(11, 19);
}

function tail(value: string, maxLines: number) {
  const lines = value.split(/\r?\n/);
  const selected = maxLines > 0 ? lines.slice(-maxLines) : lines;
  return selected.join("\n");
}

function trimState(state: OutputState) {
  if (state.stdout.length > 100000) state.stdout = state.stdout.slice(-100000);
  if (state.stderr.length > 100000) state.stderr = state.stderr.slice(-100000);
}

function getTestVendors(workspace: WorkspaceRuntime) {
  const vendors = new Map<string, string | undefined>();
  for (const group of workspace.groups) {
    vendors.set(group.envName, readVendor(group.env.services.test));
  }
  return vendors;
}

function readVendor(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const vendor = (value as { vendor?: unknown }).vendor;
  return typeof vendor === "string" ? vendor : undefined;
}

function isStatusPayload(value: unknown): value is { status: string } {
  return typeof value === "object" && value !== null && typeof (value as { status?: unknown }).status === "string";
}

function isOutputPayload(value: unknown): value is OutputPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { stream?: unknown; chunk?: unknown };
  return (candidate.stream === "stdout" || candidate.stream === "stderr") && typeof candidate.chunk === "string";
}
