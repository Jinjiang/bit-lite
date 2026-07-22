import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  CompileVendorInput,
  CompileWatchResult,
} from "bit-lite-compiler";
import { isCompilerVendorModule } from "bit-lite-compiler";
import type {
  VendorMessage,
  VendorRuntime,
} from "bit-lite-vendors";
import startTypeScriptCompiler from "./typescript/index.js";
import startEnvCompiler from "./env/index.js";

describe("maintained compiler vendor lifecycle", () => {
  it("uses the standard meta plus default module shape", async () => {
    const modules = await Promise.all([
      import("./typescript/index.js"),
      import("./env/index.js"),
    ]);

    for (const module of modules) {
      expect(isCompilerVendorModule(module)).toBe(true);
      expect(Object.keys(module).sort()).toEqual(["default", "meta"]);
    }
  });

  it("lets the TypeScript vendor own rebuilds and cleanup", async () => {
    const fixture = await createFixture("component", "index.ts", "export const value = 1;\n");
    const messages: VendorMessage<CompileWatchResult>[] = [];
    const runtime = createRuntime(fixture.input, messages);
    const started = await startTypeScriptCompiler(runtime);

    expect(resultMessages(messages)).toHaveLength(1);
    expect(await readFile(path.join(fixture.distDir, "index.js"), "utf8")).toContain("value = 1");

    await writeFile(path.join(fixture.rootDir, "index.ts"), "export const value = 2;\n");
    await vi.waitFor(() => expect(resultMessages(messages)).toHaveLength(2), { timeout: 5_000 });
    expect(await readFile(path.join(fixture.distDir, "index.js"), "utf8")).toContain("value = 2");

    await started?.stop?.();
    await writeFile(path.join(fixture.rootDir, "index.ts"), "export const value = 3;\n");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(resultMessages(messages)).toHaveLength(2);
  }, 10_000);

  it("lets the env vendor rebuild flattened dist/index.json", async () => {
    const fixture = await createFixture(
      "env",
      "index.json",
      JSON.stringify({ name: "@scope/env.fixture", services: {}, config: { value: 1 } })
    );
    const messages: VendorMessage<CompileWatchResult>[] = [];
    const runtime = createRuntime(fixture.input, messages);
    const started = await startEnvCompiler(runtime);

    expect(JSON.parse(await readFile(path.join(fixture.distDir, "index.json"), "utf8"))).toMatchObject({
      formatVersion: 1,
      name: "@scope/env.fixture",
      config: { value: 1 },
      inheritance: ["@scope/env.fixture"],
    });

    await writeFile(path.join(fixture.rootDir, "index.json"), JSON.stringify({
      name: "@scope/env.fixture",
      services: {},
      config: { value: 2 },
    }));
    await vi.waitFor(() => expect(resultMessages(messages)).toHaveLength(2), { timeout: 5_000 });
    expect(JSON.parse(await readFile(path.join(fixture.distDir, "index.json"), "utf8")))
      .toMatchObject({ config: { value: 2 } });
    await started?.stop?.();
  }, 10_000);

  it("uses the same default entry for one-shot env compilation", async () => {
    const fixture = await createFixture(
      "env",
      "index.json",
      JSON.stringify({
        name: "@scope/env.fixture",
        extends: "@scope/env.parent",
        services: { test: { vendor: "child-test" } },
      }),
      { "@scope/env.parent": "1.0.0" },
      false
    );
    const parentRoot = path.join(fixture.rootDir, "node_modules/@scope/env.parent");
    await mkdir(parentRoot, { recursive: true });
    await writeFile(path.join(parentRoot, "package.json"), JSON.stringify({
      name: "@scope/env.parent",
      version: "1.0.0",
      exports: { ".": "./index.json" },
    }));
    await writeFile(path.join(parentRoot, "index.json"), JSON.stringify({
      name: "@scope/env.parent",
      services: { compile: { vendor: "parent-compiler" } },
    }));

    const messages: VendorMessage<CompileWatchResult>[] = [];
    const started = await startEnvCompiler(createRuntime(fixture.input, messages));
    expect(started?.data?.output).toMatchObject({ artifactCount: 1, formatVersion: 1 });
    expect(messages).toEqual([]);
    expect(JSON.parse(await readFile(path.join(fixture.distDir, "index.json"), "utf8"))).toMatchObject({
      services: {
        test: { vendor: "child-test" },
        compile: { vendor: "parent-compiler" },
      },
      inheritance: ["@scope/env.parent", "@scope/env.fixture"],
      serviceOrigins: {
        test: { dependencyPath: [] },
        compile: { dependencyPath: ["@scope/env.parent"] },
      },
    });
  });
});

async function createFixture(
  kind: "component" | "env",
  mainFileRelative: string,
  contents: string,
  dependencies: Record<string, string> = {},
  watch = true
) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "demo-compiler-watch-"));
  const rootDir = path.join(workspaceRoot, "component");
  const distDir = path.join(workspaceRoot, "package", "dist");
  await mkdir(rootDir, { recursive: true });
  await writeFile(path.join(rootDir, mainFileRelative), contents);
  const packageName = kind === "env" ? "@scope/env.fixture" : "@scope/component.fixture";
  const component = {
    id: kind === "env" ? "envs/fixture" : "component/fixture",
    path: "component",
    rootDir,
    packageName,
    kind,
    env: { packageName: "@scope/env.bootstrap", version: "1.0.0" },
    mainFile: path.join(rootDir, mainFileRelative),
    mainFileRelative,
    dependencies,
    devDependencies: {},
    peerDependencies: {},
    internalDependencyPackageNames: [],
    internalEnvPackageName: undefined,
  } as const;
  const input = {
    context: {
      version: 1,
      workspace: {
        rootDir: workspaceRoot,
        configPath: path.join(workspaceRoot, "bit-lite.json"),
        config: { components: [] },
        components: [component],
      },
      args: {
        raw: watch ? ["compile", "--watch"] : ["compile"],
        options: { watch },
        passthrough: [],
      },
      env: { packageName: "@scope/env.bootstrap", requestedVersion: "1.0.0", installedVersion: "1.0.0" },
      service: {
        name: "compile",
        source: {
          identity: { packageName: "@scope/env.bootstrap", version: "1.0.0" },
          rootDir: workspaceRoot,
          entryFile: path.join(workspaceRoot, "index.json"),
        },
      },
    },
    components: [component],
    config: {},
    runtime: { mainFileRelative, distDir },
  } satisfies CompileVendorInput;
  return { rootDir, distDir, input };
}

function createRuntime(
  input: CompileVendorInput,
  messages: VendorMessage<CompileWatchResult>[]
) {
  const listeners = new Set<(message: { type: "shutdown" }) => void | Promise<void>>();
  return {
    data: input,
    postMessage(message) {
      messages.push(message);
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as VendorRuntime<CompileVendorInput["config"], CompileWatchResult, never, NonNullable<CompileVendorInput["runtime"]>>;
}

function resultMessages(messages: VendorMessage<CompileWatchResult>[]) {
  return messages.filter((message): message is { type: "result"; data: CompileWatchResult } => message.type === "result");
}
