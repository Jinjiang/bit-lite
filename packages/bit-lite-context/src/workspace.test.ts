import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkspace } from "./workspace.js";

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
