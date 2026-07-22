import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadEnvForComponent,
  loadWorkspaceEnvContexts,
  resolveEnvModuleSpecifier,
} from "./env-loader.js";
import { readWorkspace } from "./workspace.js";

describe("JSON env package loading", () => {
  it("loads external inheritance with shallow config merge and whole-service replacement", async () => {
    const root = await createWorkspace([
      component("lib/math", "@scope/lib.math", "@env/child", "^1.0.0"),
    ]);
    const grand = await createEnvPackage(root, "@env/grand", {
      name: "@env/grand",
      services: { compile: { vendor: "compiler", config: { target: "grand" } } },
      config: { grandOnly: true },
    });
    await writeFile(path.join(grand, "grand-vendor.js"), "export const meta = {};\n");
    const parent = await createEnvPackage(root, "@env/parent", {
      name: "@env/parent",
      extends: "@env/grand",
      services: {
        test: { vendor: "./parent-vendor.js", config: { inherited: true, removed: true } },
      },
      config: { shared: "parent", parentOnly: true },
    }, { dependencies: { "@env/grand": "1.0.0" } });
    await linkPackage(path.join(parent, "node_modules", "@env", "grand"), grand);
    await writeFile(path.join(parent, "parent-vendor.js"), "export const meta = {};\n");
    const child = await createEnvPackage(root, "@env/child", {
      name: "@env/child",
      extends: "@env/parent",
      services: { test: { vendor: "child-vendor", config: { inherited: false } } },
      config: { shared: "child" },
    }, { dependencies: { "@env/parent": "1.0.0" } });
    await linkPackage(path.join(child, "node_modules", "@env", "parent"), parent);
    await installEnvForComponent(root, "@scope/lib.math", "@env/child", child);

    const workspace = await readWorkspace(root);
    const loaded = await loadEnvForComponent(workspace.components[0]!, workspace);

    expect(loaded.env.requestedVersion).toBe("^1.0.0");
    expect(loaded.env.installedVersion).toBe("1.0.0");
    expect(loaded.inheritance.map((identity) => identity.packageName))
      .toEqual(["@env/grand", "@env/parent", "@env/child"]);
    expect(loaded.config).toEqual({ grandOnly: true, shared: "child", parentOnly: true });
    expect(loaded.services.test?.definition.config).toEqual({ inherited: false });
    expect(loaded.services.test?.source.identity.packageName).toBe("@env/child");
    expect(loaded.services.compile?.source.identity.packageName).toBe("@env/grand");
    const parentVendor = await resolveEnvModuleSpecifier({
      specifier: "./grand-vendor.js",
      service: loaded.services.compile ?? loaded.services.test!,
      workspaceRoot: root,
      field: "fixture",
      selectedEnv: "@env/child",
    });
    expect(parentVendor).toBe(await realpath(path.join(grand, "grand-vendor.js")));
    await expect(resolveEnvModuleSpecifier({
      specifier: "../outside.js",
      service: loaded.services.test!,
      workspaceRoot: root,
      field: "fixture",
      selectedEnv: "@env/child",
    })).rejects.toThrow("escapes package root");
  });

  it("loads a registered workspace env from its generated JSON export", async () => {
    const root = await createWorkspace([
      component("envs/local", "@scope/env.local", "@env/base", "1.0.0", "env"),
      component("lib/math", "@scope/lib.math", "@scope/env.local", "workspace:*"),
    ]);
    const generated = path.join(root, "node_modules", "@scope", "env.local");
    await mkdir(path.join(generated, "dist"), { recursive: true });
    await writeFile(path.join(generated, "package.json"), JSON.stringify({
      name: "@scope/env.local",
      version: "0.0.0",
      type: "module",
      exports: { ".": "./dist/index.json" },
      bitLite: { generated: true, kind: "env" },
    }));
    await writeFile(path.join(generated, "dist/index.json"), JSON.stringify({
      formatVersion: 1,
      name: "@scope/env.local",
      services: { compile: { vendor: "local-compiler", config: {} } },
      inheritance: ["@scope/env.local"],
      serviceOrigins: { compile: { dependencyPath: [] } },
    }));

    const workspace = await readWorkspace(root);
    const selectedComponent = workspace.components.find((candidate) => candidate.id === "lib/math")!;
    const loaded = await loadEnvForComponent(selectedComponent, workspace);
    expect(loaded.env.packageName).toBe("@scope/env.local");
    expect(loaded.env.requestedVersion).toBe("workspace:*");
    expect(loaded.env.installedVersion).toBe("0.0.0");
    expect(loaded.package.rootDir).toBe(await realpath(generated));
  });

  it("reconstructs inherited service origins from compiled dependency paths", async () => {
    const root = await createWorkspace([
      component("envs/local", "@scope/env.local", "@env/base", "1.0.0", "env"),
      component("lib/math", "@scope/lib.math", "@scope/env.local", "workspace:*"),
    ]);
    const parent = await createEnvPackage(root, "@env/parent", {
      name: "@env/parent",
      services: { compile: { vendor: "./compiler.js" } },
    });
    await writeFile(path.join(parent, "compiler.js"), "export const meta = {};\n");
    const generated = path.join(root, "node_modules", "@scope", "env.local");
    await mkdir(path.join(generated, "dist"), { recursive: true });
    await writeFile(path.join(generated, "package.json"), JSON.stringify({
      name: "@scope/env.local",
      version: "0.0.0",
      type: "module",
      exports: { ".": "./dist/index.json" },
      dependencies: { "@env/parent": "1.0.0" },
      bitLite: { generated: true, kind: "env" },
    }));
    await writeFile(path.join(generated, "dist/index.json"), JSON.stringify({
      formatVersion: 1,
      name: "@scope/env.local",
      services: { compile: { vendor: "./compiler.js" } },
      inheritance: ["@env/parent", "@scope/env.local"],
      serviceOrigins: { compile: { dependencyPath: ["@env/parent"] } },
    }));
    await linkPackage(path.join(generated, "node_modules", "@env", "parent"), parent);

    const workspace = await readWorkspace(root);
    const selectedComponent = workspace.components.find((candidate) => candidate.id === "lib/math")!;
    const loaded = await loadEnvForComponent(selectedComponent, workspace);

    expect(loaded.inheritance.map((identity) => identity.packageName))
      .toEqual(["@env/parent", "@scope/env.local"]);
    expect(loaded.services.compile?.source.identity.packageName).toBe("@env/parent");
    expect(await resolveEnvModuleSpecifier({
      specifier: "./compiler.js",
      service: loaded.services.compile!,
      workspaceRoot: root,
      field: "fixture",
      selectedEnv: "@scope/env.local",
    })).toBe(await realpath(path.join(parent, "compiler.js")));
  });

  it("rejects an uncompiled source definition from a generated local env", async () => {
    const root = await createWorkspace([
      component("envs/local", "@scope/env.local", "@env/base", "1.0.0", "env"),
      component("lib/math", "@scope/lib.math", "@scope/env.local", "workspace:*"),
    ]);
    const generated = path.join(root, "node_modules", "@scope", "env.local");
    await mkdir(path.join(generated, "dist"), { recursive: true });
    await writeFile(path.join(generated, "package.json"), JSON.stringify({
      name: "@scope/env.local",
      version: "0.0.0",
      exports: { ".": "./dist/index.json" },
      bitLite: { generated: true, kind: "env" },
    }));
    await writeFile(path.join(generated, "dist/index.json"), JSON.stringify({
      name: "@scope/env.local",
      services: {},
    }));

    const workspace = await readWorkspace(root);
    const selectedComponent = workspace.components.find((candidate) => candidate.id === "lib/math")!;
    await expect(loadEnvForComponent(selectedComponent, workspace))
      .rejects.toThrow("exports an uncompiled source definition");
  });

  it("keeps a normal-version same-name env external and rejects workspace-root shadowing", async () => {
    const root = await createWorkspace([
      component("envs/collision", "@scope/env.collision", "@env/base", "1.0.0", "env"),
      component("lib/math", "@scope/lib.math", "@scope/env.collision", "1.0.0"),
    ]);
    const external = await createEnvPackage(root, "@scope/env.collision", {
      name: "@scope/env.collision",
      services: { compile: { vendor: "external", config: {} } },
    });
    await linkPackage(path.join(root, "node_modules", "@scope", "env.collision"), external);
    const workspace = await readWorkspace(root);
    const selectedComponent = workspace.components.find((candidate) => candidate.id === "lib/math")!;
    await expect(loadEnvForComponent(selectedComponent, workspace))
      .rejects.toThrow("is not installed in component development context");

    await installEnvForComponent(root, "@scope/lib.math", "@scope/env.collision", external);
    const loaded = await loadEnvForComponent(selectedComponent, workspace);
    expect(loaded.services.compile?.definition.vendor).toBe("external");
  });

  it("rejects undeclared, dev-only, and cyclic parents with selected component context", async () => {
    const root = await createWorkspace([
      component("lib/math", "@scope/lib.math", "@env/child", "1.0.0"),
    ]);
    const parent = await createEnvPackage(root, "@env/parent", {
      name: "@env/parent",
      services: {},
    });
    const child = await createEnvPackage(root, "@env/child", {
      name: "@env/child",
      extends: "@env/parent",
      services: {},
    }, { devDependencies: { "@env/parent": "1.0.0" } });
    await linkPackage(path.join(child, "node_modules", "@env", "parent"), parent);
    await installEnvForComponent(root, "@scope/lib.math", "@env/child", child);
    const workspace = await readWorkspace(root);
    await expect(loadEnvForComponent(workspace.components[0]!, workspace))
      .rejects.toThrow("declared only as a development dependency");

    await writeFile(path.join(child, "package.json"), JSON.stringify({
      name: "@env/child", version: "1.0.0", type: "module", exports: { ".": "./index.json" },
      dependencies: { "@env/parent": "1.0.0" },
    }));
    await writeFile(path.join(parent, "index.json"), JSON.stringify({
      name: "@env/parent", extends: "@env/child", services: {},
    }));
    await writeFile(path.join(parent, "package.json"), JSON.stringify({
      name: "@env/parent", version: "1.0.0", type: "module", exports: { ".": "./index.json" },
      dependencies: { "@env/child": "1.0.0" },
    }));
    await linkPackage(path.join(parent, "node_modules", "@env", "child"), child);
    await expect(loadEnvForComponent(workspace.components[0]!, workspace, new Map()))
      .rejects.toThrow("inheritance cycle");
  });

  it("shares one canonical load for components linked to the same package", async () => {
    const root = await createWorkspace([
      component("lib/a", "@scope/lib.a", "@env/shared", "1.0.0"),
      component("lib/b", "@scope/lib.b", "@env/shared", "1.0.0"),
    ]);
    const env = await createEnvPackage(root, "@env/shared", {
      name: "@env/shared",
      services: { compile: { vendor: "compiler", config: {} } },
    });
    await installEnvForComponent(root, "@scope/lib.a", "@env/shared", env);
    await installEnvForComponent(root, "@scope/lib.b", "@env/shared", env);
    const workspace = await readWorkspace(root);
    const loaded = await loadWorkspaceEnvContexts(workspace);
    expect(loaded.get("lib/a")).toBe(loaded.get("lib/b"));
  });

  it("reports malformed JSON, non-JSON entries, identity mismatch, and version mismatch", async () => {
    const root = await createWorkspace([
      component("lib/math", "@scope/lib.math", "@env/broken", "1.0.0"),
    ]);
    const env = await createEnvPackage(root, "@env/broken", {
      name: "@env/broken",
      services: {},
    });
    await installEnvForComponent(root, "@scope/lib.math", "@env/broken", env);
    const workspace = await readWorkspace(root);

    await writeFile(path.join(env, "index.json"), "{ broken");
    await expect(loadEnvForComponent(workspace.components[0]!, workspace)).rejects.toThrow("failed parsing env JSON");

    await writeFile(path.join(env, "index.json"), JSON.stringify({ name: "@env/other", services: {} }));
    await expect(loadEnvForComponent(workspace.components[0]!, workspace)).rejects.toThrow("env definition name mismatch");

    await writeFile(path.join(env, "index.json"), JSON.stringify({ name: "@env/broken", services: {} }));
    await writeFile(path.join(env, "package.json"), JSON.stringify({
      name: "@env/broken", version: "2.0.0", type: "module", exports: { ".": "./index.json" },
    }));
    await expect(loadEnvForComponent(workspace.components[0]!, workspace)).rejects.toThrow("does not satisfy \"1.0.0\"");

    await writeFile(path.join(env, "package.json"), JSON.stringify({
      name: "@env/broken", version: "1.0.0", type: "module", exports: { ".": "./index.js" },
    }));
    await writeFile(path.join(env, "index.js"), "export default {};\n");
    await expect(loadEnvForComponent(workspace.components[0]!, workspace)).rejects.toThrow("default entry must be JSON");
  });
});

