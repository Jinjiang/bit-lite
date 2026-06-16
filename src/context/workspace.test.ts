import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runService } from "../runtime.js";
import { loadWorkspace } from "./workspace.js";

describe("workspace runtime", () => {
  it("discovers components, assigns envs, and runs inspect", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-"));
    await writeFile(
      path.join(workspaceRoot, "bit-lite.json"),
      JSON.stringify(
        {
          defaultEnv: "node",
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
    const results = await runService(workspace, "inspect");

    expect(workspace.components.map((component) => [component.id, component.envName])).toEqual([
      ["components/lib/math", "node"],
      ["components/ui/button", "react"],
      ["components/vue/card", "vue"],
    ]);
    expect(results).toHaveLength(3);
    expect(results.map((result) => result.envName).sort()).toEqual(["node", "react", "vue"]);
    expect(results.every((result) => result.result.ok)).toBe(true);
  });
});
