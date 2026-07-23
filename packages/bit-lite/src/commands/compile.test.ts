import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readWorkspace } from "bit-lite-context";
import { describe, expect, it, vi } from "vitest";
import {
  compileComponentPackages,
  createCompileWatchContribution,
  createCompilePlan,
  isCompileRunResult,
} from "./compile.js";
import { linkComponentPackages } from "./link.js";

describe("configured per-component compile services", () => {
  it("compiles env and ordinary components through configured vendors in dependency layers", async () => {
    const root = await createCompileWorkspace([
      env("envs/a", "@scope/env.a", compilerVendor("compiler-a"), { label: "A" }),
      env("envs/b", "@scope/env.b", compilerVendor("compiler-b"), { label: "B" }),
      ordinary("lib/a", "@scope/lib.a", "@scope/env.a"),
      ordinary("lib/b", "@scope/lib.b", "@scope/env.b", { "@scope/lib.a": "workspace:*" }),
    ]);
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);
    const compiled = await compileComponentPackages(workspace);

    expect(compiled.map((component) => component.packageName)).toEqual([
      "@scope/env.a",
      "@scope/env.b",
      "@scope/lib.a",
      "@scope/lib.b",
    ]);
    expect(await marker(root, "@scope/env.a", "env-marker.json")).toEqual({
      componentId: "envs/a",
      compiler: "bootstrap-env-compiler",
    });
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

  it("includes a selected component's local env prerequisite without adding unrelated components", async () => {
    const root = await createCompileWorkspace([
      env("envs/a", "@scope/env.a", compilerVendor("compiler-a"), { label: "A" }),
      env("envs/b", "@scope/env.b", compilerVendor("compiler-b"), { label: "B" }),
      ordinary("lib/a", "@scope/lib.a", "@scope/env.a"),
      ordinary("lib/b", "@scope/lib.b", "@scope/env.b"),
    ]);
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);

    const plan = createCompilePlan(workspace, ["lib/a"]);
    expect(plan.layers.map((layer) => layer.map((unit) => unit.value.id)))
      .toEqual([["envs/a"], ["lib/a"]]);
    expect(plan.layers[1]?.[0]).toMatchObject({
      id: "compile:lib/a",
      dependsOn: ["compile:envs/a"],
    });
    expect((await compileComponentPackages(workspace, ["lib/a"])).map((component) => component.id))
      .toEqual(["envs/a", "lib/a"]);
    await expect(readFile(path.join(root, "node_modules/@scope/env.b/dist/index.json"), "utf8"))
      .rejects.toThrow();
  });

  it("lets independent work finish and blocks dependents after a configured compiler failure", async () => {
    const root = await createCompileWorkspace([
      env("envs/good", "@scope/env.good", compilerVendor("compiler-good"), { label: "good" }),
      env("envs/missing", "@scope/env.missing", undefined, {}),
      ordinary("lib/good", "@scope/lib.good", "@scope/env.good"),
      ordinary("lib/fail", "@scope/lib.fail", "@scope/env.missing"),
      ordinary("lib/blocked", "@scope/lib.blocked", "@scope/env.good", { "@scope/lib.fail": "workspace:*" }),
    ]);
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);

    await expect(compileComponentPackages(workspace)).rejects.toThrow(
      'selected env "@scope/env.missing" does not define services.compile'
    );
    expect(await marker(root, "@scope/lib.good")).toEqual({
      env: selectedEnv("@scope/env.good"),
      label: "good",
      serviceSource: "@scope/env.good",
    });
    await expect(readFile(path.join(root, "node_modules/@scope/lib.blocked/dist/marker.json"), "utf8"))
      .rejects.toThrow();
  });

  it("validates the common one-shot compiler run result", () => {
    expect(isCompileRunResult({ output: null })).toBe(true);
    expect(isCompileRunResult({ output: {
      artifactCount: 2,
      manifest: { files: ["index.js"] },
    } })).toBe(true);
    expect(isCompileRunResult({ artifactCount: 1 })).toBe(false);
    expect(isCompileRunResult({ output: { artifactCount: Number.NaN } })).toBe(false);
  });

  it("rejects an invalid compiler run result through the layered executor", async () => {
    const root = await createCompileWorkspace([
      env("envs/a", "@scope/env.a", invalidCompilerVendor("run"), {}),
      ordinary("lib/a", "@scope/lib.a", "@scope/env.a"),
    ]);
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);

    await expect(compileComponentPackages(workspace, ["lib/a"]))
      .rejects.toThrow('compile vendor returned an invalid result for component "lib/a"');
  });

  it("creates caller-owned watch tasks in env prerequisite order without process supervision", async () => {
    const root = await createCompileWorkspace([
      env("envs/a", "@scope/env.a", compilerVendor("compiler-a"), { label: "A" }),
      ordinary("lib/a", "@scope/lib.a", "@scope/env.a"),
    ]);
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    const sourceArgs = {
      raw: ["start", "--unknown", "value", "--", "fixture.ts"],
      options: { unknown: "value" },
      passthrough: ["fixture.ts"],
    };
    const contribution = await createCompileWatchContribution(
      workspace,
      ["lib/a"],
      sourceArgs
    );

    expect(contribution.bindings.map(({ component }) => component.id)).toEqual(["envs/a", "lib/a"]);
    expect(contribution.tasks.map((task) => task.id)).toEqual(["compile:envs/a", "compile:lib/a"]);
    expect(contribution.tasks.every((task) => task.context.args.options.watch === true)).toBe(true);
    expect(contribution.effectiveArgs.options).toEqual({ unknown: "value", watch: true });
    expect(contribution.effectiveArgs.raw).toEqual(sourceArgs.raw);
    expect(contribution.effectiveArgs.passthrough).toEqual(sourceArgs.passthrough);
    expect(Object.isFrozen(contribution.effectiveArgs)).toBe(true);
    expect(sourceArgs.options).toEqual({ unknown: "value" });
    expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
    expect(await marker(root, "@scope/lib.a")).toMatchObject({ label: "A" });

    await contribution.dispose();
    await contribution.dispose();
  }, 10_000);

  it("retains worker-backed compile stdout and stderr for late terminal replay", async () => {
    const root = await createCompileWorkspace([
      env("envs/a", "@scope/env.a", compilerVendor("compiler-output", true), { label: "A" }),
      ordinary("lib/a", "@scope/lib.a", "@scope/env.a"),
    ]);
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);
    const contribution = await createCompileWatchContribution(
      workspace,
      ["lib/a"],
      { raw: ["compile", "--watch"], options: { watch: true }, passthrough: [] }
    );

    try {
      const task = contribution.bindings.find(({ component }) => component.id === "lib/a")?.task;
      expect(task).toBeDefined();

      await vi.waitFor(() => {
        const retained = task?.rawOutput.entries() ?? [];
        expect(retained.some(({ stream }) => stream === "stdout")).toBe(true);
        expect(retained.some(({ stream }) => stream === "stderr")).toBe(true);
      });

      const stdout = task?.rawOutput.entries()
        .filter(({ stream }) => stream === "stdout")
        .map(({ chunk }) => chunk.toString("utf8"))
        .join("");
      const stderr = task?.rawOutput.entries()
        .filter(({ stream }) => stream === "stderr")
        .map(({ chunk }) => chunk.toString("utf8"))
        .join("");
      expect(stdout).toContain("[compile:lib/a] Compiling...");
      expect(stdout).toContain("[compile:lib/a] Compiled successfully");
      expect(stderr).toContain("[compile:lib/a] Watcher error");
      expect(stderr).toContain("fixture watcher diagnostic");
    } finally {
      await contribution.dispose();
    }
  }, 10_000);

  it("cleans up staged prerequisite tasks when a consumer vendor lacks the watch lifecycle", async () => {
    const root = await createCompileWorkspace([
      env("envs/a", "@scope/env.a", compilerVendorWithoutRunner(), {}),
      ordinary("lib/a", "@scope/lib.a", "@scope/env.a"),
    ]);
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");

    await expect(createCompileWatchContribution(
      workspace,
      ["lib/a"],
      { raw: ["compile", "--watch"], options: { watch: true }, passthrough: [] }
    )).rejects.toThrow("must export meta and a default CompilerVendorStart");
    expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
  }, 10_000);

  it("rejects an invalid first watch result without constructing dependent work", async () => {
    const root = await createCompileWorkspace([
      env("envs/a", "@scope/env.a", invalidCompilerVendor("watch"), {}),
      ordinary("lib/a", "@scope/lib.a", "@scope/env.a"),
      ordinary("lib/b", "@scope/lib.b", "@scope/env.a", { "@scope/lib.a": "workspace:*" }),
    ]);
    const workspace = await readWorkspace(root);
    await linkComponentPackages(workspace);

    await expect(createCompileWatchContribution(
      workspace,
      ["lib/b"],
      { raw: ["compile", "--watch"], options: { watch: true }, passthrough: [] }
    )).rejects.toThrow("Invalid compile watch result");
    await expect(readFile(path.join(root, "node_modules/@scope/lib.b/dist/marker.json"), "utf8"))
      .rejects.toThrow();
  }, 10_000);
});

