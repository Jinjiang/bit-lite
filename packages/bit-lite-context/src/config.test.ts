import { describe, expect, it } from "vitest";
import { validateConfig } from "./config.js";

function component(id: string, envName = "@scope/env.node", version = "^1.0.0") {
  return {
    path: `components/${id}`,
    id,
    packageName: `@scope/${id.replaceAll("/", ".")}`,
    env: { packageName: envName, version },
  };
}

describe("canonical workspace config", () => {
  it("accepts explicit package identities and returns deterministic ordering", () => {
    const config = validateConfig({
      defaultScope: "scope",
      components: [component("ui/button", "@scope/env.react", "workspace:*"), component("lib/math")],
    });
    expect(config.components.map((entry) => entry.id)).toEqual(["lib/math", "ui/button"]);
    expect(config.components[1]?.env).toEqual({ packageName: "@scope/env.react", version: "workspace:*" });
  });

  it("rejects legacy assignment forms", () => {
    expect(() => validateConfig({ envs: {}, components: [component("lib/math")] }))
      .toThrow('top-level "envs" is no longer supported');
    expect(() => validateConfig({ components: { "components/**": "node" } }))
      .toThrow("pattern-to-env component mappings are no longer supported");
    expect(() => validateConfig({ components: [{ ...component("lib/math"), envName: "node" }] }))
      .toThrow('field "envName" is no longer supported');
  });

  it("requires all explicit component and env fields", () => {
    const base = component("lib/math");
    for (const field of ["path", "id", "packageName", "env"] as const) {
      const invalid = { ...base } as Record<string, unknown>;
      delete invalid[field];
      expect(() => validateConfig({ components: [invalid] })).toThrow(field);
    }
    expect(() => validateConfig({ components: [{ ...base, env: { packageName: "@scope/env.node" } }] }))
      .toThrow("env.version");
  });

  it("rejects duplicate component identities", () => {
    const first = component("lib/math");
    expect(() => validateConfig({ components: [first, { ...component("lib/other"), path: first.path }] }))
      .toThrow("component path");
    expect(() => validateConfig({ components: [first, { ...component("lib/other"), id: first.id }] }))
      .toThrow("component id");
    expect(() => validateConfig({ components: [first, { ...component("lib/other"), packageName: first.packageName }] }))
      .toThrow("component package name");
  });

  it("rejects conflicting versions for one env identity", () => {
    expect(() => validateConfig({
      components: [component("lib/math", "@scope/env.node", "^1.0.0"), component("lib/other", "@scope/env.node", "^2.0.0")],
    })).toThrow('env package "@scope/env.node" has conflicting versions');
  });

  it("validates npm package names and version specs", () => {
    expect(() => validateConfig({ components: [{ ...component("lib/math"), packageName: "Bad Name" }] }))
      .toThrow("valid npm package name");
    expect(() => validateConfig({ components: [{ ...component("lib/math"), env: { packageName: "bad name", version: "1" } }] }))
      .toThrow("env.packageName");
    expect(() => validateConfig({ components: [{ ...component("lib/math"), env: { packageName: "env", version: "bad spec" } }] }))
      .toThrow("supported package version specifier");
  });
});
