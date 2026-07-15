import { describe, expect, it } from "vitest";
import {
  getPackageRefEnvKey,
  getSelectedEnvKey,
  isSelectedEnvIdentity,
  toSelectedEnvIdentity,
} from "./env-identity.js";
import type { LoadedEnvRuntime } from "./types/index.js";

describe("selected env identity", () => {
  it("projects requested and installed versions without leaking loader state", () => {
    const runtime = {
      packageName: "@scope/env.react",
      requestedVersion: "workspace:*",
      installedVersion: "0.0.0",
      packageRoot: "/workspace/env",
      entryUrl: "file:///workspace/env/dist/index.json",
      entryDirectory: "/workspace/env/dist",
      effectiveDefinition: { name: "@scope/env.react", services: {} },
      services: {},
      inheritanceChain: ["@scope/env.node", "@scope/env.react"],
    } satisfies LoadedEnvRuntime;

    expect(toSelectedEnvIdentity(runtime)).toEqual({
      packageName: "@scope/env.react",
      requestedVersion: "workspace:*",
      installedVersion: "0.0.0",
    });
  });

  it("derives the same internal key from configured and loaded references", () => {
    expect(getPackageRefEnvKey({ packageName: "@scope/env.node", version: "^1.2.0" }))
      .toBe(getSelectedEnvKey({ packageName: "@scope/env.node", requestedVersion: "^1.2.0" }));
  });

  it("accepts only the closed JSON-safe identity shape", () => {
    expect(isSelectedEnvIdentity({
      packageName: "@scope/env.node",
      requestedVersion: "^1.2.0",
      installedVersion: "1.4.3",
    })).toBe(true);
    expect(isSelectedEnvIdentity({
      packageName: "@scope/env.node",
      requestedVersion: "^1.2.0",
      installedVersion: "1.4.3",
      envName: "@scope/env.node",
    })).toBe(false);
  });
});
