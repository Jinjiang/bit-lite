import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { RawOutputBuffer, writeTerminalOutput } from "bit-lite-terminal";
import { createInlineRunner } from "./runners/inline-runner.js";
import { createWorkerRunner } from "./runners/worker-runner.js";
import type {
  DevServerVendorConfig,
  OutputStream,
  RunnerMode,
  VendorData,
  VendorDefinition,
  VendorMessage,
  VendorRuntimeState,
} from "./types.js";

// Absolute path to the demo package root. Runners receive this path so they can
// resolve their own fixture directories without guessing from process.cwd().
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Execution backend selected from the CLI. Worker mode proxies terminal output;
// inline mode imports vendor modules directly and lets their output reach the
// terminal naturally.
const runnerMode = readRunnerMode(process.argv.slice(2));

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("demo-integrations requires an interactive terminal.");
  process.exit(1);
}

// Optional auto-shutdown timer. An unset or invalid value means the demo keeps
// running until the user quits it.
const autoExitMs = Number.parseInt(process.env.DEMO_INTEGRATIONS_AUTO_EXIT_MS ?? "", 10);

// Static vendor definitions. Each entry describes one integration vendor and
// the label/hint displayed by the terminal manager.
const vendors: VendorDefinition[] = [
  {
    // Stable internal id used in log prefixes and vendor lookup.
    id: "webpack",
    // Human-readable name shown in the menu.
    label: "Webpack Dev Server",
    // Short note that reminds us which Node API this vendor exercises.
    hint: "Node API: webpack + webpack-dev-server",
    // Vendor module used by both runner modes.
    vendorModuleUrl: new URL("./vendors/webpack-dev-server.ts", import.meta.url),
    // Dev-server specific options. The vendor will fall back to a random port if busy.
    config: {
      preferredPort: 4301,
    } satisfies DevServerVendorConfig,
  },
  {
    id: "vite",
    label: "Vite Dev Server",
    hint: "Node API: vite.createServer",
    vendorModuleUrl: new URL("./vendors/vite-dev-server.ts", import.meta.url),
    config: {
      preferredPort: 4302,
    } satisfies DevServerVendorConfig,
  },
  {
    id: "jest",
    label: "Jest Watch Mode",
    hint: "Node API: jest.runCLI",
    vendorModuleUrl: new URL("./vendors/jest-watch.ts", import.meta.url),
  },
  {
    id: "vitest",
    label: "Vitest Watch Mode",
    hint: "Node API: vitest/node.startVitest",
    vendorModuleUrl: new URL("./vendors/vitest-watch.ts", import.meta.url),
  },
];

// Runtime state for each vendor. This extends the static vendor definition
// with mutable state collected by the manager while vendors are running.
const runtimes: VendorRuntimeState[] = vendors.map((vendor) => ({
  ...vendor,
  // Current high-level lifecycle state displayed in the menu.
  status: "starting",
  // Optional URL reported by dev-server style vendors.
  url: undefined,
  // Original stdout/stderr chunks used when attaching the terminal to one vendor.
  rawOutput: new RawOutputBuffer(),
  // Runner instance once `startManagedVendor()` has created it.
  runner: undefined,
  // Promise resolved when the runner exits. Shutdown waits on these promises.
  exitPromise: undefined,
}));

// Index of the currently highlighted vendor in the menu screen.
let selectedIndex = 0;

// Current terminal screen. `menu` lists all vendors, and `terminal` gives one
// worker vendor raw control of the terminal.
let screen: "menu" | "terminal" = "menu";

// Vendor id currently attached to the raw terminal screen.
let activeVendorId: string | undefined = undefined;

// Render throttling flag. Many status updates can arrive together; this prevents
// scheduling multiple redundant screen redraws in the same event loop turn.
let renderPending = false;

// Once shutdown begins, the UI stops repainting and waits for runners to close.
let shuttingDown = false;

// Start every vendor immediately. The manager is intentionally simple: one
// runner per vendor, all started eagerly so we can compare concurrent output.
for (const vendor of runtimes) {
  startManagedVendor(vendor);
}

setupInteractiveInput();
scheduleRender();

// Optional short-run timer for manual interactive verification.
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

// Create a runner for one vendor and wire its unified output/control channels
// into the manager state.
function startManagedVendor(vendor: VendorRuntimeState) {
  const vendorData: VendorData = {
    vendorId: vendor.id,
    label: vendor.label,
    config: vendor.config ?? {},
    packageRoot,
  };
  const runner =
    runnerMode === "worker"
      ? createWorkerRunner(vendor, vendorData)
      : createInlineRunner(vendor, vendorData);

  vendor.runner = runner;

  // Keep a per-vendor exit promise. Shutdown races all exits against a timeout
  // before force-terminating any runner that did not close cleanly.
  vendor.exitPromise = runner.exitPromise.then((code) => {
    vendor.status = code === 0 || shuttingDown ? "stopped" : `exited ${code}`;
    scheduleRender();
    return code;
  });

  // Worker mode emits proxied stdout/stderr here. Inline mode intentionally
  // emits no output events because the tool writes directly to the terminal.
  runner.onOutput((stream, chunk) => appendChunk(vendor, stream, chunk));

  // Structured messages are separate from raw stdout/stderr. Both runner modes
  // use this path for lifecycle metadata such as readiness, URL, and errors.
  runner.onMessage((message) => handleVendorMessage(vendor, message));

  Promise.resolve(runner.start()).catch((error) => {
    handleVendorMessage(vendor, { type: "error", message: error.stack ?? error.message });
  });
}

