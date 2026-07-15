import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { groupSelectedComponentsByEnv, loadWorkspace, selectComponentRefs } from "./workspace.js";

describe("workspace runtime", () => {
  it("loads explicit components, external JSON envs, and deterministic groups", async () => {
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

    const workspace = await loadWorkspace(workspaceRoot);

    expect(workspace.components.map((item) => [item.id, item.env.packageName])).toEqual([
      ["lib/math", "@env/node"],
      ["ui/button", "@env/react"],
      ["vue/card", "@env/vue"],
    ]);
    expect(workspace.groups.map((group) => [
      group.env.packageName,
      group.env.requestedVersion,
      group.env.installedVersion,
      group.components.map((item) => item.id),
    ])).toEqual([
      ["@env/node", "1.0.0", "1.0.0", ["lib/math"]],
      ["@env/react", "1.0.0", "1.0.0", ["ui/button"]],
      ["@env/vue", "1.0.0", "1.0.0", ["vue/card"]],
    ]);

    expect(groupSelectedComponentsByEnv(workspace, [
      { id: "vue/card", rootDir: path.join(workspaceRoot, "components/vue/card"), packageName: "@scope/vue.card" },
      { id: "lib/math", rootDir: path.join(workspaceRoot, "components/lib/math"), packageName: "@scope/lib.math" },
    ]).map((group) => group.env.packageName)).toEqual(["@env/node", "@env/vue"]);
    expect(selectComponentRefs(workspace.components, ["ui/*"]).map((item) => item.id)).toEqual(["ui/button"]);
    expect(() => selectComponentRefs(workspace.components, ["missing/**"]))
      .toThrow("--filter did not match any components: missing/**");
  });

  it("does not discover unregistered source directories", async () => {
    const workspaceRoot = await createWorkspace([
      component("components/lib/math", "lib/math", "@scope/lib.math", "@env/node"),
    ]);
    await mkdir(path.join(workspaceRoot, "components/unlisted"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "components/unlisted/index.ts"), "export const hidden = true;\n");
    await installEnv(workspaceRoot, "@scope/lib.math", "@env/node");

    const workspace = await loadWorkspace(workspaceRoot);
    expect(workspace.components.map((item) => item.id)).toEqual(["lib/math"]);
    expect(workspace.config.components).toEqual([
      component("components/lib/math", "lib/math", "@scope/lib.math", "@env/node"),
    ]);
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
