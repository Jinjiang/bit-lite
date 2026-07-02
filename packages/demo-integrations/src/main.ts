import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { createInlineRunner } from "./runners/inline-runner.js";
import { createWorkerRunner } from "./runners/worker-runner.js";
import type {
  LogEntry,
  OutputStream,
  RunnerMode,
  ServiceData,
  ServiceDefinition,
  ServiceMessage,
  ServiceRuntimeState,
} from "./types.js";

// Absolute path to the demo package root. Runners receive this path so they can
// resolve their own fixture directories without guessing from process.cwd().
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// `--no-ui` switches the app from the interactive terminal UI to prefixed plain
// logs. This is useful for smoke tests and CI-like runs where stdin is not a TTY.
const noUi = process.argv.includes("--no-ui");

// Execution backend selected from the CLI. Worker mode proxies terminal output;
// inline mode imports service modules directly and lets their output reach the
// terminal naturally.
const runnerMode = readRunnerMode(process.argv.slice(2));

// The interactive UI only works when both stdin and stdout are real terminals.
// Piped commands, smoke tests, non-TTY shells, and inline mode fall back to
// plain output. Inline mode cannot safely redraw the terminal while tools write
// directly to the same stdout/stderr.
const interactive = runnerMode === "worker" && !noUi && process.stdin.isTTY && process.stdout.isTTY;

// Optional auto-shutdown timer used by the smoke script. An unset or invalid
// value means the demo keeps running until the user quits it.
const autoExitMs = Number.parseInt(process.env.DEMO_INTEGRATIONS_AUTO_EXIT_MS ?? "", 10);

// Static service definitions. Each entry describes one integration service and
// the label/hint displayed by the terminal manager.
const services: ServiceDefinition[] = [
  {
    // Stable internal id used in log prefixes and service lookup.
    id: "webpack",
    // Human-readable name shown in the menu and log detail screen.
    label: "Webpack Dev Server",
    // Short note that reminds us which Node API this service exercises.
    hint: "Node API: webpack + webpack-dev-server",
    // Service module used by both runner modes.
    serviceModuleUrl: new URL("./services/webpack-dev-server.ts", import.meta.url),
    // Friendly default port. The service will fall back to a random port if busy.
    preferredPort: 4301,
  },
  {
    id: "vite",
    label: "Vite Dev Server",
    hint: "Node API: vite.createServer",
    serviceModuleUrl: new URL("./services/vite-dev-server.ts", import.meta.url),
    preferredPort: 4302,
  },
  {
    id: "jest",
    label: "Jest Watch Mode",
    hint: "Node API: jest.runCLI",
    serviceModuleUrl: new URL("./services/jest-watch.ts", import.meta.url),
  },
  {
    id: "vitest",
    label: "Vitest Watch Mode",
    hint: "Node API: vitest/node.startVitest",
    serviceModuleUrl: new URL("./services/vitest-watch.ts", import.meta.url),
  },
];

// Runtime state for each service. This extends the static service definition
// with mutable state collected by the manager while services are running.
const runtimes: ServiceRuntimeState[] = services.map((service) => ({
  ...service,
  // Current high-level lifecycle state displayed in the menu.
  status: "starting",
  // Optional URL reported by dev-server style services.
  url: undefined,
  // Ring buffer of parsed stdout/stderr lines for this service.
  logs: [],
  // Streams arrive as arbitrary chunks, not guaranteed full lines. `partial`
  // stores an unfinished line until the next chunk provides a newline.
  partial: {
    stdout: "",
    stderr: "",
  },
  // Runner instance once `startManagedService()` has created it.
  runner: undefined,
  // Promise resolved when the runner exits. Shutdown waits on these promises.
  exitPromise: undefined,
}));

// Index of the currently highlighted service in the menu screen.
let selectedIndex = 0;

// Current terminal screen. `menu` lists all services; `logs` shows one service.
let screen: "menu" | "logs" = "menu";

