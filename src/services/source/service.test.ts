import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readComponentSourceFile, sourceService } from "./service.js";
import type { SourceTreeNode } from "../../types/services/source.js";

describe("source service", () => {
  it("indexes the full component file tree and reads raw file text", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-source-"));
    const componentRoot = path.join(workspaceRoot, "components/vue/card");
    await mkdir(path.join(componentRoot, "nested"), { recursive: true });
    await writeFile(path.join(componentRoot, "index.vue"), "<template><h1>{{ title }}</h1></template>\n");
    await writeFile(path.join(componentRoot, "preview.ts"), "export default function mount() {}\n");
    await writeFile(path.join(componentRoot, "card.docs.md"), "# Card\n");
    await writeFile(path.join(componentRoot, "index.test.ts"), "expect(true).toBe(true);\n");
    await writeFile(path.join(componentRoot, "nested/helper.ts"), "export const value = 1;\n");

    const task = sourceService.run(
      {
        components: [{ id: "components/vue/card", rootDir: componentRoot }],
        config: {},
        args: undefined,
      },
      {
        workspaceRoot,
        envName: "vue",
      }
    );
    const result = await task.result;
    const component = result.components[0];

    expect(result.ok).toBe(true);
    expect(component?.envName).toBe("vue");
    expect(flattenPaths(component?.tree.children ?? [])).toEqual([
      "nested",
      "nested/helper.ts",
      "card.docs.md",
      "index.test.ts",
      "index.vue",
      "preview.ts",
    ]);
    await expect(readComponentSourceFile(component!, "index.vue")).resolves.toBe("<template><h1>{{ title }}</h1></template>\n");
    await expect(readComponentSourceFile(component!, "../outside.ts")).rejects.toThrow("invalid source file path");
  });
});

function flattenPaths(nodes: SourceTreeNode[]): string[] {
  return nodes.flatMap((node) => (node.type === "directory" ? [node.path, ...flattenPaths(node.children)] : [node.path]));
}
