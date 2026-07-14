import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { groupSelectedComponentsByEnv, loadWorkspace, selectComponentRefs } from "./workspace.js";

describe("workspace runtime", () => {
  it("discovers components and assigns envs", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-"));
    await writeFile(
      path.join(workspaceRoot, "bit-lite.json"),
      JSON.stringify(
        {
          envs: {
            node: {
              services: {
                inspect: {
                  vendor: "default",
                  config: { source: "node" },
                },
              },
            },
            react: {
              extends: "node",
              services: {
                inspect: {
                  vendor: "default",
                  config: { source: "react" },
                },
              },
            },
            vue: {
              extends: "node",
              services: {
                inspect: {
                  vendor: "default",
                  config: { source: "vue" },
                },
              },
            },
          },
          components: {
            "components/ui/**": "react",
            "components/vue/**": "vue",
            "components/lib/**": "node",
          },
        },
        null,
        2
      )
    );
    await mkdir(path.join(workspaceRoot, "components/lib/math"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "components/ui/button"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "components/vue/card"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "components/lib/math/index.ts"), "export const add = () => 1;\n");
    await writeFile(path.join(workspaceRoot, "components/ui/button/index.ts"), "export const Button = {};\n");
    await writeFile(path.join(workspaceRoot, "components/vue/card/index.vue"), "<template><div>Card</div></template>\n");

    const workspace = await loadWorkspace(workspaceRoot);

    expect(workspace.components.map((component) => [component.id, component.envName])).toEqual([
      ["components/lib/math", "node"],
      ["components/ui/button", "react"],
      ["components/vue/card", "vue"],
    ]);
    expect(workspace.groups.map((group) => [group.envName, group.components.map((component) => component.id)])).toEqual([
      ["node", ["components/lib/math"]],
      ["react", ["components/ui/button"]],
      ["vue", ["components/vue/card"]],
    ]);

    expect(
      groupSelectedComponentsByEnv(workspace, [
        { id: "components/vue/card", rootDir: path.join(workspaceRoot, "components/vue/card") },
        { id: "components/lib/math", rootDir: path.join(workspaceRoot, "components/lib/math") },
      ]).map((group) => [group.envName, group.components.map((component) => component.id)])
    ).toEqual([
      ["node", ["components/lib/math"]],
      ["vue", ["components/vue/card"]],
    ]);

    expect(selectComponentRefs(workspace.components, ["components/ui/*"]).map((component) => component.id)).toEqual([
      "components/ui/button",
    ]);
    expect(() => selectComponentRefs(workspace.components, ["missing/**"])).toThrow(
      "--filter did not match any components: missing/**"
    );
  });

  it("loads only explicit component records with their configured ids and envs", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-explicit-"));
    await writeFile(
      path.join(workspaceRoot, "bit-lite.json"),
      JSON.stringify({
        envs: { node: {}, react: {} },
        components: [
          { path: "components/lib/math", id: "lib/math", envName: "node" },
          { path: "components/ui/button", id: "ui/button", envName: "react" },
        ],
      })
    );
    await mkdir(path.join(workspaceRoot, "components/lib/math"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "components/ui/button"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "components/unlisted"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "components/lib/math/index.ts"), "export const add = () => 1;\n");
    await writeFile(path.join(workspaceRoot, "components/ui/button/index.ts"), "export const Button = {};\n");
    await writeFile(path.join(workspaceRoot, "components/unlisted/index.ts"), "export const Hidden = {};\n");

    const workspace = await loadWorkspace(workspaceRoot);

    expect(workspace.components.map(({ id, envName }) => [id, envName])).toEqual([
      ["lib/math", "node"],
      ["ui/button", "react"],
    ]);
    expect(workspace.config.components).toEqual([
      { path: "components/lib/math", id: "lib/math", envName: "node" },
      { path: "components/ui/button", id: "ui/button", envName: "react" },
    ]);
  });
});
