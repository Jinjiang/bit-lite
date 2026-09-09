import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What: asserts producing and comparing use one definition of a component's
 * recorded content.
 *
 * Why a source assertion rather than a behavioral one: the behavioral claim —
 * `status` reports a component modified exactly when recording would act on it
 * — is already covered where the two are driven end to end. What that cannot
 * show is *why* they agree. They agree because one function defines the
 * recorded form and both call it; a second implementation could match today
 * and drift on the next change to the projection rules, with every behavioral
 * test still green.
 *
 * This is what the package buys. Before the move the two callers were files in
 * a `utils` directory that happened to import the same relative path, and
 * nothing said a third caller could not derive the recorded form itself.
 */

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

async function readSource(name: string): Promise<string> {
  return readFile(path.join(sourceDir, name), "utf8");
}

describe("one projection for producing and comparing", () => {
  it("has the recording traversal import the projection rather than derive one", async () => {
    const source = await readSource("component-recording.ts");

    expect(source).toContain('from "./component-projection.js"');
    expect(source).toContain("projectComponentConfigBytes");
  });

  it("has the comparison core import the same projection", async () => {
    const source = await readSource("component-inspection.ts");

    expect(source).toContain('from "./component-projection.js"');
    expect(source).toContain("projectComponentConfigBytes");
  });

  it("keeps the projection defined in exactly one module", async () => {
    const modules = [
      "component-projection.ts",
      "component-recording.ts",
      "component-metadata-diff.ts",
      "component-inspection.ts",
    ];

    const definitions: string[] = [];
    for (const name of modules) {
      if ((await readSource(name)).includes("export function projectComponentConfig(")) {
        definitions.push(name);
      }
    }

    expect(definitions).toEqual(["component-projection.ts"]);
  });
});
