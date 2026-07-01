import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CliArguments, ComponentRuntime, WorkspaceRuntime } from "bit-lite-context";
import type { ServiceVendorInput } from "bit-lite-vendors";

const packageSrcDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(packageSrcDir, "../../demo-workspace");

const components: ComponentRuntime[] = [
  {
    id: "components/demo/foo-alpha",
    rootDir: path.join(workspaceRoot, "components/demo/foo-alpha"),
    envName: "demo-node",
  },
  {
    id: "components/demo/bar-beta",
    rootDir: path.join(workspaceRoot, "components/demo/bar-beta"),
    envName: "demo-node",
  },
  {
    id: "components/demo/baz-gamma",
    rootDir: path.join(workspaceRoot, "components/demo/baz-gamma"),
    envName: "demo-node",
  },
];

const demoNodeEnv = {
  name: "demo-node",
  services: {
    foo: {
      vendor: "x",
      config: {
        label: "demo foo x",
      },
    },
    bar: {
      vendor: "x",
      config: {
        port: 43100,
      },
    },
    baz: {
      vendor: "x",
      config: {
        watch: false,
      },
    },
  },
};

export const demoWorkspaceRuntime: WorkspaceRuntime = {
  workspaceRoot,
  config: {
    envs: {
      "demo-node": demoNodeEnv,
    },
    components: {
      "components/demo/**": "demo-node",
    },
  },
  envs: {
    "demo-node": demoNodeEnv,
  },
  components,
  groups: [
    {
      envName: "demo-node",
      env: demoNodeEnv,
      components: components.map(({ id, rootDir }) => ({ id, rootDir })),
    },
  ],
};

export type DemoInputOptions<Config = Record<string, unknown>> = {
  serviceName: "foo" | "bar" | "baz" | string;
  config?: Config;
  args?: CliArguments;
  componentIds?: string[];
};

export function createDemoInput<Config = Record<string, unknown>>(
  options: DemoInputOptions<Config>
): ServiceVendorInput<Config, CliArguments> {
  const selectedComponents = options.componentIds
    ? components.filter((component) => options.componentIds?.includes(component.id))
    : components;

  return {
    components: selectedComponents.map(({ id, rootDir }) => ({ id, rootDir })),
    config: options.config ?? ({} as Config),
    args: options.args ?? [],
  };
}
