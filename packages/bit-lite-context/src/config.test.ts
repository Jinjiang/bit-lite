import { describe, expect, it } from "vitest";
import { resolveEnvs, validateConfig } from "./config.js";

describe("config", () => {
  it("resolves inherited env services", () => {
    const config = validateConfig({
      envs: {
        node: {
          services: {
            inspect: { level: "base" },
            typescript: { tsconfig: "tsconfig.json" },
          },
        },
        react: {
          extends: "node",
          services: {
            inspect: { level: "child" },
            test: {},
          },
        },
      },
      components: {
        "components/ui/**": "react",
      },
    });

    const envs = resolveEnvs(config);

    expect(envs.react?.services).toEqual({
      inspect: { level: "child" },
      typescript: { tsconfig: "tsconfig.json" },
      test: {},
    });
  });

  it("rejects components that point to unknown envs", () => {
    expect(() =>
      validateConfig({
        envs: {
          node: {},
        },
        components: {
          "components/ui/**": "react",
        },
      })
    ).toThrow('component pattern "components/ui/**" references unknown env "react"');
  });

  it("accepts explicit per-component records and keeps their local env assignment", () => {
    const config = validateConfig({
      envs: { node: {}, react: {} },
      components: [
        {
          path: "components/lib/math",
          id: "lib/math",
          envName: "node",
          packageName: "@scope/lib.math",
          env: { packageName: "demo-config", version: "workspace:*" },
        },
        {
          path: "components/ui/button",
          id: "ui/button",
          envName: "react",
          packageName: "@scope/ui.button",
          env: { packageName: "demo-config", version: "workspace:*" },
        },
      ],
    });

    expect(config.components).toEqual([
      { path: "components/lib/math", id: "lib/math", envName: "node" },
      { path: "components/ui/button", id: "ui/button", envName: "react" },
    ]);
  });

  it("rejects explicit component records with missing or unknown env names", () => {
    expect(() =>
      validateConfig({
        envs: { node: {} },
        components: [{ path: "components/lib/math", id: "lib/math" }],
      })
    ).toThrow('component entry at index 0 field "envName" must be a non-empty string');

    expect(() =>
      validateConfig({
        envs: { node: {} },
        components: [{ path: "components/ui/button", id: "ui/button", envName: "react" }],
      })
    ).toThrow('component "ui/button" references unknown env "react"');
  });
});
