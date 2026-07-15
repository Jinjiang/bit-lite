import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadComponentPackageRegistry } from "./component-registry.js";

async function createWorkspace(records: unknown[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-registry-"));
  await writeFile(path.join(root, "bit-lite.json"), JSON.stringify({ components: records }));
  return root;
}

async function createComponent(
  root: string,
  relativePath: string,
  config: Record<string, unknown> = {},
  entry = "index.ts"
) {
  const dir = path.join(root, relativePath);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, ".comp.json"), JSON.stringify(config));
  await writeFile(path.join(dir, entry), entry.endsWith(".json") ? '{"name":"env","services":{}}' : "export {};\n");
}

describe("component package registry", () => {
  it("resolves workspace envs through registered env components", async () => {
    const records = [
      { path: "components/env/react", id: "env/react", packageName: "@scope/env.react", env: { packageName: "env-node", version: "1.0.0" } },
      { path: "components/ui/button", id: "ui/button", packageName: "@scope/ui.button", env: { packageName: "@scope/env.react", version: "workspace:*" } },
    ];
    const root = await createWorkspace(records);
    await createComponent(root, "components/env/react", { kind: "env", dependencies: {} }, "index.json");
    await createComponent(root, "components/ui/button", { dependencies: {} });
    const registry = await loadComponentPackageRegistry(root);
    expect(registry.byId.get("env/react")?.kind).toBe("env");
    expect(registry.byId.get("ui/button")?.internalEnvPackageName).toBe("@scope/env.react");
  });

  it("keeps normal versions external even for a same-named local env", async () => {
    const records = [
      { path: "components/env/react", id: "env/react", packageName: "@scope/env.react", env: { packageName: "env-node", version: "1.0.0" } },
      { path: "components/ui/button", id: "ui/button", packageName: "@scope/ui.button", env: { packageName: "@scope/env.react", version: "^1.0.0" } },
    ];
    const root = await createWorkspace(records);
    await createComponent(root, "components/env/react", { kind: "env" }, "index.json");
    await createComponent(root, "components/ui/button");
    expect((await loadComponentPackageRegistry(root)).byId.get("ui/button")?.internalEnvPackageName).toBeUndefined();
  });

  it("rejects workspace targets outside the Bit registry or not marked env", async () => {
    const missingRoot = await createWorkspace([
      { path: "components/ui/button", id: "ui/button", packageName: "@scope/ui.button", env: { packageName: "demo-config", version: "workspace:*" } },
    ]);
    await createComponent(missingRoot, "components/ui/button");
    await expect(loadComponentPackageRegistry(missingRoot)).rejects.toThrow('no such Bit component exists');

    const ordinaryRoot = await createWorkspace([
      { path: "components/lib/env", id: "lib/env", packageName: "@scope/lib.env", env: { packageName: "external-env", version: "1.0.0" } },
      { path: "components/ui/button", id: "ui/button", packageName: "@scope/ui.button", env: { packageName: "@scope/lib.env", version: "workspace:*" } },
    ]);
    await createComponent(ordinaryRoot, "components/lib/env");
    await createComponent(ordinaryRoot, "components/ui/button");
    await expect(loadComponentPackageRegistry(ordinaryRoot)).rejects.toThrow('target is not kind "env"');
  });

  it("requires env components to have index.json and validates dev conflicts", async () => {
    const root = await createWorkspace([
      { path: "components/env/react", id: "env/react", packageName: "@scope/env.react", env: { packageName: "env-node", version: "1.0.0" } },
    ]);
    await createComponent(root, "components/env/react", { kind: "env" });
    await expect(loadComponentPackageRegistry(root)).rejects.toThrow("supported env entry file (index.json)");

    const conflictRoot = await createWorkspace([
      { path: "components/lib/math", id: "lib/math", packageName: "@scope/lib.math", env: { packageName: "env-node", version: "1.0.0" } },
    ]);
    await createComponent(conflictRoot, "components/lib/math", { devDependencies: { "env-node": "2.0.0" } });
    await expect(loadComponentPackageRegistry(conflictRoot)).rejects.toThrow("conflicts with .comp.json devDependency");
  });
});