// Apply one structured message from a vendor runner to manager state.
function handleVendorMessage(vendor: VendorRuntimeState, message: VendorMessage) {
  if (message.type === "ready") {
    vendor.status = "ready";
    vendor.url = typeof message.url === "string" ? message.url : undefined;
    scheduleRender();
  }

  // `status` lets a vendor expose an intermediate state such as `watching`.
  if (message.type === "status" && typeof message.status === "string") {
    vendor.status = message.status;
    scheduleRender();
  }

  if (message.type === "error") {
    vendor.status = "error";
    scheduleRender();
  }
}

// Keep raw worker output for later terminal replay. When the attached vendor is
// active, pass through new chunks immediately so the terminal keeps moving.
function appendChunk(vendor: VendorRuntimeState, stream: OutputStream, chunk: Buffer) {
  recordRawOutput(vendor, stream, chunk);
  if (screen === "terminal" && activeVendorId === vendor.id) {
    writeTerminalOutput(stream, chunk);
  }
}

function recordRawOutput(vendor: VendorRuntimeState, stream: OutputStream, chunk: Buffer) {
  vendor.rawOutput.append(stream, chunk);
}

// Put stdin into raw keypress mode and route keys according to the active screen.
function setupInteractiveInput() {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", (input, key) => {
    if (key.ctrl && key.name === "c") {
      shutdown(0, "received Ctrl+C");
      return;
    }

    if (screen === "terminal") {
      handleTerminalKey(input, key);
      return;
    }

    if (key.name === "q") {
      shutdown(0, "quit requested");
      return;
    }

    if (screen === "menu") {
      handleMenuKey(key);
    }
  });
}

// Handle keys while the menu is visible.
function handleMenuKey(key: readline.Key) {
  if (key.name === "up") {
    // Wrap around so repeated Up/Down can cycle through all vendors.
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
    enterVendorTerminal(runtimes[selectedIndex]);
  }
}

function handleTerminalKey(input: string | undefined, key: readline.Key) {
  if (key.name === "escape") {
    leaveVendorTerminal();
    return;
  }

  const vendor = runtimes.find((item) => item.id === activeVendorId);
  if (input && vendor?.runner?.kind === "worker") {
    vendor.runner.writeInput(input);
  }
}

function enterVendorTerminal(vendor: VendorRuntimeState | undefined) {
  if (!vendor || runnerMode !== "worker") return;

  activeVendorId = vendor.id;
  screen = "terminal";
  renderPending = false;

  process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
  for (const entry of vendor.rawOutput.entries()) {
    writeTerminalOutput(entry.stream, entry.chunk);
  }
}

function leaveVendorTerminal() {
  screen = "menu";
  activeVendorId = undefined;
  process.stdout.write("\x1b[2J\x1b[H");
  scheduleRender();
}

// Schedule one screen redraw. Rendering through setImmediate batches together
// status updates that arrive in the same tick.
function scheduleRender() {
  if (renderPending || shuttingDown || screen === "terminal") return;

  renderPending = true;
  setImmediate(() => {
    renderPending = false;
    render();
  });
}

// Redraw the whole terminal. This intentionally uses a tiny custom renderer so
// the demo does not depend on a terminal UI framework.
function render() {
  if (screen === "terminal") return;

  const columns = process.stdout.columns || 100;
  const rows = process.stdout.rows || 30;
  const lines = renderMenu(columns, rows);

  process.stdout.write("\x1b[?25l");
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(lines.join("\n"));
}

// Build the menu screen as an array of terminal lines.
function renderMenu(columns: number, rows: number) {
  const lines = [
    `demo-integrations (${runnerMode} runner)`,
    "",
    "Use Up/Down and Enter for raw terminal. Press q or Ctrl+C to stop.",
    "",
  ];

  runtimes.forEach((vendor, index) => {
    // `marker` visually highlights the item controlled by Up/Down.
    const marker = index === selectedIndex ? ">" : " ";
    // Fixed-width fields keep the menu readable while statuses change.
    const label = vendor.label.padEnd(22);
    const status = vendor.status.padEnd(10);
    const url = vendor.url ? ` ${vendor.url}` : "";
    lines.push(fitLine(`${marker} ${label} ${status} ${vendor.hint}${url}`, columns));
  });

  return fillScreen(lines, rows);
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

// Stop every runner and restore the terminal before exiting the parent process.
async function shutdown(code: number, reason?: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  // Leave raw mode and show the cursor even if runners keep printing while
  // they shut down.
  process.stdin.setRawMode(false);
  process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");

  process.stdout.write(`Stopping demo-integrations${reason ? ` (${reason})` : ""}...\n`);

  for (const vendor of runtimes) {
    // Ask runners to close their dev server/watch process cleanly first.
    await vendor.runner?.stop();
  }

  // Give cooperative runners a short window to close. This keeps shutdown fast
  // if a third-party tool hangs.
  await Promise.race([
    Promise.allSettled(runtimes.map((vendor) => vendor.exitPromise)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  // Force-terminate any runner that ignored or missed the shutdown message.
  await Promise.allSettled(
    runtimes.map(async (vendor) => {
      if (vendor.runner) await vendor.runner.terminate();
    })
  );

  process.stdout.write("\x1b[?25h");

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
