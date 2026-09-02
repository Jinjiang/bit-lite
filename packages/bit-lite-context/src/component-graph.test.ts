import { describe, expect, it } from "vitest";
import {
  getComponentPrerequisitePackageNames,
  layerComponentsByPrerequisites,
  orderComponentsByPrerequisites,
} from "./component-graph.js";
import type { Workspace, WorkspaceComponent } from "./types/index.js";

describe("component prerequisite graph", () => {
  it("counts dependency edges and the env edge as prerequisites", () => {
    const plain = component("lib/math", "@scope/lib.math");
    const withDependency = component("ui/button", "@scope/ui.button", {
      dependsOn: ["@scope/lib.math"],
    });
    const withEnv = component("ui/card", "@scope/ui.card", { env: "@scope/env.react" });
    const withBoth = component("ui/panel", "@scope/ui.panel", {
      dependsOn: ["@scope/lib.math"],
      env: "@scope/env.react",
    });

    expect(getComponentPrerequisitePackageNames(plain)).toEqual([]);
    expect(getComponentPrerequisitePackageNames(withDependency)).toEqual(["@scope/lib.math"]);
    expect(getComponentPrerequisitePackageNames(withEnv)).toEqual(["@scope/env.react"]);
    expect(getComponentPrerequisitePackageNames(withBoth)).toEqual([
      "@scope/lib.math",
      "@scope/env.react",
    ]);
  });

  it("orders dependencies before the components that use them", () => {
    const workspace = workspaceOf([
      component("ui/button", "@scope/ui.button", { dependsOn: ["@scope/lib.math"] }),
      component("lib/math", "@scope/lib.math"),
    ]);

    expect(ids(orderComponentsByPrerequisites(workspace))).toEqual(["lib/math", "ui/button"]);
  });

  it("orders an env component before the components that select it", () => {
    const workspace = workspaceOf([
      component("ui/button", "@scope/ui.button", { env: "@scope/env.react" }),
      component("envs/react", "@scope/env.react", { kind: "env" }),
    ]);

    expect(ids(orderComponentsByPrerequisites(workspace))).toEqual(["envs/react", "ui/button"]);
  });

  it("orders a graph mixing dependency and env edges", () => {
    const workspace = workspaceOf([
      component("ui/panel", "@scope/ui.panel", {
        dependsOn: ["@scope/ui.button"],
        env: "@scope/env.react",
      }),
      component("ui/button", "@scope/ui.button", {
        dependsOn: ["@scope/lib.math"],
        env: "@scope/env.react",
      }),
      component("envs/react", "@scope/env.react", { kind: "env" }),
      component("lib/math", "@scope/lib.math"),
    ]);

    const ordered = ids(orderComponentsByPrerequisites(workspace));

    expect(ordered.indexOf("lib/math")).toBeLessThan(ordered.indexOf("ui/button"));
    expect(ordered.indexOf("envs/react")).toBeLessThan(ordered.indexOf("ui/button"));
    expect(ordered.indexOf("ui/button")).toBeLessThan(ordered.indexOf("ui/panel"));
  });

  it("produces the same order regardless of how the caller sorted the selection", () => {
    const components = [
      component("ui/button", "@scope/ui.button", { dependsOn: ["@scope/lib.math"] }),
      component("lib/math", "@scope/lib.math"),
      component("vue/card", "@scope/vue.card"),
    ];
    const workspace = workspaceOf(components);

    const forward = ids(orderComponentsByPrerequisites(workspace, components));
    const reversed = ids(orderComponentsByPrerequisites(workspace, [...components].reverse()));

    expect(reversed).toEqual(forward);
  });

  it("treats prerequisites outside the selection as already satisfied", () => {
    const workspace = workspaceOf([
      component("ui/button", "@scope/ui.button", { dependsOn: ["@scope/lib.math"] }),
      component("lib/math", "@scope/lib.math"),
    ]);
    const selection = [workspace.components[0]!];

    expect(ids(orderComponentsByPrerequisites(workspace, selection))).toEqual(["ui/button"]);
  });

  it("groups independent components into one layer and dependents into later layers", () => {
    const workspace = workspaceOf([
      component("ui/panel", "@scope/ui.panel", { dependsOn: ["@scope/ui.button"] }),
      component("ui/button", "@scope/ui.button", { dependsOn: ["@scope/lib.math"] }),
      component("lib/math", "@scope/lib.math"),
      component("vue/card", "@scope/vue.card"),
    ]);

    expect(layerComponentsByPrerequisites(workspace).map(ids)).toEqual([
      ["lib/math", "vue/card"],
      ["ui/button"],
      ["ui/panel"],
    ]);
  });

  it("places a component after the deepest prerequisite it waits on", () => {
    const workspace = workspaceOf([
      component("ui/panel", "@scope/ui.panel", {
        dependsOn: ["@scope/lib.math", "@scope/ui.button"],
      }),
      component("ui/button", "@scope/ui.button", { dependsOn: ["@scope/lib.math"] }),
      component("lib/math", "@scope/lib.math"),
    ]);

    expect(layerComponentsByPrerequisites(workspace).map(ids)).toEqual([
      ["lib/math"],
      ["ui/button"],
      ["ui/panel"],
    ]);
  });

  it("returns no layers for an empty selection", () => {
    const workspace = workspaceOf([component("lib/math", "@scope/lib.math")]);

    expect(layerComponentsByPrerequisites(workspace, [])).toEqual([]);
  });

  it("reports a dependency cycle as the cycle itself", () => {
    const workspace = workspaceOf([
      component("a", "@scope/a", { dependsOn: ["@scope/b"] }),
      component("b", "@scope/b", { dependsOn: ["@scope/a"] }),
    ]);

    expect(() => orderComponentsByPrerequisites(workspace)).toThrow(
      "component package or environment dependency cycle detected: @scope/a -> @scope/b -> @scope/a"
    );
  });

  it("reports a cycle running through an env edge", () => {
    const workspace = workspaceOf([
      component("envs/react", "@scope/env.react", {
        kind: "env",
        dependsOn: ["@scope/lib.math"],
      }),
      component("lib/math", "@scope/lib.math", { env: "@scope/env.react" }),
    ]);

    expect(() => orderComponentsByPrerequisites(workspace)).toThrow(
      /dependency cycle detected: @scope\/env\.react -> @scope\/lib\.math -> @scope\/env\.react/
    );
  });

  it("excludes the route that reached a cycle from the reported path", () => {
    const workspace = workspaceOf([
      component("entry", "@scope/entry", { dependsOn: ["@scope/a"] }),
      component("a", "@scope/a", { dependsOn: ["@scope/b"] }),
      component("b", "@scope/b", { dependsOn: ["@scope/a"] }),
    ]);

    expect(() => orderComponentsByPrerequisites(workspace)).toThrow(
      "component package or environment dependency cycle detected: @scope/a -> @scope/b -> @scope/a"
    );
  });

  it("rejects a cycle from the layering entry point with the same diagnostic", () => {
    const workspace = workspaceOf([
      component("a", "@scope/a", { dependsOn: ["@scope/b"] }),
      component("b", "@scope/b", { dependsOn: ["@scope/a"] }),
    ]);

    expect(() => layerComponentsByPrerequisites(workspace)).toThrow(
      "component package or environment dependency cycle detected: @scope/a -> @scope/b -> @scope/a"
    );
  });
});

function ids(components: readonly WorkspaceComponent[]) {
  return components.map((component) => component.id);
}

function component(
  id: string,
  packageName: string,
  options: {
    dependsOn?: readonly string[];
    env?: string;
    kind?: "component" | "env";
  } = {}
): WorkspaceComponent {
  const dependsOn = options.dependsOn ?? [];
  return {
    id,
    path: `components/${id}`,
    rootDir: `/workspace/components/${id}`,
    packageName,
    kind: options.kind ?? "component",
    env: { packageName: options.env ?? "demo-env-node", version: options.env ? "workspace:*" : "0.0.0" },
    mainFile: `/workspace/components/${id}/index.ts`,
    mainFileRelative: "index.ts",
    dependencies: Object.fromEntries(dependsOn.map((name) => [name, "workspace:*"])),
    devDependencies: {},
    peerDependencies: {},
    internalDependencyPackageNames: [...dependsOn],
    internalEnvPackageName: options.env,
  };
}

function workspaceOf(components: WorkspaceComponent[]): Workspace {
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
