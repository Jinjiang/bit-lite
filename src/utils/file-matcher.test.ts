import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileHasKind, findFilesByKind, findFirstFileByKind } from "./file-matcher.js";

describe("file matcher", () => {
  it("matches dot-separated file kinds without caring about extensions", () => {
    expect(fileHasKind("preview.ts", "preview")).toBe(true);
    expect(fileHasKind("button.preview.tsx", "preview")).toBe(true);
    expect(fileHasKind("card.preview.vue", "preview")).toBe(true);
    expect(fileHasKind("component.docs.mdx", "docs")).toBe(true);
    expect(fileHasKind("index.test.ts", "test")).toBe(true);
    expect(fileHasKind("index.spec.anything", "spec")).toBe(true);
    expect(fileHasKind("preview-button.ts", "preview")).toBe(false);
  });

  it("finds files of a kind in a directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-files-"));
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "button.preview.tsx"), "");
    await writeFile(path.join(root, "card.preview.vue"), "");
    await writeFile(path.join(root, "index.test.ts"), "");
    await writeFile(path.join(root, "nested", "nested.preview.ts"), "");

    const previews = await findFilesByKind(root, "preview");

    expect(previews.map((file) => path.basename(file))).toEqual(["button.preview.tsx", "card.preview.vue"]);
    await expect(findFirstFileByKind(root, "test")).resolves.toBe(path.join(root, "index.test.ts"));
  });
});