// Service id selected for the log detail screen.
let activeServiceId: string | undefined = undefined;

// Render throttling flag. Many log chunks can arrive together; this prevents
// scheduling multiple redundant screen redraws in the same event loop turn.
let renderPending = false;

// Once shutdown begins, the UI stops repainting and waits for runners to close.
let shuttingDown = false;

// Start every service immediately. The manager is intentionally simple: one
// runner per service, all started eagerly so we can compare concurrent output.
for (const service of runtimes) {
  startManagedService(service);
}

// Interactive mode owns the terminal and redraws a menu. Plain mode only prints
// prefixed lines as they arrive.
if (interactive) {
  setupInteractiveInput();
  scheduleRender();
} else {
  printPlainHeader();
}

// In smoke mode, stop the long-running dev servers/watchers automatically.
if (Number.isFinite(autoExitMs) && autoExitMs > 0) {
  setTimeout(() => {
    shutdown(0, `auto exit after ${autoExitMs}ms`);
  }, autoExitMs).unref();
}

// Convert process signals into the same shutdown path used by keyboard input.
process.on("SIGINT", () => {
  shutdown(0, "received SIGINT");
});

process.on("SIGTERM", () => {
  shutdown(0, "received SIGTERM");
});

// Create a runner for one service and wire its unified output/control channels
// into the manager state.
function startManagedService(service: ServiceRuntimeState) {
  const serviceData: ServiceData = {
    serviceId: service.id,
    label: service.label,
    preferredPort: service.preferredPort,
    packageRoot,
  };
  const runner =
    runnerMode === "worker"
      ? createWorkerRunner(service, serviceData)
      : createInlineRunner(service, serviceData);

  service.runner = runner;

  // Keep a per-service exit promise. Shutdown races all exits against a timeout
  // before force-terminating any runner that did not close cleanly.
  service.exitPromise = runner.exitPromise.then((code) => {
    service.status = code === 0 || shuttingDown ? "stopped" : `exited ${code}`;
    scheduleRender();
    return code;
  });

  // Worker mode emits proxied stdout/stderr here. Inline mode intentionally
  // emits no output events because the tool writes directly to the terminal.
  runner.onOutput((stream, chunk) => appendChunk(service, stream, chunk));

  // Structured messages are separate from raw stdout/stderr. Both runner modes
  // use this path for lifecycle metadata such as readiness, URL, and errors.
  runner.onMessage((message) => handleServiceMessage(service, message));

  Promise.resolve(runner.start()).catch((error) => {
    handleServiceMessage(service, { type: "error", message: error.stack ?? error.message });
  });
}

// Apply one structured message from a service runner to manager state.
function handleServiceMessage(service: ServiceRuntimeState, message: ServiceMessage) {
  if (message.type === "ready") {
    service.status = "ready";
    service.url = typeof message.url === "string" ? message.url : undefined;
    appendLine(service, "stdout", `manager: ${service.label} is ready${service.url ? ` at ${service.url}` : ""}`);
  }

  // `status` lets a service expose an intermediate state such as `watching`.
  if (message.type === "status" && typeof message.status === "string") {
    service.status = message.status;
    scheduleRender();
  }

  if (message.type === "error") {
    service.status = "error";
    appendLine(service, "stderr", `manager: ${message.message ?? "unknown service error"}`);
  }
}

// Convert a raw stream chunk into complete log lines. Chunks can split lines in
// the middle, so each stream keeps its own carry-over buffer.
function appendChunk(service: ServiceRuntimeState, stream: OutputStream, chunk: Buffer) {
  const text = sanitizeOutput(chunk.toString("utf8"));
  const lines = `${service.partial[stream]}${text}`.replaceAll("\r", "\n").split("\n");
  service.partial[stream] = lines.pop() ?? "";

  for (const line of lines) {
    appendLine(service, stream, line);
  }
}

