import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What: asserts the base/resolved phase split is a fact about the module graph.
 *
 * Why here rather than as a lint rule or an import audit: `workspace-context-model`
 * requires that a base-phase operation cannot reach env resolution, and the
 * thing that makes that true is the absent dependency. A package that does not
 * declare `bit-lite-env-resolution` cannot import it whatever any individual
 * file does, so reading the manifests states the claim where the claim lives.
 *
 * Before this split both phases shipped from one entry point and the guarantee
 * rested on convention plus `history-independence.test.ts` — a test that
 * catches the mistake after it is written rather than preventing it.
 */

const packagesDir = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function dependenciesOf(packageName: string): Promise<Record<string, string>> {
  const manifest = JSON.parse(
    await readFile(path.join(packagesDir, packageName, "package.json"), "utf8")
  ) as { dependencies?: Record<string, string> };
  return manifest.dependencies ?? {};
}

describe("base and resolved workspace phases", () => {
  it("keeps the base workspace model unable to reach env resolution", async () => {
    const dependencies = await dependenciesOf("bit-lite-context");

    expect(dependencies).not.toHaveProperty("bit-lite-env-resolution");
  });

  it("points env resolution at the base workspace model", async () => {
    const dependencies = await dependenciesOf("bit-lite-env-resolution");

    expect(dependencies).toHaveProperty("bit-lite-context");
  });

  it("keeps the dependency one-directional", async () => {
    const base = await dependenciesOf("bit-lite-context");
    const resolved = await dependenciesOf("bit-lite-env-resolution");

    // One of these naming the other is the split; both naming each other would
    // be a cycle, and neither would mean the resolved phase has no base.
    expect(Object.keys(base)).not.toContain("bit-lite-env-resolution");
    expect(Object.keys(resolved)).toContain("bit-lite-context");
  });
});
