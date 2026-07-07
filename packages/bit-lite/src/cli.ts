import { loadWorkspace, matchPattern, parseArgs } from "bit-lite-context";
import { testService } from "bit-lite-services";
import type { ComponentRef, ComponentRuntime, ParsedCliArgs } from "bit-lite-context";
import type { ServiceDefinition } from "bit-lite-services";
import { BitLiteError } from "./utils/errors.js";

const services: Record<string, ServiceDefinition> = {
  test: testService,
};

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.help || !parsed.command) {
    printUsage();
    return 0;
  }

  try {
    const service = services[parsed.command];
    if (service) {
      await runConfiguredService(service, parsed);
      return 0;
    }

    throw new BitLiteError(`command "${parsed.command}" is not registered in this clean-slate build`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}

async function runConfiguredService(service: ServiceDefinition, parsed: ParsedCliArgs) {
  const workspace = await loadWorkspace(parsed.workspaceRoot);
  const components = selectServiceComponents(workspace.components, parsed.componentFilters);

  return service.run({
    components,
    args: parsed.args,
    context: workspace,
  });
}

function printUsage() {
  console.log(`bit-lite

Usage:
  bit-lite --help
  bit-lite <command> [--workspace <dir>] [--filter <component-pattern>] [...args]

Commands:
  test    run the configured test service
`);
}

function selectServiceComponents(components: ComponentRuntime[], filters: string[]): ComponentRef[] {
  const selected =
    filters.length === 0
      ? components
      : components.filter((component) => filters.some((filter) => matchPattern(component.id, filter)));

  if (filters.length > 0 && selected.length === 0) {
    throw new BitLiteError(`--filter did not match any components: ${filters.join(", ")}`);
  }

  return selected.map(({ id, rootDir }) => ({ id, rootDir }));
}
