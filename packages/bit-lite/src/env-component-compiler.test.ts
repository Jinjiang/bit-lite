import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readWorkspace } from "bit-lite-context";
import { describe, expect, it } from "vitest";
import { linkComponentPackages } from "./commands/link.js";
import { materializeLocalEnvComponents } from "./env-component-compiler.js";

describe("fixed local env component compiler", () => {
  it("copies the JSON entry, transpiles adjacent TypeScript, and publishes the JSON export", async () => {
    const root = await createEnvWorkspace("export default { value: 1 };\n");
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);
    const materialized = await materializeLocalEnvComponents(workspace);

    expect(materialized.map((component) => component.packageName)).toEqual(["@scope/env.local"]);
    const packageRoot = path.join(root, "node_modules/@scope/env.local");
    expect(JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).exports)
      .toEqual({ ".": "./dist/index.json" });
    expect(JSON.parse(await readFile(path.join(packageRoot, "dist/index.json"), "utf8")).name)
      .toBe("@scope/env.local");
    expect(await readFile(path.join(packageRoot, "dist/support.js"), "utf8"))
      .toContain("export default");
    await expect(readFile(path.join(packageRoot, "dist/.comp.json"), "utf8")).rejects.toThrow();
  });

  it("reports fixed compiler syntax failures without consulting services.compile", async () => {
    const root = await createEnvWorkspace("export default {;\n", {
      compile: { vendor: "this-vendor-must-not-run", config: { arbitrary: true } },
    });
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);
    await expect(materializeLocalEnvComponents(workspace)).rejects.toThrow("fixed env compiler failed");
  });
});

async function createEnvWorkspace(source: string, services: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-fixed-env-"));
  const envRoot = path.join(root, "components/envs/local");
  await mkdir(envRoot, { recursive: true });
  await writeFile(path.join(root, "bit-lite.json"), JSON.stringify({
    components: [{
      path: "components/envs/local",
      id: "envs/local",
      packageName: "@scope/env.local",
      env: { packageName: "@scope/env.local", version: "workspace:*" },
    }],
  }));
  await writeFile(path.join(envRoot, ".comp.json"), JSON.stringify({ kind: "env" }));
  await writeFile(path.join(envRoot, "index.json"), JSON.stringify({
    name: "@scope/env.local",
    services,
  }));
  await writeFile(path.join(envRoot, "support.ts"), source);
  return root;
}