function component(
  id: string,
  packageName: string,
  envPackageName: string,
  envVersion: string,
  kind: "component" | "env" = "component"
) {
  return {
    id,
    path: `components/${id}`,
    packageName,
    env: { packageName: envPackageName, version: envVersion },
    kind,
  };
}

async function createWorkspace(entries: ReturnType<typeof component>[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-env-loader-"));
  await writeFile(path.join(root, "bit-lite.json"), JSON.stringify({
    components: entries.map(({ kind: _kind, ...entry }) => entry),
  }));
  for (const entry of entries) {
    const componentRoot = path.join(root, entry.path);
    await mkdir(componentRoot, { recursive: true });
    await writeFile(path.join(componentRoot, entry.kind === "env" ? "index.json" : "index.ts"),
      entry.kind === "env" ? JSON.stringify({ name: entry.packageName, services: {} }) : "export {};\n");
    await writeFile(path.join(componentRoot, ".comp.json"), JSON.stringify({ kind: entry.kind }));
  }
  return root;
}

async function createEnvPackage(
  workspaceRoot: string,
  packageName: string,
  definition: unknown,
  manifestFields: Record<string, unknown> = {}
) {
  const root = path.join(workspaceRoot, ".env-store", ...packageName.split("/"));
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: packageName,
    version: "1.0.0",
    type: "module",
    exports: { ".": "./index.json" },
    ...manifestFields,
  }));
  await writeFile(path.join(root, "index.json"), JSON.stringify(definition));
  return root;
}

async function installEnvForComponent(
  workspaceRoot: string,
  componentPackageName: string,
  envPackageName: string,
  envRoot: string
) {
  await linkPackage(path.join(
    workspaceRoot,
    ".bit-lite/deps/components",
    ...componentPackageName.split("/"),
    "node_modules",
    ...envPackageName.split("/")
  ), envRoot);
}

async function linkPackage(target: string, source: string) {
  await mkdir(path.dirname(target), { recursive: true });
  await symlink(path.relative(path.dirname(target), source), target, "dir");
}
