import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Workspace, WorkspaceComponent } from "bit-lite-context";
import type { ParsedCliArgs } from "../cli-args-types.js";
import type { EnvContext, WorkspaceContext } from "bit-lite-env-resolution";
import { assertNoSwallowedComponents, prepareResolvedCommandSelection } from "./command-selection.js";

describe("resolved command selection", () => {
  it("prepares once and preserves canonical filtered component and env references", async () => {
    const first = component("scope/first", "@scope/first", "env-a");
    const second = component("scope/second", "@scope/second", "env-b");
    const workspace = createWorkspace([first, second]);
    const firstEnv = env("env-a");
    const secondEnv = env("env-b");
    const context: WorkspaceContext = {
      workspace,
      components: [
        { component: first, env: firstEnv },
        { component: second, env: secondEnv },
      ],
    };
    const parsed = parsedArgs(["scope/first"]);
    const prepareWorkspace = vi.fn(async () => ({ workspace, context }));

    const selection = await prepareResolvedCommandSelection(parsed, prepareWorkspace);

    expect(prepareWorkspace).toHaveBeenCalledOnce();
    expect(prepareWorkspace).toHaveBeenCalledWith(parsed.workspaceRoot);
    expect(selection.parsed).toBe(parsed);
    expect(selection.context).toBe(context);
    expect(selection.context.workspace).toBe(workspace);
    expect(selection.components).toEqual([first]);
    expect(selection.components[0]).toBe(workspace.components[0]);
    expect(selection.groups).toHaveLength(1);
    expect(selection.groups[0]?.env).toBe(firstEnv);
    expect(selection.groups[0]?.components[0]).toBe(first);
  });
});

/**
 * An undeclared option takes the word after it. That is right for a vendor
 * option and its value, and wrong when the word was a component — and only the
 * workspace knows which happened.
 */
describe("swallowed component guard", () => {
  const workspace = createWorkspace([
    component("ui/button", "@scope/button", "env-a"),
    component("lib/math", "@scope/math", "env-a"),
  ]);

  function withConsumed(consumed: { option: string; value: string }[]): ParsedCliArgs {
    return { ...parsedArgs([]), command: "test", consumedBareWords: consumed };
  }

  it("fails when an undeclared option consumed a registered component", () => {
    const parsed = withConsumed([{ option: "--verbose", value: "ui/button" }]);

    expect(() => assertNoSwallowedComponents(parsed, workspace)).toThrow(
      '--verbose consumed "ui/button", which is a registered component'
    );
  });

  it("names both spellings that resolve the ambiguity", () => {
    const parsed = withConsumed([{ option: "--verbose", value: "ui/button" }]);

    expect(() => assertNoSwallowedComponents(parsed, workspace)).toThrow("--verbose=<value>");
    expect(() => assertNoSwallowedComponents(parsed, workspace)).toThrow(
      "move ui/button before --verbose"
    );
  });

  it("leaves an ordinary vendor value alone", () => {
    // `test --reporter verbose ui/button` — both meanings intact.
    const parsed = withConsumed([{ option: "--reporter", value: "verbose" }]);

    expect(() => assertNoSwallowedComponents(parsed, workspace)).not.toThrow();
  });

  it("does nothing when no undeclared option consumed anything", () => {
    expect(() => assertNoSwallowedComponents(withConsumed([]), workspace)).not.toThrow();
  });

  it("only matches a component ID exactly", () => {
    const parsed = withConsumed([{ option: "--verbose", value: "ui/butto" }]);

    expect(() => assertNoSwallowedComponents(parsed, workspace)).not.toThrow();
  });
});

function parsedArgs(componentFilters: string[]): ParsedCliArgs {
  return {
    command: "start",
    args: { raw: ["start"], options: {}, passthrough: [] },
    workspaceRoot: "/workspace",
    componentFilters,
    help: { kind: "none" },
    consumedBareWords: [],
  };
}

function createWorkspace(components: WorkspaceComponent[]): Workspace {
  return {
    rootDir: "/workspace",
    configPath: "/workspace/bit-lite.json",
    config: {
      components: components.map((item) => ({
        path: item.path,
        id: item.id,
        packageName: item.packageName,
        env: item.env,
      })),
    },
    components,
  };
}

function component(id: string, packageName: string, envPackageName: string): WorkspaceComponent {
  const rootDir = path.join("/workspace", id);
  return {
    id,
    path: id,
    rootDir,
    packageName,
    kind: "component",
    env: { packageName: envPackageName, version: "1.0.0" },
    mainFile: path.join(rootDir, "index.ts"),
    mainFileRelative: "index.ts",
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    internalDependencyPackageNames: [],
    internalEnvPackageName: undefined,
  };
}

function env(packageName: string): EnvContext {
  const location = {
    identity: { packageName, version: "1.0.0" },
    rootDir: path.join("/workspace/node_modules", packageName),
    entryFile: path.join("/workspace/node_modules", packageName, "index.json"),
  };
  return {
    identity: { packageName, requestedVersion: "1.0.0", installedVersion: "1.0.0" },
    package: location,
    config: undefined,
    services: {},
    inheritance: [location.identity],
  };
}