// Add one parsed line to a service log. In plain mode this also writes the line
// immediately with a service/stream prefix.
function appendLine(service: ServiceRuntimeState, stream: OutputStream, line: string) {
  const entry: LogEntry = {
    // Timestamp used by the log detail screen.
    at: new Date(),
    // `stdout` or `stderr`, preserved from the runner output stream.
    stream,
    // Text without trailing newline.
    line,
  };

  service.logs.push(entry);
  // Bound memory usage for long-running watch sessions.
  if (service.logs.length > 1000) {
    service.logs.splice(0, service.logs.length - 1000);
  }

  if (!interactive) {
    process.stdout.write(formatPlainLog(service, entry));
  }

  scheduleRender();
}

// Put stdin into raw keypress mode and route keys according to the active screen.
function setupInteractiveInput() {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", (_input, key) => {
    if (key.ctrl && key.name === "c") {
      shutdown(0, "received Ctrl+C");
      return;
    }

    if (key.name === "q") {
      shutdown(0, "quit requested");
      return;
    }

    if (screen === "menu") {
      handleMenuKey(key);
      return;
    }

    handleLogKey(key);
  });
}

// Handle keys while the menu is visible.
function handleMenuKey(key: readline.Key) {
  if (key.name === "up") {
    // Wrap around so repeated Up/Down can cycle through all services.
    selectedIndex = (selectedIndex + runtimes.length - 1) % runtimes.length;
    scheduleRender();
    return;
  }

  if (key.name === "down") {
    selectedIndex = (selectedIndex + 1) % runtimes.length;
    scheduleRender();
    return;
  }

  if (key.name === "return") {
    // Enter opens the selected service log screen.
    activeServiceId = runtimes[selectedIndex]?.id;
    screen = "logs";
    scheduleRender();
  }
}

// Handle keys while a single service log is visible.
function handleLogKey(key: readline.Key) {
  if (key.name === "escape") {
    // Escape returns to the service menu without stopping services.
    screen = "menu";
    activeServiceId = undefined;
    scheduleRender();
  }
}

// Schedule one screen redraw. Rendering through setImmediate batches together
// log bursts and status updates that arrive in the same tick.
function scheduleRender() {
  if (!interactive || renderPending || shuttingDown) return;

  renderPending = true;
  setImmediate(() => {
    renderPending = false;
    render();
  });
}

// Redraw the whole terminal. This intentionally uses a tiny custom renderer so
// the demo does not depend on a terminal UI framework.
function render() {
  const columns = process.stdout.columns || 100;
  const rows = process.stdout.rows || 30;
  const lines = screen === "menu" ? renderMenu(columns, rows) : renderLogs(columns, rows);

  process.stdout.write("\x1b[?25l");
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(lines.join("\n"));
}

// Build the menu screen as an array of terminal lines.
function renderMenu(columns: number, rows: number) {
  const lines = [
    `demo-integrations (${runnerMode} runner)`,
    "",
    "Use Up/Down and Enter to choose an output. Press q or Ctrl+C to stop.",
    "",
  ];

  runtimes.forEach((service, index) => {
    // `marker` visually highlights the item controlled by Up/Down.
    const marker = index === selectedIndex ? ">" : " ";
    // Fixed-width fields keep the menu readable while statuses change.
    const label = service.label.padEnd(22);
    const status = service.status.padEnd(10);
    const url = service.url ? ` ${service.url}` : "";
    // Show a one-line preview so the menu still communicates activity.
    const recent = service.logs.at(-1)?.line;
    lines.push(fitLine(`${marker} ${label} ${status} ${service.hint}${url}`, columns));
    if (recent) {
      lines.push(fitLine(`  latest: ${recent}`, columns));
    }
  });

  return fillScreen(lines, rows);
}

