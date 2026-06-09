import path from "node:path";
import { BitLiteError } from "./errors.js";
import { matchPattern } from "./patterns.js";
import { runService } from "./runtime.js";
import { loadServicesForEnv } from "./services.js";
import { loadWorkspace } from "./workspace.js";
import type { ServiceResult, WorkspaceRuntime } from "./types.js";

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.help || !parsed.command) {
    printUsage();
    return 0;
  }

  try {
    const loadedWorkspace = await loadWorkspace(parsed.workspaceRoot);
    const workspace = parsed.filterPattern ? filterWorkspace(loadedWorkspace, parsed.filterPattern) : loadedWorkspace;
    switch (parsed.command) {
      case "components":
        printComponents(workspace.components);
        return 0;
      case "envs":
        printEnvs(workspace.envs);
        return 0;
      case "start": {
        const results = await runService(overrideServiceConfig(workspace, "preview", { start: true }), "preview");
        printServiceResults("start", results);
        return results.every(({ result }) => result.ok) ? 0 : 1;
      }
      case "run": {
        if (!parsed.serviceName) throw new BitLiteError("run requires a service name");
        if (parsed.serviceName === "test" && parsed.watch) {
          const results = await runTestWatch(workspace);
          printServiceResults("test", results);
          return results.every(({ result }) => result.ok) ? 0 : 1;
        }
        const results = await runService(workspace, parsed.serviceName);
        printServiceResults(parsed.serviceName, results);
        return results.every(({ result }) => result.ok) ? 0 : 1;
      }
      default:
        throw new BitLiteError(`unknown command "${parsed.command}"`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}

type ParsedArgs = {
  command: string | undefined;
  serviceName: string | undefined;
  workspaceRoot: string;
  filterPattern: string | undefined;
  watch: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const remaining: string[] = [];
  let workspaceRoot = process.cwd();
  let filterPattern: string | undefined;
  let watch = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--workspace" || arg === "-w") {
      const value = argv[index + 1];
      if (!value) throw new BitLiteError("--workspace requires a path");
      workspaceRoot = path.resolve(value);
      index += 1;
    } else if (arg === "--filter") {
      const value = argv[index + 1];
      if (!value) throw new BitLiteError("--filter requires a pattern");
      filterPattern = value;
      index += 1;
    } else if (arg === "--watch") {
      watch = true;
    } else if (arg) {
      remaining.push(arg);
    }
  }

  return {
    command: remaining[0],
    serviceName: remaining[1],
    workspaceRoot,
    filterPattern,
    watch,
    help,
  };
}

function printUsage() {
  console.log(`bit-lite

Usage:
  bit-lite components [--workspace <dir>] [--filter <pattern>]
  bit-lite envs [--workspace <dir>]
  bit-lite start [--workspace <dir>] [--filter <pattern>]
  bit-lite run <service> [--workspace <dir>] [--filter <pattern>] [--watch]
`);
}

function filterWorkspace(workspace: WorkspaceRuntime, pattern: string): WorkspaceRuntime {
  const components = workspace.components.filter((component) => matchPattern(component.id, pattern));
  const componentIds = new Set(components.map((component) => component.id));
  const groups = workspace.groups
    .map((group) => ({
      ...group,
      components: group.components.filter((component) => componentIds.has(component.id)),
    }))
    .filter((group) => group.components.length > 0);

  return {
    ...workspace,
    components,
    groups,
  };
}

function overrideServiceConfig(workspace: WorkspaceRuntime, serviceName: string, override: Record<string, unknown>): WorkspaceRuntime {
  return {
    ...workspace,
    groups: workspace.groups.map((group) => ({
      ...group,
      env: {
        ...group.env,
        services: {
          ...group.env.services,
          [serviceName]: {
            ...readObjectConfig(group.env.services[serviceName]),
            ...override,
          },
        },
      },
    })),
  };
}

type PrintableServiceResult = {
  envName: string;
  result: ServiceResult;
};

async function runTestWatch(workspace: WorkspaceRuntime) {
  const runnableGroups = [];
  for (const group of workspace.groups) {
    const services = await loadServicesForEnv(workspace.workspaceRoot, group.env.services);
    const runnable = services.find(({ serviceRef, service }) => serviceRef === "test" || service.name === "test");
    if (!runnable) continue;
    runnableGroups.push({ group, runnable });
  }

  if (runnableGroups.length === 0) {
    throw new BitLiteError('service "test" is not configured for any discovered env');
  }

  console.log(`watching tests for ${runnableGroups.map(({ group }) => group.envName).join(", ")}`);
  console.log("press q to quit");
  const controller = new AbortController();
  const cleanupControls = installWatchControls(controller);
  try {
    return await Promise.all(
      runnableGroups.map(async ({ group, runnable }) => {
        console.log(`[${group.envName}] starting test watcher`);
        const result = await runnable.service.run({
          workspaceRoot: workspace.workspaceRoot,
          envName: group.envName,
          components: group.components,
          serviceConfig: {
            ...readObjectConfig(runnable.config),
            watch: true,
            signal: controller.signal,
          },
        });
        console.log(`[${group.envName}] test watcher exited`);
        return {
          envName: group.envName,
          serviceName: runnable.service.name,
          result,
        };
      })
    );
  } finally {
    cleanupControls();
  }
}

function installWatchControls(controller: AbortController) {
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    console.log("\nstopping test watchers");
    controller.abort();
  };
  const onData = (chunk: Buffer) => {
    const value = chunk.toString("utf8");
    if (value.includes("q") || value.includes("\u0003")) stop();
  };
  const onSigint = () => stop();

  process.on("SIGINT", onSigint);
  process.stdin.on("data", onData);
  process.stdin.resume();
  const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  return () => {
    process.off("SIGINT", onSigint);
    process.stdin.off("data", onData);
    if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
  };
}

function printServiceResults(serviceName: string, results: PrintableServiceResult[]) {
  results.forEach(({ envName, result }) => {
    if (result.message) console.log(result.message);
    console.log(`${result.ok ? "ok" : "failed"} ${serviceName} (${envName})`);
  });
}

function readObjectConfig(config: unknown): Record<string, unknown> {
  if (typeof config === "object" && config !== null && !Array.isArray(config)) return config as Record<string, unknown>;
  return {};
}

function printComponents(components: Array<{ id: string; rootDir: string; envName: string }>) {
  if (components.length === 0) {
    console.log("no components discovered");
    return;
  }
  components.forEach((component) => {
    console.log(`${component.id}  ${component.envName}  ${component.rootDir}`);
  });
}

function printEnvs(envs: Record<string, { services: Record<string, unknown> }>) {
  Object.entries(envs)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([name, env]) => {
      const services = Object.keys(env.services);
      console.log(`${name}  ${services.length ? services.join(", ") : "(no services)"}`);
    });
}
