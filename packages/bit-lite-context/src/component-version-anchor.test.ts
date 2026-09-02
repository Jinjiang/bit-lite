import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateConfig, writeComponentVersions } from "./config.js";
import { readWorkspace } from "./workspace.js";

describe("component version anchor", () => {
  it("reads an anchor from a component entry", () => {
    const config = validateConfig({
      components: [{ ...entry("lib/math"), version: "0.0.0-gabc123" }],
    });

    expect(config.components[0]?.version).toBe("0.0.0-gabc123");
  });

  it("treats a missing anchor as never recorded", () => {
    const config = validateConfig({ components: [entry("lib/math")] });

    expect(config.components[0]?.version).toBeUndefined();
    expect("version" in config.components[0]!).toBe(false);
  });

  it("rejects a malformed anchor", () => {
    for (const version of ["", 3, null, "0.0.0 g1", { major: 1 }]) {
      expect(() => validateConfig({ components: [{ ...entry("lib/math"), version }] })).toThrow(
        'field "version" must be a non-empty version string'
      );
    }
  });

  it("exposes the anchor on the workspace component beside its env", async () => {
    const root = await createWorkspace([
      { ...entry("lib/math"), version: "0.0.0-gabc123" },
      entry("vue/card"),
    ]);

    const workspace = await readWorkspace(root);

    expect(workspace.components.map((item) => [item.id, item.version])).toEqual([
      ["lib/math", "0.0.0-gabc123"],
      ["vue/card", undefined],
    ]);
  });

  it("writes anchors back without disturbing entry order or other fields", async () => {
    const root = await createWorkspace([entry("vue/card"), entry("lib/math")]);

    await writeComponentVersions(root, new Map([["lib/math", "0.0.0-gdef456"]]));

    const raw = JSON.parse(await readFile(path.join(root, "bit-lite.json"), "utf8")) as {
      components: { id: string; version?: string; env: unknown; packageName: string }[];
    };
    // The file keeps its own order; validateConfig's id sort is a read-time view.
    expect(raw.components.map((item) => item.id)).toEqual(["vue/card", "lib/math"]);
    expect(raw.components[1]).toMatchObject({
      id: "lib/math",
      packageName: "@scope/lib.math",
      version: "0.0.0-gdef456",
    });
    expect(raw.components[0]).not.toHaveProperty("version");
  });

  it("replaces an existing anchor and leaves unnamed components alone", async () => {
    const root = await createWorkspace([
      { ...entry("lib/math"), version: "0.0.0-gold" },
      { ...entry("vue/card"), version: "0.0.0-gkeep" },
    ]);

    await writeComponentVersions(root, new Map([["lib/math", "0.0.0-gnew"]]));

    const workspace = await readWorkspace(root);
    expect(workspace.components.map((item) => [item.id, item.version])).toEqual([
      ["lib/math", "0.0.0-gnew"],
      ["vue/card", "0.0.0-gkeep"],
    ]);
  });

  it("does not touch the config when asked to write nothing", async () => {
    const root = await createWorkspace([entry("lib/math")]);
    const before = await readFile(path.join(root, "bit-lite.json"), "utf8");

    await writeComponentVersions(root, new Map());

    expect(await readFile(path.join(root, "bit-lite.json"), "utf8")).toBe(before);
  });

  it("fails when a named component has no config entry", async () => {
    const root = await createWorkspace([entry("lib/math")]);

    await expect(writeComponentVersions(root, new Map([["ui/button", "0.0.0-gx"]]))).rejects.toThrow(
      "bit-lite.json has no entry for component ui/button"
    );
  });

  it("rejects registering a component at the workspace root", async () => {
    const root = await createWorkspace([{ ...entry("lib/math"), path: "." }]);

    await expect(readWorkspace(root)).rejects.toThrow(
      'component "lib/math" path must not be the workspace root'
    );
  });

  it("keeps the workspace placeholder as the local-component signal", async () => {
    const root = await createWorkspace(
      [
        { ...entry("lib/math"), version: "0.0.0-ga" },
        {
          ...entry("ui/button"),
          version: "0.0.0-gb",
          env: { packageName: "@scope/env.react", version: "workspace:*" },
        },
        {
          ...entry("envs/react", "@scope/env.env"),
          packageName: "@scope/env.react",
          version: "0.0.0-gc",
        },
      ],
      {
        "ui/button": { dependencies: { "@scope/lib.math": "workspace:*", clsx: "^2.1.0" } },
        "envs/react": { kind: "env" },
      }
    );

    const workspace = await readWorkspace(root);
    const button = workspace.components.find((item) => item.id === "ui/button");

    // Anchors are recorded, and the placeholder is still what marks a
    // dependency and an env as local rather than external.
    expect(button?.dependencies["@scope/lib.math"]).toBe("workspace:*");
    expect(button?.internalDependencyPackageNames).toEqual(["@scope/lib.math"]);
    expect(button?.internalEnvPackageName).toBe("@scope/env.react");
  });
});

function entry(id: string, envPackageName = "@scope/env.node") {
  return {
    path: `components/${id}`,
    id,
    packageName: `@scope/${id.replaceAll("/", ".")}`,
    env: { packageName: envPackageName, version: "^1.0.0" },
  };
}

async function createWorkspace(
  components: Record<string, unknown>[],
  componentFiles: Record<string, Record<string, unknown>> = {}
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-anchor-"));
  await writeFile(
    path.join(root, "bit-lite.json"),
    `${JSON.stringify({ components }, null, 2)}\n`
  );
  for (const item of components) {
    const id = item.id as string;
    const componentRoot = path.join(root, `components/${id}`);
    await mkdir(componentRoot, { recursive: true });
    const compJson = componentFiles[id] ?? {};
    const isEnv = compJson.kind === "env";
    await writeFile(
      path.join(componentRoot, isEnv ? "index.json" : "index.ts"),
      isEnv ? "{}\n" : "export const value = true;\n"
    );
    await writeFile(path.join(componentRoot, ".comp.json"), `${JSON.stringify(compJson)}\n`);
  }
  return root;
}