// Build the selected service output screen as an array of terminal lines.
function renderLogs(columns: number, rows: number) {
  const service = runtimes.find((item) => item.id === activeServiceId) ?? runtimes[selectedIndex];
  if (!service) return fillScreen(["No services configured"], rows);
  const header = [
    `${service.label} output`,
    `${service.status}${service.url ? ` | ${service.url}` : ""}`,
    "Press Escape to return to the menu. Press q or Ctrl+C to stop.",
    "",
  ];

  // Reserve space for the header and show the newest entries at the bottom.
  const availableRows = Math.max(1, rows - header.length);
  const entries = service.logs.slice(-availableRows);
  const body = entries.map((entry) => {
    const time = entry.at.toLocaleTimeString();
    const prefix = `${time} ${entry.stream === "stderr" ? "err" : "out"} | `;
    return fitLine(`${prefix}${entry.line}`, columns);
  });

  return fillScreen([...header.map((line) => fitLine(line, columns)), ...body], rows);
}

// Print the introductory text for non-interactive runs.
function printPlainHeader() {
  process.stdout.write(`demo-integrations started in plain log mode (${runnerMode} runner)\n`);
  if (runnerMode === "inline") {
    process.stdout.write("Service stdout/stderr are direct process output in inline mode.\n");
  }
  process.stdout.write("Set DEMO_INTEGRATIONS_AUTO_EXIT_MS or press Ctrl+C to stop.\n\n");
}

// Format one log entry for plain mode. The prefix preserves both service id and
// stream so proxied output can share one terminal without losing ownership.
function formatPlainLog(service: ServiceRuntimeState, entry: LogEntry) {
  const stream = entry.stream === "stderr" ? "err" : "out";
  return `[${service.id}:${stream}] ${entry.line}\n`;
}

// Pad or trim the rendered screen to the current terminal height.
function fillScreen(lines: string[], rows: number) {
  const result = lines.slice(0, rows);
  while (result.length < rows) result.push("");
  return result;
}

// Trim long lines instead of letting them wrap and distort the menu layout.
function fitLine(line: string, columns: number) {
  if (line.length <= columns) return line;
  return line.slice(0, Math.max(0, columns - 1));
}

// Strip terminal control sequences emitted by tools before storing them in the
// UI log buffer. Regular Unicode text is kept intact for real-world logs.
function sanitizeOutput(text: string) {
  return text
    .replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f-\u009f]/g, "");
}

// Stop every runner and restore the terminal before exiting the parent process.
async function shutdown(code: number, reason?: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (interactive) {
    // Leave raw mode and show the cursor even if runners keep printing while
    // they shut down.
    process.stdin.setRawMode(false);
    process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
  }

  process.stdout.write(`Stopping demo-integrations${reason ? ` (${reason})` : ""}...\n`);

  for (const service of runtimes) {
    // Ask runners to close their dev server/watch process cleanly first.
    await service.runner?.stop();
  }

  // Give cooperative runners a short window to close. This keeps shutdown fast
  // if a third-party tool hangs.
  await Promise.race([
    Promise.allSettled(runtimes.map((service) => service.exitPromise)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  // Force-terminate any runner that ignored or missed the shutdown message.
  await Promise.allSettled(
    runtimes.map(async (service) => {
      if (service.runner) await service.runner.terminate();
    })
  );

  if (interactive) {
    process.stdout.write("\x1b[?25h");
  }

  process.exit(code);
}

// Parse the runner backend from CLI arguments. Supported forms:
// `--runner=worker`, `--runner worker`, `--worker`, `--runner=inline`,
// `--runner inline`, and `--inline`.
function readRunnerMode(args: string[]): RunnerMode {
  let mode: string = "worker";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--worker") {
      mode = "worker";
      continue;
    }

    if (arg === "--inline") {
      mode = "inline";
      continue;
    }

    if (arg === "--runner") {
      mode = args[index + 1] ?? mode;
      index += 1;
      continue;
    }

    if (arg.startsWith("--runner=")) {
      mode = arg.slice("--runner=".length);
    }
  }

  if (mode !== "worker" && mode !== "inline") {
    console.error(`Unknown demo-integrations runner "${mode}". Expected "worker" or "inline".`);
    process.exit(1);
  }

  return mode;
}
