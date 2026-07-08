import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findComponentTestFiles } from "./files.js";

describe("test file discovery", () => {
  it("finds test and spec files with the test vendor patterns", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "bit-lite-test-files-"));
    await mkdir(path.join(rootDir, "nested"), { recursive: true });
    await Promise.all([
      writeFile(path.join(rootDir, "index.ts"), "export {};\n"),
      writeFile(path.join(rootDir, "index.test.ts"), "test('a', () => {});\n"),
      writeFile(path.join(rootDir, "nested", "logic.spec.ts"), "test('b', () => {});\n"),
      writeFile(path.join(rootDir, "nested", "fixture.ts"), "export {};\n"),
    ]);

    await expect(findComponentTestFiles({ id: "components/demo", rootDir })).resolves.toEqual([
      path.join(rootDir, "index.test.ts"),
      path.join(rootDir, "nested", "logic.spec.ts"),
    ]);
  });
});
