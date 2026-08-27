import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ComponentHistoryError } from "./errors.js";
import { prunedDirectoryNames, readComponentSnapshot } from "./snapshot.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function createComponentRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-history-walk-"));
  temporaryRoots.push(root);
  return root;
}

async function writeComponentFile(
  rootDir: string,
  relativePath: string,
  contents: string
): Promise<string> {
  const absolutePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
  return absolutePath;
}

async function snapshotPaths(rootDir: string): Promise<string[]> {
  const snapshot = await readComponentSnapshot({ componentId: "ui/button", rootDir });
  return snapshot.files.map((file) => file.path);
}

describe("component tree walker", () => {
  it("captures every component-owned file category", async () => {
    const rootDir = await createComponentRoot();
    await writeComponentFile(rootDir, ".comp.json", "{}");
    await writeComponentFile(rootDir, ".env.example", "KEY=value");
    await writeComponentFile(rootDir, "src/button.ts", "export const button = 1;");
    await writeComponentFile(rootDir, "docs/usage.md", "# Usage");
    await writeComponentFile(rootDir, "demos/basic.tsx", "export default null;");
    await writeComponentFile(rootDir, "tests/button.test.ts", "test");
    await writeComponentFile(rootDir, "assets/icon.svg", "<svg/>");

    expect(await snapshotPaths(rootDir)).toEqual([
      ".comp.json",
      ".env.example",
      "assets/icon.svg",
      "demos/basic.tsx",
      "docs/usage.md",
      "src/button.ts",
      "tests/button.test.ts",
    ]);
  });

  it("orders paths deterministically by utf-8 byte order", async () => {
    const rootDir = await createComponentRoot();
    // Names differ in more than case, because a case-insensitive filesystem
    // would collapse an upper/lower pair into one file.
    for (const name of ["b.ts", "Z.ts", "0.ts", "_.ts"]) {
      await writeComponentFile(rootDir, name, name);
    }
    // Byte order puts "Z" (0x5a) before "_" (0x5f) and "b" (0x62); a locale
    // comparison would sort them differently.
    expect(await snapshotPaths(rootDir)).toEqual(["0.ts", "Z.ts", "_.ts", "b.ts"]);
  });

  it("prunes generated and internal directories at any depth", async () => {
    const rootDir = await createComponentRoot();
    await writeComponentFile(rootDir, "src/index.ts", "keep");
    for (const name of prunedDirectoryNames) {
      await writeComponentFile(rootDir, `${name}/top.txt`, "drop");
      await writeComponentFile(rootDir, `src/nested/${name}/deep.txt`, "drop");
    }

    expect(await snapshotPaths(rootDir)).toEqual(["src/index.ts"]);
  });

  it("records executable mode only for executable files", async () => {
    const rootDir = await createComponentRoot();
    await writeComponentFile(rootDir, "plain.txt", "plain");
    const scriptPath = await writeComponentFile(rootDir, "script.sh", "#!/bin/sh\n");
    await chmod(scriptPath, 0o755);

    const snapshot = await readComponentSnapshot({ componentId: "ui/button", rootDir });
    expect(snapshot.files.map((file) => [file.path, file.mode])).toEqual([
      ["plain.txt", "100644"],
      ["script.sh", "100755"],
    ]);
  });

  it("has no representation for empty directories", async () => {
    const rootDir = await createComponentRoot();
    await writeComponentFile(rootDir, "src/index.ts", "keep");
    await mkdir(path.join(rootDir, "empty/nested"), { recursive: true });

    expect(await snapshotPaths(rootDir)).toEqual(["src/index.ts"]);
  });

  it("reports a missing component directory", async () => {
    const rootDir = path.join(await createComponentRoot(), "absent");
    await expect(
      readComponentSnapshot({ componentId: "ui/button", rootDir })
    ).rejects.toThrow(/has no directory at/);
  });
});

describe("symbolic link rejection", () => {
  it("rejects a link pointing inside the component", async () => {
    const rootDir = await createComponentRoot();
    await writeComponentFile(rootDir, "src/index.ts", "keep");
    await symlink(path.join(rootDir, "src/index.ts"), path.join(rootDir, "alias.ts"));

    await expect(
      readComponentSnapshot({ componentId: "ui/button", rootDir })
    ).rejects.toThrow(/symbolic link at alias\.ts/);
  });

  it("rejects a link pointing outside the component", async () => {
    const rootDir = await createComponentRoot();
    const outside = await createComponentRoot();
    await writeComponentFile(outside, "secret.txt", "outside");
    await symlink(path.join(outside, "secret.txt"), path.join(rootDir, "escape.txt"));

    await expect(
      readComponentSnapshot({ componentId: "ui/button", rootDir })
    ).rejects.toThrow(/symbolic link at escape\.txt/);
  });

  it("rejects a link nested below the component root with its relative path", async () => {
    const rootDir = await createComponentRoot();
    await writeComponentFile(rootDir, "src/nested/keep.ts", "keep");
    await symlink(
      path.join(rootDir, "src/nested/keep.ts"),
      path.join(rootDir, "src/nested/alias.ts")
    );

    await expect(
      readComponentSnapshot({ componentId: "ui/button", rootDir })
    ).rejects.toThrow(/symbolic link at src\/nested\/alias\.ts/);
  });

  it("rejects a directory link without following it", async () => {
    const rootDir = await createComponentRoot();
    const outside = await createComponentRoot();
    await writeComponentFile(outside, "deep/file.txt", "outside");
    await symlink(outside, path.join(rootDir, "linked-dir"));

    const error = await readComponentSnapshot({ componentId: "ui/button", rootDir }).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ComponentHistoryError);
    expect((error as Error).message).toMatch(/symbolic link at linked-dir/);
    // The message names the link itself, never a path discovered through it.
    expect((error as Error).message).not.toContain("deep/file.txt");
  });

  it("ignores links hidden beneath a pruned directory", async () => {
    const rootDir = await createComponentRoot();
    const outside = await createComponentRoot();
    await writeComponentFile(outside, "target.txt", "outside");
    await writeComponentFile(rootDir, "src/index.ts", "keep");
    await mkdir(path.join(rootDir, "node_modules/pkg"), { recursive: true });
    await symlink(path.join(outside, "target.txt"), path.join(rootDir, "node_modules/pkg/link.txt"));
    await mkdir(path.join(rootDir, "dist"), { recursive: true });
    await symlink(outside, path.join(rootDir, "dist/linked"));

    expect(await snapshotPaths(rootDir)).toEqual(["src/index.ts"]);
  });

  it("ignores a pruned directory that is itself a link", async () => {
    const rootDir = await createComponentRoot();
    const outside = await createComponentRoot();
    await writeComponentFile(outside, "pkg/index.js", "linked");
    await writeComponentFile(rootDir, "src/index.ts", "keep");
    // A linked node_modules is normal in a workspace that links packages.
    await symlink(outside, path.join(rootDir, "node_modules"));

    expect(await snapshotPaths(rootDir)).toEqual(["src/index.ts"]);
  });

  it("rejects a component root that is a link", async () => {
    const target = await createComponentRoot();
    const parent = await createComponentRoot();
    const rootDir = path.join(parent, "linked-root");
    await symlink(target, rootDir);

    await expect(
      readComponentSnapshot({ componentId: "ui/button", rootDir })
    ).rejects.toThrow(/root .* is a symbolic link/);
  });
});