type Fixture = ReturnType<typeof env> | ReturnType<typeof ordinary>;

function env(
  id: string,
  packageName: string,
  vendor: string | undefined,
  config: Record<string, unknown>
) {
  return {
    id,
    packageName,
    kind: "env" as const,
    envPackageName: "@fixture/env.bootstrap",
    dependencies: {},
    vendor,
    config,
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
      env: {
        packageName: fixture.envPackageName,
        version: fixture.kind === "env" ? "1.0.0" : "workspace:*",
      },
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
  const bootstrapRoot = path.join(root, ".fixture", "env.bootstrap");
  await mkdir(bootstrapRoot, { recursive: true });
  await writeFile(path.join(bootstrapRoot, "package.json"), JSON.stringify({
    name: "@fixture/env.bootstrap",
    version: "1.0.0",
    type: "module",
    exports: { ".": "./index.json" },
  }));
  await writeFile(path.join(bootstrapRoot, "index.json"), JSON.stringify({
    name: "@fixture/env.bootstrap",
    services: { compile: { vendor: envCompilerVendor() } },
  }));
  for (const fixture of fixtures.filter((candidate) => candidate.kind === "env")) {
    const target = path.join(
      root,
      ".bit-lite/deps/components",
      ...fixture.packageName.split("/"),
      "node_modules/@fixture/env.bootstrap"
    );
    await mkdir(path.dirname(target), { recursive: true });
    await symlink(path.relative(path.dirname(target), bootstrapRoot), target, "dir");
  }
  return root;
}

function envCompilerVendor() {
  const source = `
    import { mkdir, readFile, writeFile } from "node:fs/promises";
    import path from "node:path";
    export const meta = { id: "bootstrap-env-compiler", label: "bootstrap", hint: "fixture", moduleUrl: import.meta.url };
    async function compileOnce(input) {
      const component = input.components[0];
      const source = JSON.parse(await readFile(path.join(component.rootDir, input.runtime.mainFileRelative), "utf8"));
      const serviceOrigins = Object.fromEntries(Object.keys(source.services).map((name) => [name, { dependencyPath: [] }]));
      await mkdir(input.runtime.distDir, { recursive: true });
      await writeFile(path.join(input.runtime.distDir, "index.json"), JSON.stringify({
        formatVersion: 1,
        name: source.name,
        services: source.services,
        ...(source.config ? { config: source.config } : {}),
        inheritance: [source.name],
        serviceOrigins,
      }));
      await writeFile(path.join(input.runtime.distDir, "env-marker.json"), JSON.stringify({
        componentId: component.id,
        compiler: "bootstrap-env-compiler",
      }));
      return { artifactCount: 2 };
    }
    export default async function start(runtime) {
      if (runtime.data.context.args.options.watch === true) {
        runtime.postMessage({ type: "ready" });
        try {
          const output = await compileOnce(runtime.data);
          runtime.postMessage({ type: "result", data: { run: 1, output } });
          runtime.postMessage({ type: "status", status: "watching" });
        } catch (error) {
          runtime.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
        return {};
      }
      return { data: { output: await compileOnce(runtime.data) } };
    }
  `;
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function compilerVendor(id: string, emitsWatchOutput = false) {
  const source = `
    import { mkdir, writeFile } from "node:fs/promises";
    import path from "node:path";
    export const meta = { id: ${JSON.stringify(id)}, label: ${JSON.stringify(id)}, hint: "fixture", moduleUrl: import.meta.url };
    async function compileOnce(input) {
      await mkdir(input.runtime.distDir, { recursive: true });
      await writeFile(path.join(input.runtime.distDir, "marker.json"), JSON.stringify({
        env: input.context.env,
        label: input.config.label,
        serviceSource: input.context.service.source.identity.packageName,
      }));
      return { artifactCount: 1 };
    }
    export default async function start(runtime) {
      if (runtime.data.context.args.options.watch === true) {
        const component = runtime.data.components[0];
        runtime.postMessage({ type: "ready" });
        if (${JSON.stringify(emitsWatchOutput)}) {
          console.log("[compile:" + component.id + "] Compiling...");
          console.error("[compile:" + component.id + "] Watcher error\\nfixture watcher diagnostic");
        }
        try {
          const output = await compileOnce(runtime.data);
          if (${JSON.stringify(emitsWatchOutput)}) {
            console.log("[compile:" + component.id + "] Compiled successfully");
          }
          runtime.postMessage({ type: "result", data: { run: 1, output } });
          runtime.postMessage({ type: "status", status: "watching" });
        } catch (error) {
          runtime.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
        return {};
      }
      return { data: { output: await compileOnce(runtime.data) } };
    }
  `;
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function compilerVendorWithoutRunner() {
  const source = `
    export const meta = { id: "one-shot-only", label: "one shot", hint: "fixture", moduleUrl: import.meta.url };
  `;
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function invalidCompilerVendor(mode: "run" | "watch") {
  const source = `
    export const meta = {
      id: "invalid-${mode}",
      label: "invalid ${mode}",
      hint: "fixture",
      moduleUrl: import.meta.url
    };
    export default async function start(runtime) {
      if (runtime.data.context.args.options.watch === true) {
        runtime.postMessage({ type: "ready" });
        runtime.postMessage({ type: "result", data: { invalid: true } });
        return { stop() {} };
      }
      return { data: { artifactCount: 1 } };
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

async function marker(workspaceRoot: string, packageName: string, fileName = "marker.json") {
  return JSON.parse(await readFile(path.join(
    workspaceRoot,
    "node_modules",
    ...packageName.split("/"),
    "dist",
    fileName
  ), "utf8")) as unknown;
}
