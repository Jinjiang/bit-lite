import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createStartSourceCatalog,
  readStartSourceFile,
  readStartSourceFileIndex,
  StartSourceFileNotFoundError,
  startSourceContentLimitBytes,
} from "./start-source.js";
import type { WorkspaceComponent } from "bit-lite-context";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("start source read model", () => {
  it("indexes sorted regular source files while pruning ignored directories and symlinks", async () => {
    const fixture = await createFixture();
    await write(fixture.rootDir, ".comp.json", "{}\n");
    await write(fixture.rootDir, "z-last.ts", "export {};\n");
    await write(fixture.rootDir, "nested/a-first.ts", "export {};\n");
    for (const ignored of [".git", ".bit-lite", "node_modules", "dist", "build", "coverage"]) {
      await write(fixture.rootDir, `${ignored}/ignored.ts`, "secret\n");
    }
    await write(fixture.outsideDir, "outside.ts", "outside\n");
    await symlink(path.join(fixture.outsideDir, "outside.ts"), path.join(fixture.rootDir, "linked-file.ts"));
    await symlink(fixture.outsideDir, path.join(fixture.rootDir, "linked-directory"), "dir");

    const index = await readStartSourceFileIndex(fixture.component);

    expect(index).toEqual({
      componentId: "scope/component",
      mainFile: "index.ts",
      files: [
        { path: ".comp.json", size: 3 },
        { path: "index.ts", size: 24 },
        { path: "nested/a-first.ts", size: 11 },
        { path: "z-last.ts", size: 11 },
      ],
    });
    expect(JSON.stringify(index)).not.toContain(fixture.rootDir);
  });

  it("reads current UTF-8 content and rejects removed, escaping, and non-indexed paths", async () => {
    const fixture = await createFixture();
    const catalog = createStartSourceCatalog([fixture.component]);
    expect(catalog.get(fixture.component.id)).toBe(fixture.component);
    expect(catalog.get("scope/unselected")).toBeUndefined();

    await expect(readStartSourceFile(fixture.component, "index.ts")).resolves.toMatchObject({
      componentId: "scope/component",
      path: "index.ts",
      kind: "text",
      encoding: "utf-8",
      content: "export const value = 1;\n",
    });
    await writeFile(path.join(fixture.rootDir, "index.ts"), "export const value = 2;\n", "utf8");
    await expect(readStartSourceFile(fixture.component, "index.ts")).resolves.toMatchObject({
      kind: "text",
      content: "export const value = 2;\n",
    });

    await rm(path.join(fixture.rootDir, "index.ts"));
    await expect(readStartSourceFile(fixture.component, "index.ts")).rejects.toBeInstanceOf(StartSourceFileNotFoundError);
    for (const invalid of ["", "../outside.ts", "/etc/passwd", "C:\\outside.ts", "nested\\file.ts", "a//b.ts", "./index.ts"]) {
      await expect(readStartSourceFile(fixture.component, invalid)).rejects.toBeInstanceOf(StartSourceFileNotFoundError);
    }
  });

  it("returns explicit binary and bounded oversized snapshots without content", async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.rootDir, "nul.bin"), Buffer.from([0x61, 0, 0x62]));
    await writeFile(path.join(fixture.rootDir, "invalid.bin"), Buffer.from([0xc3, 0x28]));
    await writeFile(
      path.join(fixture.rootDir, "large.txt"),
      Buffer.alloc(startSourceContentLimitBytes + 1, 0x61)
    );

    await expect(readStartSourceFile(fixture.component, "nul.bin")).resolves.toEqual({
      componentId: "scope/component",
      path: "nul.bin",
      size: 3,
      kind: "binary",
    });
    await expect(readStartSourceFile(fixture.component, "invalid.bin")).resolves.toEqual({
      componentId: "scope/component",
      path: "invalid.bin",
      size: 2,
      kind: "binary",
    });
    await expect(readStartSourceFile(fixture.component, "large.txt")).resolves.toEqual({
      componentId: "scope/component",
      path: "large.txt",
      size: startSourceContentLimitBytes + 1,
      kind: "too-large",
      limitBytes: startSourceContentLimitBytes,
    });
  });
});

async function createFixture() {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-start-source-"));
  tempRoots.push(fixtureRoot);
  const rootDir = path.join(fixtureRoot, "component");
  const outsideDir = path.join(fixtureRoot, "outside");
  await Promise.all([mkdir(rootDir, { recursive: true }), mkdir(outsideDir, { recursive: true })]);
  await writeFile(path.join(rootDir, "index.ts"), "export const value = 1;\n", "utf8");
  const component = {
    id: "scope/component",
    rootDir,
    mainFileRelative: "index.ts",
  } as WorkspaceComponent;
  return { rootDir, outsideDir, component };
}

async function write(rootDir: string, relativePath: string, content: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}
