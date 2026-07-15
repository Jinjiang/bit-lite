import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadComponentPackageRegistry } from "bit-lite-context";
import { describe, expect, it } from "vitest";
import { compileComponentPackages } from "./compile.js";
import { linkComponentPackages } from "./link.js";

describe("per-component compile services", () => {
  it("honors dependency layers and different JSON compiler configs", async () => {
    const root = await createCompileWorkspace([
      env("envs/a", "@scope/env.a", compilerVendor("compiler-a"), { label: "A" }),
      env("envs/b", "@scope/env.b", compilerVendor("compiler-b"), { label: "B" }),
      ordinary("lib/a", "@scope/lib.a", "@scope/env.a"),
      ordinary("lib/b", "@scope/lib.b", "@scope/env.b", { "@scope/lib.a": "workspace:*" }),
    ]);
    const registry = await loadComponentPackageRegistry(root);
    await linkComponentPackages(registry);
    const compiled = await compileComponentPackages(registry);

    expect(compiled.map((component) => component.packageName)).toEqual(["@scope/lib.a", "@scope/lib.b"]);
    expect(await marker(root, "@scope/lib.a")).toEqual({ envName: "@scope/env.a", label: "A" });
    expect(await marker(root, "@scope/lib.b")).toEqual({ envName: "@scope/env.b", label: "B" });
  });

  it("keeps env components on the fixed boundary and lets independent work finish before reporting failures", async () => {
    const root = await createCompileWorkspace([
      env("envs/good", "@scope/env.good", compilerVendor("compiler-good"), { label: "good" }),
      env("envs/missing", "@scope/env.missing", undefined, {}),
      ordinary("lib/good", "@scope/lib.good", "@scope/env.good"),
      ordinary("lib/fail", "@scope/lib.fail", "@scope/env.missing"),
      ordinary("lib/blocked", "@scope/lib.blocked", "@scope/env.good", { "@scope/lib.fail": "workspace:*" }),
    ]);
    const registry = await loadComponentPackageRegistry(root);
    await linkComponentPackages(registry);

    await expect(compileComponentPackages(registry)).rejects.toThrow("selected env \"@scope/env.missing\" does not define services.compile");
    expect(await marker(root, "@scope/lib.good")).toEqual({ envName: "@scope/env.good", label: "good" });
    await expect(readFile(path.join(root, "node_modules/@scope/lib.blocked/dist/marker.json"), "utf8"))
      .rejects.toThrow();
    expect(JSON.parse(await readFile(path.join(root, "node_modules/@scope/env.good/dist/index.json"), "utf8")).name)
      .toBe("@scope/env.good");
  });
});

type Fixture = ReturnType<typeof env> | ReturnType<typeof ordinary>;

function env(id: string, packageName: string, vendor: string | undefined, config: Record<string, unknown>) {
  return { id, packageName, kind: "env" as const, envName: packageName, dependencies: {}, vendor, config };
}

function ordinary(
  id: string,
  packageName: string,
  envName: string,
  dependencies: Record<string, string> = {}
) {
  return { id, packageName, kind: "component" as const, envName, dependencies };
}

async function createCompileWorkspace(fixtures: Fixture[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-compile-"));
  await writeFile(path.join(root, "bit-lite.json"), JSON.stringify({
    components: fixtures.map((fixture) => ({
      path: `components/${fixture.id}`,
      id: fixture.id,
      packageName: fixture.packageName,
      env: { packageName: fixture.envName, version: "workspace:*" },
    })),
  }));
  for (const fixture of fixtures) {
    const componentRoot = path.join(root, "components", fixture.id);
    await mkdir(componentRoot, { recursive: true });
    await writeFile(path.join(componentRoot, ".comp.json"), JSON.stringify({
      kind: fixture.kind,
      dependencies: fixture.dependencies,
    }));
    if (fixture.kind === "env") {
      await writeFile(path.join(componentRoot, "index.json"), JSON.stringify({
        name: fixture.packageName,
        services: fixture.vendor
          ? { compile: { vendor: fixture.vendor, config: fixture.config } }
          : {},
      }));
    } else {
      await writeFile(path.join(componentRoot, "index.ts"), "export const value = true;\n");
    }
  }
  return root;
}

function compilerVendor(id: string) {
  const source = `
    import { mkdir, writeFile } from "node:fs/promises";
    import path from "node:path";
    export const meta = { id: ${JSON.stringify(id)}, label: ${JSON.stringify(id)} };
    export async function compileComponent(input) {
      await mkdir(input.distDir, { recursive: true });
      await writeFile(path.join(input.distDir, "marker.json"), JSON.stringify({
        envName: input.envName,
        label: input.config.label,
      }));
      return { service: "compile", componentId: input.component.id, outputDir: input.distDir };
    }
  `;
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

async function marker(workspaceRoot: string, packageName: string) {
  return JSON.parse(await readFile(path.join(
    workspaceRoot,
    "node_modules",
    ...packageName.split("/"),
    "dist/marker.json"
  ), "utf8")) as unknown;
}
