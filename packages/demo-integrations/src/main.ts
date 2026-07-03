import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { ManagedTerminal, RawOutputBuffer } from "bit-lite-terminal";
import { createRunner } from "bit-lite-runner";
import type {
  DevServerVendorConfig,
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
    moduleUrl: new URL("./vendors/webpack-dev-server.js", import.meta.url),
    // Dev-server specific options. The vendor will fall back to a random port if busy.
    config: {
      preferredPort: 4301,
    } satisfies DevServerVendorConfig,
  },
  {
    id: "vite",
    label: "Vite Dev Server",
    hint: "Node API: vite.createServer",
    moduleUrl: new URL("./vendors/vite-dev-server.js", import.meta.url),
    config: {
      preferredPort: 4302,
    } satisfies DevServerVendorConfig,
  },
  {
    id: "jest",
    label: "Jest Watch Mode",
    hint: "Node API: jest.runCLI",
    moduleUrl: new URL("./vendors/jest-watch.js", import.meta.url),
  },
  {
    id: "vitest",
    label: "Vitest Watch Mode",
    hint: "Node API: vitest/node.startVitest",
    moduleUrl: new URL("./vendors/vitest-watch.js", import.meta.url),
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
  // Worker runners can receive input when their raw terminal is attached.
  canAttach: runnerMode === "worker",
}));

const terminal = new ManagedTerminal({
  title: () => `demo-integrations (${runnerMode} runner)`,
  items: runtimes,
  canAttach: () => runnerMode === "worker",
  onQuit(reason) {
    void shutdown(0, reason === "ctrl-c" ? "received Ctrl+C" : "quit requested");
  },
});

let shuttingDown = false;

// Start every vendor immediately. The manager is intentionally simple: one
// runner per vendor, all started eagerly so we can compare concurrent output.
for (const vendor of runtimes) {
  startManagedVendor(vendor);
}

terminal.start();

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
  const runner = createRunner<VendorData, VendorMessage>({
    mode: runnerMode,
    target: vendor,
    data: vendorData,
  });

  vendor.runner = runner;
  vendor.writeInput = (chunk) => runner.writeInput(chunk);

  // Keep a per-vendor exit promise. Shutdown races all exits against a timeout
  // before force-terminating any runner that did not close cleanly.
  vendor.exitPromise = runner.exitPromise.then((code) => {
    vendor.status = code === 0 || shuttingDown ? "stopped" : `exited ${code}`;
    terminal.scheduleRender();
    return code;
  });

  // Worker mode emits proxied stdout/stderr here. Inline mode intentionally
  // emits no output events because the tool writes directly to the terminal.
  runner.onOutput((stream, chunk) => terminal.appendOutput(vendor, stream, chunk));

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
    terminal.scheduleRender();
  }

  // `status` lets a vendor expose an intermediate state such as `watching`.
  if (message.type === "status" && typeof message.status === "string") {
    vendor.status = message.status;
    terminal.scheduleRender();
  }

  if (message.type === "error") {
    vendor.status = "error";
    terminal.scheduleRender();
  }
}

// Stop every runner and restore the terminal before exiting the parent process.
async function shutdown(code: number, reason?: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  // Leave raw mode and show the cursor even if runners keep printing while
  // they shut down.
  terminal.stop({ clearScreen: true });

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
