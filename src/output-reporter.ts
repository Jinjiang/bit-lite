import type { ServiceRunEventContext } from "./runtime.js";
import type { ServiceTask, WorkspaceRuntime } from "./types.js";

export type OutputPayload = {
  stream: "stdout" | "stderr";
  chunk: string;
};

type OutputState = {
  context: ServiceRunEventContext;
  label: string;
  stdout: string;
  stderr: string;
  status: string;
  updatedAt: number;
};

export type ServiceRunReporter = {
  onTask?(task: ServiceTask, context: ServiceRunEventContext): void;
  onEvent(type: string, payload: unknown, context: ServiceRunEventContext): void;
  onInput?(chunk: Buffer): boolean;
  flush(): void;
  close?(): void;
};

export type OutputReporterLabels = Map<string, string | undefined>;

export type DashboardOutputReporterOptions = {
  title: string;
  labels: OutputReporterLabels;
  formatStatus?: (status: string) => string;
};

export function createPrefixedOutputReporter(labels: OutputReporterLabels): ServiceRunReporter {
  return {
    onEvent(type, payload, context) {
      if (type !== "output" || !isOutputPayload(payload)) return;
      const target = payload.stream === "stderr" ? process.stderr : process.stdout;
      target.write(prefixChunk(`[${formatLabel(context, labels.get(context.envName))}] `, payload.chunk));
    },
    flush() {},
  };
}

export function createDashboardOutputReporter(options: DashboardOutputReporterOptions): ServiceRunReporter {
  const outputs = new Map<string, OutputState>();
  const tasks = new Map<string, ServiceTask>();
  let selectedIndex = 0;
  let rendered = false;
  let focused = false;

  const render = () => {
    if (focused) {
      renderFocused();
      return;
    }
    renderDashboard();
  };

  const renderDashboard = () => {
    rendered = true;
    const states = sortedStates(outputs);
    const selected = states[selectedIndex] ?? states[0];
    process.stdout.write("\x1b[?25l\x1b[2J\x1b[H");
    process.stdout.write(`${options.title}\n\n`);
    states.forEach((state, index) => {
      const marker = state === selected ? ">" : " ";
      const status = options.formatStatus?.(state.status) ?? state.status;
      process.stdout.write(`${marker} ${index + 1}. ${state.label}  ${status}  ${formatTime(state.updatedAt)}\n`);
    });
    process.stdout.write("\n");
    process.stdout.write("mode: dashboard\n");
    process.stdout.write("keys: 1-9 switch, tab next, enter focus, q quit\n");
  };

  const renderFocused = () => {
    rendered = true;
    const states = sortedStates(outputs);
    const selected = states[selectedIndex] ?? states[0];
    process.stdout.write("\x1b[2J\x1b[H");
    if (!selected) return;
    process.stdout.write(`${selected.stdout}${selected.stderr}`);
  };

  return {
    onTask(task, context) {
      tasks.set(contextKey(context), task);
    },
    onEvent(type, payload, context) {
      const state = getOutputState(outputs, context, options.labels.get(context.envName));
      if (type === "status" && isStatusPayload(payload)) {
        state.status = payload.status;
        state.updatedAt = Date.now();
        render();
        return;
      }
      if (type === "ready") {
        state.status = "running";
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
      let quit = false;
      for (const key of parseKeys(value)) {
        if (handleKey(key)) quit = true;
      }
      return quit;
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
        return false;
      }
      if (value.includes("\u0003")) return true;
      if (selected) tasks.get(contextKey(selected.context))?.call("stdin", value);
      return false;
    }
    if (value.includes("\u0003")) return true;
    if (value === "q") return true;
    if (value === "\r" || value === "\n") {
      focused = true;
      render();
      return false;
    }
    if (value === "\t" || value === "\u001b[C" || value === "\u001b[B") {
      selectedIndex = states.length === 0 ? 0 : (selectedIndex + 1) % states.length;
      render();
      return false;
    }
    if (value === "\u001b[D" || value === "\u001b[A") {
      selectedIndex = states.length === 0 ? 0 : (selectedIndex - 1 + states.length) % states.length;
      render();
      return false;
    }
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= states.length) {
      selectedIndex = numeric - 1;
      render();
    }
    return false;
  }
}

export function getServiceVendorLabels(workspace: WorkspaceRuntime, serviceName: string) {
  const labels = new Map<string, string | undefined>();
  for (const group of workspace.groups) {
    labels.set(group.envName, readVendor(group.env.services[serviceName]));
  }
  return labels;
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
      label: formatLabel(context, vendor),
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

function trimState(state: OutputState) {
  if (state.stdout.length > 100000) state.stdout = state.stdout.slice(-100000);
  if (state.stderr.length > 100000) state.stderr = state.stderr.slice(-100000);
}

function readVendor(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const vendor = (value as { vendor?: unknown }).vendor;
  return typeof vendor === "string" ? vendor : undefined;
}

function isStatusPayload(value: unknown): value is { status: string } {
  return typeof value === "object" && value !== null && typeof (value as { status?: unknown }).status === "string";
}

export function isOutputPayload(value: unknown): value is OutputPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { stream?: unknown; chunk?: unknown };
  return (candidate.stream === "stdout" || candidate.stream === "stderr") && typeof candidate.chunk === "string";
}
