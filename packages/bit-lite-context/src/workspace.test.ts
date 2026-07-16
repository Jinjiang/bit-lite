import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getWorkspaceEnvs,
  groupWorkspaceComponentsByEnv,
  readWorkspace,
  resolveWorkspace,
  selectWorkspaceComponents,
} from "./workspace.js";

describe("workspace model", () => {
  it("reads a deterministic JSON-safe base workspace before envs are installed", async () => {
    const workspaceRoot = await createWorkspace([
      component("components/vue/card", "vue/card", "@scope/vue.card", "@env/vue"),
      component("components/lib/math", "lib/math", "@scope/lib.math", "@env/node"),
      component("components/ui/button", "ui/button", "@scope/ui.button", "@env/react"),
    ]);

    const workspace = await readWorkspace(workspaceRoot);

    expect(workspace.components.map((item) => item.id)).toEqual(["lib/math", "ui/button", "vue/card"]);
    expect(Object.keys(workspace)).toEqual(["rootDir", "configPath", "config", "components"]);
    expect(JSON.parse(JSON.stringify(workspace))).toEqual(workspace);
    expect(structuredClone(workspace)).toEqual(workspace);
    expect(workspace).not.toHaveProperty("envs");
    expect(workspace).not.toHaveProperty("groups");
  });

  it("reuses canonical components through selection, context assembly, and grouping", async () => {
    const workspaceRoot = await createWorkspace([
      component("components/lib/math", "lib/math", "@scope/lib.math", "@env/node"),
      component("components/ui/button", "ui/button", "@scope/ui.button", "@env/react"),
      component("components/vue/card", "vue/card", "@scope/vue.card", "@env/vue"),
    ]);
    for (const entry of [
      ["@scope/lib.math", "@env/node"],
      ["@scope/ui.button", "@env/react"],
      ["@scope/vue.card", "@env/vue"],
    ] as const) {
      await installEnv(workspaceRoot, entry[0], entry[1]);
    }

    const workspace = await readWorkspace(workspaceRoot);
    const context = await resolveWorkspace(workspace);
    const selected = selectWorkspaceComponents(workspace, ["ui/*"]);
    const groups = groupWorkspaceComponentsByEnv(context, selected);

    expect(selected[0]).toBe(workspace.components[1]);
    expect(context.components[1]?.component).toBe(workspace.components[1]);
    expect(groups[0]?.components[0]).toBe(workspace.components[1]);
    expect(groups[0]?.env).toBe(context.components[1]?.env);
    expect(getWorkspaceEnvs(context).map((env) => env.env.packageName)).toEqual([
      "@env/node", "@env/react", "@env/vue",
    ]);
    expect(context).not.toHaveProperty("config");
    expect(context).not.toHaveProperty("envs");
    expect(context).not.toHaveProperty("groups");
    expect(() => selectWorkspaceComponents(workspace, ["missing/**"]))
      .toThrow("--filter did not match any components: missing/**");
  });

  it("does not discover unregistered source directories", async () => {
    const workspaceRoot = await createWorkspace([
      component("components/lib/math", "lib/math", "@scope/lib.math", "@env/node"),
    ]);
    await mkdir(path.join(workspaceRoot, "components/unlisted"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "components/unlisted/index.ts"), "export const hidden = true;\n");

    const workspace = await readWorkspace(workspaceRoot);
    expect(workspace.components.map((item) => item.id)).toEqual(["lib/math"]);
  });
});

function component(componentPath: string, id: string, packageName: string, envPackageName: string) {
  return {
    path: componentPath,
    id,
    packageName,
    env: { packageName: envPackageName, version: "1.0.0" },
  };
}

async function createWorkspace(components: ReturnType<typeof component>[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-workspace-"));
  await writeFile(path.join(root, "bit-lite.json"), JSON.stringify({ components }));
  for (const entry of components) {
    const componentRoot = path.join(root, entry.path);
    await mkdir(componentRoot, { recursive: true });
    await writeFile(path.join(componentRoot, "index.ts"), "export const value = true;\n");
    await writeFile(path.join(componentRoot, ".comp.json"), "{}\n");
  }
  return root;
}

async function installEnv(workspaceRoot: string, componentPackageName: string, envPackageName: string) {
  const storeRoot = path.join(workspaceRoot, ".fixture-envs", ...envPackageName.split("/"));
  await mkdir(storeRoot, { recursive: true });
  await writeFile(path.join(storeRoot, "package.json"), JSON.stringify({
    name: envPackageName,
    version: "1.0.0",
    type: "module",
    exports: { ".": "./index.json" },
  }));
  await writeFile(path.join(storeRoot, "index.json"), JSON.stringify({
    name: envPackageName,
    services: { compile: { vendor: "compiler", config: {} } },
  }));
  const installPath = path.join(
    workspaceRoot,
    ".bit-lite/deps/components",
    ...componentPackageName.split("/"),
    "node_modules",
    ...envPackageName.split("/")
  );
  await mkdir(path.dirname(installPath), { recursive: true });
  await symlink(path.relative(path.dirname(installPath), storeRoot), installPath, "dir");
}
