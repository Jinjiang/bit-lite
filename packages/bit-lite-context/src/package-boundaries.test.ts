import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What: asserts that each package manifest states the module graph it actually
 * has — the base/resolved phase split first, and then the general rule that
 * makes such a split enforceable at all.
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
 *
 * That argument only holds while a declaration means something. A dependency
 * no package imports still grants reach: it says this package may import that
 * one, and nothing contradicts it. Three such declarations had accumulated —
 * `bit-lite-env` in `bit-lite`, in this package, and in `bit-lite-vendors` —
 * each a boundary the manifests allowed and the source never crossed. So the
 * two rules below keep declaration and import in step in both directions, and
 * the phase split stays a fact rather than a convention.
 */

const packagesDir = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

async function readManifest(directoryName: string): Promise<Manifest | undefined> {
  try {
    return JSON.parse(
      await readFile(path.join(packagesDir, directoryName, "package.json"), "utf8")
    ) as Manifest;
  } catch {
    return undefined;
  }
}

async function dependenciesOf(directoryName: string): Promise<Record<string, string>> {
  return (await readManifest(directoryName))?.dependencies ?? {};
}

/** Every TypeScript source of a package, with the test files kept separate. */
async function readSources(
  directoryName: string
): Promise<{ production: string; tests: string } | undefined> {
  const production: string[] = [];
  const tests: string[] = [];
  let found = false;

  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    found = true;
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const contents = await readFile(entryPath, "utf8");
      if (entry.name.includes(".test.")) tests.push(contents);
      else production.push(contents);
    }
  }

  await walk(path.join(packagesDir, directoryName, "src"));
  if (!found) return undefined;
  return { production: production.join("\n"), tests: tests.join("\n") };
}

/**
 * Reports whether a source reaches a package as a module, counting static and
 * dynamic imports, re-exports, `require`, and a test's module mock.
 *
 * Two details do the work. The specifier must sit in an importing position, so
 * a package named as data — as it is in this file, and in
 * `history-independence.test.ts` — is not mistaken for a dependency. And the
 * closing delimiter must be matched, so `bit-lite-env` does not match every
 * mention of `bit-lite-env-resolution`; that pair is exactly the one whose
 * stale declarations went unnoticed.
 */
function importsPackage(source: string, packageName: string): boolean {
  const specifier = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:from|import|require|[mM]ock)\\s*\\(?\\s*["'\`]${specifier}(?:/[^"'\`]*)?["'\`]`
  ).test(source);
}

type SourcePackage = {
  manifest: Manifest;
  sources: { production: string; tests: string };
};

const directoryNames = (await readdir(packagesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const manifests = new Map<string, Manifest>();
for (const directoryName of directoryNames) {
  const manifest = await readManifest(directoryName);
  if (manifest) manifests.set(directoryName, manifest);
}

const workspacePackageNames = new Set([...manifests.values()].map((manifest) => manifest.name));

/**
 * The packages these rules describe: the ones that have TypeScript sources.
 * `demo-env-*` and the demo workspace declare packages they reach through env
 * JSON specifiers and package resolution rather than through imports, so an
 * import-based rule has nothing to say about them.
 */
const sourcePackages: [string, SourcePackage][] = [];
for (const [directoryName, manifest] of manifests) {
  const sources = await readSources(directoryName);
  if (sources) sourcePackages.push([manifest.name, { manifest, sources }]);
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

describe("a declared workspace dependency is one the package imports", () => {
  it("has source packages to check", () => {
    expect(sourcePackages.length).toBeGreaterThan(0);
  });

  it.each(sourcePackages)("%s imports every workspace package it declares", (_name, entry) => {
    const declared = Object.keys(entry.manifest.dependencies ?? {}).filter((dependency) =>
      workspacePackageNames.has(dependency)
    );

    // Production sources only: `dependencies` is what the built package needs
    // at runtime, so one imported by tests alone belongs in `devDependencies`
    // and is covered by the reverse rule instead.
    const unused = declared.filter(
      (dependency) => !importsPackage(entry.sources.production, dependency)
    );

    expect(unused).toEqual([]);
  });

  it.each(sourcePackages)("%s declares every workspace package it imports", (name, entry) => {
    const declared = new Set([
      ...Object.keys(entry.manifest.dependencies ?? {}),
      ...Object.keys(entry.manifest.devDependencies ?? {}),
    ]);
    const source = `${entry.sources.production}\n${entry.sources.tests}`;

    // The mirror of the rule above, and what makes removing a declaration safe:
    // under pnpm an undeclared package resolves only by an accident of
    // hoisting, so a phantom dependency is a boundary nobody stated.
    const undeclared = [...workspacePackageNames].filter(
      (candidate) =>
        candidate !== name && !declared.has(candidate) && importsPackage(source, candidate)
    );

    expect(undeclared).toEqual([]);
  });
});
