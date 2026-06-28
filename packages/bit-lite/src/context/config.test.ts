import { describe, expect, it } from "vitest";
import { resolveEnvs, validateConfig } from "./config.js";

describe("config", () => {
  it("resolves inherited env services", () => {
    const config = validateConfig({
      defaultEnv: "node",
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
        defaultEnv: "node",
        envs: {
          node: {},
        },
        components: {
          "components/ui/**": "react",
        },
      })
    ).toThrow('component pattern "components/ui/**" references unknown env "react"');
  });
});
