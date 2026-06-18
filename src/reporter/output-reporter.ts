import type { ServiceRunEventContext } from "../runtime.js";
import type { ServiceTask, WorkspaceRuntime } from "../types/index.js";

export type OutputPayload = {
  stream: "stdout" | "stderr";
  chunk: string;
};

type OutputState = {
  context: ServiceRunEventContext;
  label: string;
  detail?: string;
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
  items?: DashboardReporterItem[];
  summary?: string[] | (() => string[]);
  formatLabel?: (context: ServiceRunEventContext, vendor: string | undefined) => string;
  formatStatus?: (status: string) => string;
};

export type DashboardReporterItem = {
  envName: string;
  serviceRef: string;
  serviceName?: string;
  vendor?: string;
  label?: string;
  detail?: string;
  status?: string;
};

export type DashboardOutputReporter = ServiceRunReporter & {
  setTitle(title: string): void;
  setSummary(summary: string[] | (() => string[])): void;
  setItems(items: DashboardReporterItem[]): void;
  render(): void;
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

export function createDashboardOutputReporter(options: DashboardOutputReporterOptions): DashboardOutputReporter {
  const outputs = new Map<string, OutputState>();
  const tasks = new Map<string, ServiceTask>();
  let title = options.title;
  let summary = options.summary;
  let selectedIndex = 0;
  let rendered = false;
  let focused = false;
  let closed = false;

  const render = () => {
    if (closed) return;
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
    process.stdout.write(`${title}\n\n`);
    const summaryLines = readSummaryLines(summary);
    if (summaryLines.length > 0) {
      for (const line of summaryLines) {
        process.stdout.write(`${line}\n`);
      }
      process.stdout.write("\n");
    }
    states.forEach((state, index) => {
      const marker = state === selected ? ">" : " ";
      const status = options.formatStatus?.(state.status) ?? state.status;
      const detail = state.detail ? `  ${state.detail}` : "";
      process.stdout.write(`${marker} ${index + 1}. ${state.label}  ${status}${detail}  ${formatTime(state.updatedAt)}\n`);
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

  const reporter: DashboardOutputReporter = {
    onTask(task, context) {
      if (closed) return;
      tasks.set(contextKey(context), task);
    },
    onEvent(type, payload, context) {
      if (closed) return;
      const state = getOutputState(
        outputs,
        context,
        options.labels.get(contextKey(context)) ?? options.labels.get(context.envName),
        options.formatLabel
      );
      if (type === "status" && isStatusPayload(payload)) {
        state.status = payload.status;
        state.updatedAt = Date.now();
        render();
        return;
      }
      if (type === "ready") {
        state.status = "running";
        const detail = readReadyDetail(payload);
        if (detail) state.detail = detail;
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
      if (closed) return false;
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
      if (closed) return;
      closed = true;
      if (rendered) process.stdout.write("\x1b[?25h");
    },
    setTitle(nextTitle) {
      title = nextTitle;
      render();
    },
    setSummary(nextSummary) {
      summary = nextSummary;
      render();
    },
    setItems(items) {
      for (const item of items) {
        setOutputStateItem(item);
      }
      render();
    },
    render,
  };

  for (const item of options.items ?? []) {
    setOutputStateItem(item);
  }

  return reporter;

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

  function setOutputStateItem(item: DashboardReporterItem) {
    const context = {
      envName: item.envName,
      serviceName: item.serviceName ?? item.serviceRef,
      serviceRef: item.serviceRef,
    };
    const state = getOutputState(
      outputs,
      context,
      item.vendor ?? options.labels.get(contextKey(context)) ?? options.labels.get(item.envName),
      options.formatLabel
    );
    if (item.label) state.label = item.label;
    if (item.detail !== undefined) state.detail = item.detail;
    if (item.status) state.status = item.status;
    state.updatedAt = Date.now();
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
  vendor: string | undefined,
  customFormatLabel?: (context: ServiceRunEventContext, vendor: string | undefined) => string
) {
  const key = contextKey(context);
  let state = outputs.get(key);
  if (!state) {
    state = {
      context,
      label: customFormatLabel?.(context, vendor) ?? formatLabel(context, vendor),
      stdout: "",
      stderr: "",
      status: "starting",
      updatedAt: Date.now(),
    };
    outputs.set(key, state);
  }
  return state;
}

function readSummaryLines(summary: DashboardOutputReporterOptions["summary"]) {
  if (!summary) return [];
  return typeof summary === "function" ? summary() : summary;
}

function readReadyDetail(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return undefined;
  const candidate = payload as { url?: unknown; port?: unknown };
  if (typeof candidate.url === "string") return candidate.url;
  if (typeof candidate.port === "number") return `:${candidate.port}`;
  return undefined;
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
  return (
    left.context.serviceRef.localeCompare(right.context.serviceRef) ||
    left.context.envName.localeCompare(right.context.envName)
  );
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
