import { describe, expect, it } from "vitest";
import {
  getPackageRefEnvKey,
  getSelectedEnvKey,
  isSelectedEnvIdentity,
} from "./env-identity.js";

describe("selected env identity", () => {
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
