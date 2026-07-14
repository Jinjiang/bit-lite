import { describe, expect, it } from "vitest";
import {
  defineEnv,
  isSupportedEnvServiceName,
  supportedEnvServiceNames,
  validateEnvConfig,
  validateEnvServiceConfig,
} from "./index.js";

describe("bit-lite-env config", () => {
  it("defines the first supported service set", () => {
    expect(supportedEnvServiceNames).toEqual(["test", "preview"]);
    expect(isSupportedEnvServiceName("test")).toBe(true);
    expect(isSupportedEnvServiceName("preview")).toBe(true);
    expect(isSupportedEnvServiceName("storybook")).toBe(false);
  });

  it("accepts test service config with test-specific fields", () => {
    const config = validateEnvConfig({
      extends: "base",
      services: {
        test: {
          vendor: "@bit-vendors/vitest",
          config: {
            configFile: "./configs/vitest",
            shard: "unit",
            retries: 1,
            coverage: true,
            customPool: "browser",
          },
          targets: {
            patterns: [{ include: ["**/*.{test,spec}.{ts,tsx}"], exclude: ["dist/**"] }],
          },
        },
      },
    });

    expect(config.services?.test?.config).toEqual({
      configFile: "./configs/vitest",
      shard: "unit",
      retries: 1,
      coverage: true,
      customPool: "browser",
    });
    expect(config.services?.test?.targets?.patterns?.[0]?.include).toEqual(["**/*.{test,spec}.{ts,tsx}"]);
  });

  it("rejects unsupported services", () => {
    expect(() =>
      validateEnvConfig({
        services: {
          storybook: {
            vendor: "storybook",
          },
        },
      })
    ).toThrow('env service "storybook" is not supported');
  });

  it("accepts preview service config with preview-specific fields", () => {
    const config = validateEnvServiceConfig("preview", {
      vendor: "@bit-vendors/vite-react-preview",
      config: {
        configFile: "./configs/vite",
        mounter: "./configs/react-mounter",
        docsTemplate: "./configs/docs-template",
        customTheme: "demo",
      },
    });

    expect(config.config).toEqual({
      configFile: "./configs/vite",
      mounter: "./configs/react-mounter",
      docsTemplate: "./configs/docs-template",
      customTheme: "demo",
    });
  });

  it("requires preview service config to name a config file", () => {
    expect(() =>
      validateEnvServiceConfig("preview", {
        vendor: "@bit-vendors/vite-react-preview",
      })
    ).toThrow('env service "preview" config must define field "config"');

    expect(() =>
      validateEnvServiceConfig("preview", {
        vendor: "@bit-vendors/vite-react-preview",
        config: {
          mounter: "./configs/react-mounter",
        },
      })
    ).toThrow('env service "preview" field "config.configFile" must be a non-empty string');
  });

  it("validates optional preview runtime module specifiers", () => {
    expect(() =>
      validateEnvServiceConfig("preview", {
        vendor: "vite-preview",
        config: { configFile: "./vite.ts", mounter: 42 },
      })
    ).toThrow('env service "preview" field "config.mounter" must be a non-empty string');

    expect(() =>
      validateEnvServiceConfig("preview", {
        vendor: "vite-preview",
        config: { configFile: "./vite.ts", docsTemplate: "" },
      })
    ).toThrow('env service "preview" field "config.docsTemplate" must be a non-empty string');
  });

  it("requires each service config to name a vendor", () => {
    expect(() => validateEnvServiceConfig("test", { config: {} })).toThrow(
      'env service "test" config must define a non-empty vendor'
    );
  });

  it("validates known service config fields", () => {
    expect(() =>
      validateEnvServiceConfig("test", {
        vendor: "@bit-vendors/vitest",
        config: {
          retries: "twice",
        },
      })
    ).toThrow('env service "test" field "config.retries" must be a non-negative integer');

    expect(() =>
      validateEnvServiceConfig("test", {
        vendor: "@bit-vendors/vitest",
        config: {
          coverage: "yes",
        },
      })
    ).toThrow('env service "test" field "config.coverage" must be a boolean');
  });

  it("rejects unsupported target pattern fields", () => {
    expect(() =>
      validateEnvServiceConfig("test", {
        vendor: "@bit-vendors/vitest",
        targets: {
          patterns: [
            {
              kind: "unit",
              include: ["**/*.test.ts"],
            },
          ],
        },
      })
    ).toThrow('env service "test" field "targets.patterns[0]".kind is not supported');
  });

  it("offers a typed helper for third-party env definitions", () => {
    const env = defineEnv({
      name: "@acme/bit-env-react",
      services: {
        test: {
          vendor: "@bit-vendors/vitest",
          config: {
            configFile: "./configs/vitest",
            coverage: true,
          },
        },
      },
    });

    expect(env.name).toBe("@acme/bit-env-react");
  });
});
