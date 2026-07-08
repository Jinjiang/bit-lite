import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findComponentFiles } from "./component-files.js";

describe("component file discovery", () => {
  it("finds files matching caller supplied patterns inside a component", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "bit-lite-component-files-"));
    await mkdir(path.join(rootDir, "nested"), { recursive: true });
    await Promise.all([
      writeFile(path.join(rootDir, "index.ts"), "export {};\n"),
      writeFile(path.join(rootDir, "index.test.ts"), "test('a', () => {});\n"),
      writeFile(path.join(rootDir, "button.docs.md"), "# Button\n"),
      writeFile(path.join(rootDir, "nested", "usage.docs.md"), "# Usage\n"),
    ]);

    await expect(findComponentFiles({ id: "components/demo", rootDir }, ["**/*.docs.md"])).resolves.toEqual([
      path.join(rootDir, "button.docs.md"),
      path.join(rootDir, "nested", "usage.docs.md"),
    ]);
  });
});
