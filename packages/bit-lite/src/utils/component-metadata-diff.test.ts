import { describe, expect, it } from "vitest";
import {
  attributeSnapChange,
  compareComponentMetadata,
  hasMetadataChange,
} from "./component-metadata-diff.js";
import type { FileChange } from "bit-lite-history";

const noFiles: FileChange[] = [];
const sourceFiles: FileChange[] = [{ path: "src/index.ts", status: "modified" }];

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dependencies: { "@my-scope/lib.math": "0.0.0-ga17d5e0" },
    env: { packageName: "@my-scope/env.react", version: "0.0.0-g4e81b2c" },
    ...overrides,
  };
}

describe("metadata comparison", () => {
  it("reports a changed dependency version with both sides", () => {
    const comparison = compareComponentMetadata(
      config(),
      config({ dependencies: { "@my-scope/lib.math": "0.0.0-gc4b8e12" } })
    );

    expect(comparison.dependencies).toEqual([
      {
        field: "dependencies",
        packageName: "@my-scope/lib.math",
        before: "0.0.0-ga17d5e0",
        after: "0.0.0-gc4b8e12",
        status: "changed",
      },
    ]);
    expect(comparison.env).toBeUndefined();
  });

  it("reports an added dependency", () => {
    const comparison = compareComponentMetadata(
      config(),
      config({ dependencies: { "@my-scope/lib.math": "0.0.0-ga17d5e0", clsx: "^2.1.0" } })
    );

    expect(comparison.dependencies).toEqual([
      {
        field: "dependencies",
        packageName: "clsx",
        before: undefined,
        after: "^2.1.0",
        status: "added",
      },
    ]);
  });

  it("reports a removed dependency", () => {
    const comparison = compareComponentMetadata(config(), config({ dependencies: {} }));

    expect(comparison.dependencies).toEqual([
      {
        field: "dependencies",
        packageName: "@my-scope/lib.math",
        before: "0.0.0-ga17d5e0",
        after: undefined,
        status: "removed",
      },
    ]);
  });

  it("distinguishes dependency fields", () => {
    const comparison = compareComponentMetadata(
      config(),
      config({ peerDependencies: { react: "^19.2.7" } })
    );

    expect(comparison.dependencies).toEqual([
      {
        field: "peerDependencies",
        packageName: "react",
        before: undefined,
        after: "^19.2.7",
        status: "added",
      },
    ]);
  });

  it("reports an env version change separately from dependencies", () => {
    const comparison = compareComponentMetadata(
      config(),
      config({ env: { packageName: "@my-scope/env.react", version: "0.0.0-g9d02f7a" } })
    );

    expect(comparison.dependencies).toEqual([]);
    expect(comparison.env).toEqual({
      before: { packageName: "@my-scope/env.react", version: "0.0.0-g4e81b2c" },
      after: { packageName: "@my-scope/env.react", version: "0.0.0-g9d02f7a" },
    });
  });

  it("reports an env package change", () => {
    const comparison = compareComponentMetadata(
      config(),
      config({ env: { packageName: "demo-env-node", version: "0.0.0-g4e81b2c" } })
    );

    expect(comparison.env?.after).toEqual({
      packageName: "demo-env-node",
      version: "0.0.0-g4e81b2c",
    });
  });

  it("reports nothing for identical metadata", () => {
    expect(hasMetadataChange(compareComponentMetadata(config(), config()))).toBe(false);
  });

  it("treats reordered keys as unchanged", () => {
    const before = {
      env: { packageName: "e", version: "1.0.0" },
      dependencies: { a: "1.0.0", b: "2.0.0" },
      kind: "component",
    };
    const after = {
      kind: "component",
      dependencies: { b: "2.0.0", a: "1.0.0" },
      env: { version: "1.0.0", packageName: "e" },
    };

    expect(hasMetadataChange(compareComponentMetadata(before, after))).toBe(false);
  });

  it("reports a metadata difference that is neither a dependency nor an env change", () => {
    const comparison = compareComponentMetadata(config(), config({ kind: "env" }));

    expect(comparison.dependencies).toEqual([]);
    expect(comparison.env).toBeUndefined();
    expect(comparison.otherChanged).toBe(true);
    expect(hasMetadataChange(comparison)).toBe(true);
  });
});

describe("change source attribution", () => {
  it("reports a parentless snap as the initial version", () => {
    const attribution = attributeSnapChange({
      hasParent: false,
      fileChanges: sourceFiles,
      metadata: compareComponentMetadata(undefined, config()),
    });

    expect(attribution.initial).toBe(true);
    expect(attribution.sources).toEqual([]);
  });

  it("reports source for a change in component-owned files alone", () => {
    const attribution = attributeSnapChange({
      hasParent: true,
      fileChanges: sourceFiles,
      metadata: compareComponentMetadata(config(), config()),
    });

    expect(attribution.sources).toEqual(["source"]);
  });

  it("reports deps for a dependency version moving alone", () => {
    const attribution = attributeSnapChange({
      hasParent: true,
      fileChanges: noFiles,
      metadata: compareComponentMetadata(
        config(),
        config({ dependencies: { "@my-scope/lib.math": "0.0.0-gc4b8e12" } })
      ),
    });

    expect(attribution.sources).toEqual(["deps"]);
  });

  it("reports env for an env version moving alone", () => {
    const attribution = attributeSnapChange({
      hasParent: true,
      fileChanges: noFiles,
      metadata: compareComponentMetadata(
        config(),
        config({ env: { packageName: "@my-scope/env.react", version: "0.0.0-g9d02f7a" } })
      ),
    });

    expect(attribution.sources).toEqual(["env"]);
  });

  it("reports every applicable source at once", () => {
    const attribution = attributeSnapChange({
      hasParent: true,
      fileChanges: sourceFiles,
      metadata: compareComponentMetadata(
        config(),
        config({
          dependencies: { "@my-scope/lib.math": "0.0.0-gc4b8e12" },
          env: { packageName: "@my-scope/env.react", version: "0.0.0-g9d02f7a" },
        })
      ),
    });

    expect(attribution.sources).toEqual(["source", "deps", "env"]);
  });

  it("does not report a version change for reformatted metadata", () => {
    const attribution = attributeSnapChange({
      hasParent: true,
      fileChanges: noFiles,
      metadata: compareComponentMetadata(
        { dependencies: { a: "1.0.0" }, env: { packageName: "e", version: "1.0.0" } },
        { env: { version: "1.0.0", packageName: "e" }, dependencies: { a: "1.0.0" } }
      ),
    });

    expect(attribution.sources).toEqual([]);
    expect(attribution.otherMetadataChanged).toBe(false);
  });

  it("surfaces an unrecognized metadata change rather than dropping it", () => {
    const attribution = attributeSnapChange({
      hasParent: true,
      fileChanges: noFiles,
      metadata: compareComponentMetadata(config(), config({ kind: "env" })),
    });

    expect(attribution.sources).toEqual([]);
    expect(attribution.otherMetadataChanged).toBe(true);
  });
});
