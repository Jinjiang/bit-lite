import path from "node:path";
import { BitLiteError } from "./errors.js";
import { matchPattern } from "./patterns.js";
import { runService } from "./runtime.js";
import { loadWorkspace } from "./workspace.js";
import type { WorkspaceRuntime } from "./types.js";

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
        const serviceWorkspace =
          parsed.serviceName === "test" && parsed.watch ? overrideServiceConfig(workspace, "test", { watch: true }) : workspace;
        const results = await runService(serviceWorkspace, parsed.serviceName);
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

function printServiceResults(serviceName: string, results: Awaited<ReturnType<typeof runService>>) {
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
