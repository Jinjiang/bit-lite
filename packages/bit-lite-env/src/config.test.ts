import { describe, expect, it } from "vitest";
import {
  flattenEnvDefinition,
  isSupportedEnvServiceName,
  supportedEnvServiceNames,
  validateEnvDefinition,
  validateCompiledEnvDefinition,
  validateEnvServiceConfig,
} from "./index.js";

describe("bit-lite-env static definition", () => {
  it("supports test, preview, and compile", () => {
    expect(supportedEnvServiceNames).toEqual(["test", "preview", "compile"]);
    expect(isSupportedEnvServiceName("compile")).toBe(true);
    expect(isSupportedEnvServiceName("storybook")).toBe(false);
  });

  it("validates a package-owned JSON definition", () => {
    const definition = validateEnvDefinition({
      name: "@acme/env.react",
      extends: "@acme/env.node",
      config: { runtime: "browser" },
      services: {
        test: { vendor: "demo-vendors/testers/vitest", config: { retries: 1, coverage: true } },
        preview: {
          vendor: "demo-vendors/previewers/vite",
          config: { configFile: "./vite.js", mounter: "demo-config/react-mounter" },
        },
        compile: {
          vendor: "demo-vendors/compilers/typescript",
          config: { tsconfig: { compilerOptions: { jsx: "react-jsx" } } },
        },
      },
    }, "@acme/env.react");

    expect(definition.extends).toBe("@acme/env.node");
    expect(definition.services.compile?.config).toEqual({
      tsconfig: { compilerOptions: { jsx: "react-jsx" } },
    });
  });

  it("keeps compile config vendor-specific", () => {
    expect(validateEnvServiceConfig("compile", {
      vendor: "custom-compiler",
      config: { pipeline: ["parse", "emit"], custom: { format: "esm" } },
    }).config).toEqual({ pipeline: ["parse", "emit"], custom: { format: "esm" } });
  });

  it("rejects unsupported services and service fields", () => {
    expect(() => validateEnvDefinition({
      name: "@acme/env.node",
      services: { deploy: { vendor: "deploy" } },
    })).toThrow('env service "deploy" is not supported');

    for (const field of ["targets", "files", "patterns", "mode", "components", "rootDir"]) {
      expect(() => validateEnvServiceConfig("test", {
        vendor: "vitest",
        [field]: {},
      })).toThrow(`field "${field}" is not supported`);
    }
  });

  it("validates known preview and test fields", () => {
    expect(() => validateEnvServiceConfig("preview", {
      vendor: "vite-preview",
      config: { mounter: "./mounter.js" },
    })).toThrow('config.configFile" must be a non-empty string');

    expect(() => validateEnvServiceConfig("test", {
      vendor: "vitest",
      config: { retries: "twice" },
    })).toThrow('config.retries" must be a non-negative integer');
  });

  it("rejects invalid identities and non-JSON values", () => {
    expect(() => validateEnvDefinition({ name: "react", services: {} }, "@acme/env.react"))
      .toThrow('expected "@acme/env.react" but received "react"');
    expect(() => validateEnvDefinition({
      name: "@acme/env.react",
      services: { compile: { vendor: "ts", config: { callback: () => undefined } } },
    })).toThrow("recursively JSON-safe");
    expect(() => validateEnvDefinition({
      name: "@acme/env.react",
      services: { compile: { vendor: "ts", config: { value: Number.NaN } } },
    })).toThrow("finite numbers");
  });

  it("requires a valid parent package name and services object", () => {
    expect(() => validateEnvDefinition({
      name: "@acme/env.react",
      extends: "./node",
      services: {},
    })).toThrow('field "extends" must be a valid npm package name');
    expect(() => validateEnvDefinition({ name: "@acme/env.react" }))
      .toThrow('field "services" must be an object');
  });

  it("flattens inheritance while preserving per-service dependency origins", () => {
    const parent = flattenEnvDefinition(validateEnvDefinition({
      name: "@acme/env.node",
      services: {
        test: { vendor: "parent-test" },
        compile: { vendor: "parent-compile" },
      },
      config: { shared: "parent", parent: true },
    }));
    const child = flattenEnvDefinition(validateEnvDefinition({
      name: "@acme/env.react",
      extends: "@acme/env.node",
      services: { test: { vendor: "child-test" } },
      config: { shared: "child" },
    }), parent);

    expect(child).toEqual({
      formatVersion: 1,
      name: "@acme/env.react",
      services: {
        test: { vendor: "child-test" },
        compile: { vendor: "parent-compile" },
      },
      config: { shared: "child", parent: true },
      inheritance: ["@acme/env.node", "@acme/env.react"],
      serviceOrigins: {
        test: { dependencyPath: [] },
        compile: { dependencyPath: ["@acme/env.node"] },
      },
    });
    expect(validateCompiledEnvDefinition(child, "@acme/env.react")).toEqual(child);
  });

  it("rejects unsupported compiled formats and incomplete origins", () => {
    expect(() => validateCompiledEnvDefinition({
      formatVersion: 2,
      name: "@acme/env.node",
      services: {},
      inheritance: ["@acme/env.node"],
      serviceOrigins: {},
    })).toThrow("format version must be 1");
    expect(() => validateCompiledEnvDefinition({
      formatVersion: 1,
      name: "@acme/env.node",
      services: { compile: { vendor: "compiler" } },
      inheritance: ["@acme/env.node"],
      serviceOrigins: {},
    })).toThrow('service "compile" must define an origin');
  });
});
