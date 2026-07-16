import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readWorkspace } from "bit-lite-context";
import { describe, expect, it } from "vitest";
import { compileComponentPackages, isCompileProducedResult } from "./compile.js";
import { linkComponentPackages } from "./link.js";

describe("per-component compile services", () => {
  it("honors dependency layers and different JSON compiler configs", async () => {
    const root = await createCompileWorkspace([
      env("envs/a", "@scope/env.a", compilerVendor("compiler-a"), { label: "A" }),
      env("envs/b", "@scope/env.b", compilerVendor("compiler-b"), { label: "B" }),
      ordinary("lib/a", "@scope/lib.a", "@scope/env.a"),
      ordinary("lib/b", "@scope/lib.b", "@scope/env.b", { "@scope/lib.a": "workspace:*" }),
    ]);
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);
    const compiled = await compileComponentPackages(workspace);

    expect(compiled.map((component) => component.packageName)).toEqual(["@scope/lib.a", "@scope/lib.b"]);
    expect(await marker(root, "@scope/lib.a")).toEqual({
      env: selectedEnv("@scope/env.a"),
      label: "A",
      serviceSource: "@scope/env.a",
    });
    expect(await marker(root, "@scope/lib.b")).toEqual({
      env: selectedEnv("@scope/env.b"),
      label: "B",
      serviceSource: "@scope/env.b",
    });
  });

  it("keeps env components on the fixed boundary and lets independent work finish before reporting failures", async () => {
    const root = await createCompileWorkspace([
      env("envs/good", "@scope/env.good", compilerVendor("compiler-good"), { label: "good" }),
      env("envs/missing", "@scope/env.missing", undefined, {}),
      ordinary("lib/good", "@scope/lib.good", "@scope/env.good"),
      ordinary("lib/fail", "@scope/lib.fail", "@scope/env.missing"),
      ordinary("lib/blocked", "@scope/lib.blocked", "@scope/env.good", { "@scope/lib.fail": "workspace:*" }),
    ]);
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);

    await expect(compileComponentPackages(workspace)).rejects.toThrow("selected env \"@scope/env.missing\" does not define services.compile");
    expect(await marker(root, "@scope/lib.good")).toEqual({
      env: selectedEnv("@scope/env.good"),
      label: "good",
      serviceSource: "@scope/env.good",
    });
    await expect(readFile(path.join(root, "node_modules/@scope/lib.blocked/dist/marker.json"), "utf8"))
      .rejects.toThrow();
    expect(JSON.parse(await readFile(path.join(root, "node_modules/@scope/env.good/dist/index.json"), "utf8")).name)
      .toBe("@scope/env.good");
  });

  it("uses an inherited compiler's declaring origin while retaining the selected child env", async () => {
    const root = await createCompileWorkspace([
      env("envs/parent", "@scope/env.parent", compilerVendor("compiler-parent"), { label: "parent" }),
      env("envs/child", "@scope/env.child", undefined, {}, {
        dependencies: { "@scope/env.parent": "workspace:*" },
        extendsName: "@scope/env.parent",
      }),
      ordinary("lib/child", "@scope/lib.child", "@scope/env.child"),
    ]);
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);

    await compileComponentPackages(workspace);

    expect(await marker(root, "@scope/lib.child")).toEqual({
      env: selectedEnv("@scope/env.child"),
      label: "parent",
      serviceSource: "@scope/env.parent",
    });
  });

  it("accepts JSON-safe artifact data without reserving historical field names", () => {
    expect(isCompileProducedResult(undefined)).toBe(true);
    expect(isCompileProducedResult({ artifactCount: 2, manifest: { files: ["index.js"] } })).toBe(true);
    expect(isCompileProducedResult({
      artifactCount: 1,
      env: selectedEnv("@scope/env.a"),
      componentId: "lib/a",
      outputDir: "/tmp/dist",
    })).toBe(true);
    expect(isCompileProducedResult({ artifactCount: Number.NaN })).toBe(false);
  });
});

type Fixture = ReturnType<typeof env> | ReturnType<typeof ordinary>;

function env(
  id: string,
  packageName: string,
  vendor: string | undefined,
  config: Record<string, unknown>,
  options: { dependencies?: Record<string, string>; extendsName?: string } = {}
) {
  return {
    id,
    packageName,
    kind: "env" as const,
    envPackageName: packageName,
    dependencies: options.dependencies ?? {},
    vendor,
    config,
    extendsName: options.extendsName,
  };
}

function ordinary(
  id: string,
  packageName: string,
  envPackageName: string,
  dependencies: Record<string, string> = {}
) {
  return { id, packageName, kind: "component" as const, envPackageName, dependencies };
}

async function createCompileWorkspace(fixtures: Fixture[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-compile-"));
  await writeFile(path.join(root, "bit-lite.json"), JSON.stringify({
    components: fixtures.map((fixture) => ({
      path: `components/${fixture.id}`,
      id: fixture.id,
      packageName: fixture.packageName,
      env: { packageName: fixture.envPackageName, version: "workspace:*" },
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
        ...(fixture.extendsName === undefined ? {} : { extends: fixture.extendsName }),
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
    export const meta = { id: ${JSON.stringify(id)}, label: ${JSON.stringify(id)}, hint: "fixture", moduleUrl: import.meta.url };
    export async function compileComponent(input) {
      await mkdir(input.runtime.distDir, { recursive: true });
      await writeFile(path.join(input.runtime.distDir, "marker.json"), JSON.stringify({
        env: input.context.env,
        label: input.config.label,
        serviceSource: input.context.service.source.identity.packageName,
      }));
      return { artifactCount: 1 };
    }
  `;
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function selectedEnv(packageName: string) {
  return {
    packageName,
    requestedVersion: "workspace:*",
    installedVersion: "0.0.0",
  };
}

async function marker(workspaceRoot: string, packageName: string) {
  return JSON.parse(await readFile(path.join(
    workspaceRoot,
    "node_modules",
    ...packageName.split("/"),
    "dist/marker.json"
  ), "utf8")) as unknown;
}
