import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readWorkspace } from "bit-lite-context";
import { resolveComponentStorePath } from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { linkComponentPackages } from "./link.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("generated manifest versions", () => {
  it("declares a recorded dependency at the version it currently carries", async () => {
    const root = await createWorkspace({
      "lib/math": "0.4.2",
      "ui/button": "1.0.0",
    });

    await linkComponentPackages(await readWorkspace(root));

    const manifest = await readManifest(root, "@my-scope/ui.button");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.dependencies).toEqual({ "@my-scope/lib.math": "0.4.2" });
    expect(JSON.stringify(manifest)).not.toContain("workspace:");
  });

  it("declares an unrecorded dependency as 0.0.0", async () => {
    const root = await createWorkspace({ "ui/button": "1.0.0" });

    await linkComponentPackages(await readWorkspace(root));

    const manifest = await readManifest(root, "@my-scope/ui.button");
    expect(manifest.dependencies).toEqual({ "@my-scope/lib.math": "0.0.0" });
  });

  it("declares a component with no recorded version as 0.0.0", async () => {
    const root = await createWorkspace({});

    await linkComponentPackages(await readWorkspace(root));

    expect((await readManifest(root, "@my-scope/lib.math")).version).toBe("0.0.0");
    expect((await readManifest(root, "@my-scope/ui.button")).version).toBe("0.0.0");
  });

  it("leaves external dependency specifiers alone", async () => {
    const root = await createWorkspace({ "lib/math": "0.4.2" });

    await linkComponentPackages(await readWorkspace(root));

    const manifest = await readManifest(root, "@my-scope/ui.button");
    expect(manifest.peerDependencies).toEqual({ react: "^19.2.7" });
  });

  it("never opens the component history store", async () => {
    const root = await createWorkspace({ "lib/math": "0.4.2" });

    await linkComponentPackages(await readWorkspace(root));

    await expect(readdir(resolveComponentStorePath(root))).rejects.toThrow();
  });
});

type Manifest = {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

async function readManifest(root: string, packageName: string): Promise<Manifest> {
  const manifestPath = path.join(root, "node_modules", ...packageName.split("/"), "package.json");
  return JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
}

async function createWorkspace(versions: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-link-versions-"));
  temporaryRoots.push(root);

  const components = [
    {
      path: "components/lib/math",
      id: "lib/math",
      packageName: "@my-scope/lib.math",
      env: { packageName: "demo-env-node", version: "0.0.0" },
      ...(versions["lib/math"] === undefined ? {} : { version: versions["lib/math"] }),
    },
    {
      path: "components/ui/button",
      id: "ui/button",
      packageName: "@my-scope/ui.button",
      env: { packageName: "demo-env-node", version: "0.0.0" },
      ...(versions["ui/button"] === undefined ? {} : { version: versions["ui/button"] }),
    },
  ];

  await write(root, "bit-lite.json", JSON.stringify({ components }, null, 2));
  await write(root, "components/lib/math/.comp.json", JSON.stringify({ dependencies: {} }));
  await write(root, "components/lib/math/index.ts", "export const add = 0;\n");
  await write(
    root,
    "components/ui/button/.comp.json",
    JSON.stringify({
      dependencies: { "@my-scope/lib.math": "workspace:*" },
      peerDependencies: { react: "^19.2.7" },
    })
  );
  await write(root, "components/ui/button/index.ts", "export const id = 'ui/button';\n");
  return root;
}

async function write(root: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}
