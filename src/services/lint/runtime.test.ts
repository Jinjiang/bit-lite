import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLintResult, createLintTargets, readLintArgs, readLintVendorConfig } from "./runtime.js";

describe("lint runtime", () => {
  it("reads vendor config and command arguments", () => {
    expect(
      readLintVendorConfig({
        configFile: "eslint.config.mjs",
        args: ["--fix", 42, "--quiet"],
      })
    ).toEqual({
      configFile: "eslint.config.mjs",
      args: ["--fix", "--quiet"],
    });
    expect(readLintArgs(["--max-warnings", "0", false])).toEqual(["--max-warnings", "0"]);
    expect(readLintArgs({})).toBeUndefined();
  });

  it("creates relative component targets and service results", () => {
    const workspaceRoot = path.join("workspace");
    const targets = createLintTargets(workspaceRoot, [
      {
        id: "components/lib/math",
        rootDir: path.join(workspaceRoot, "components/lib/math"),
      },
    ]);
    const result = createLintResult({
      vendor: "eslint",
      envName: "node",
      targets,
      exitCode: 0,
    });

    expect(targets).toEqual(["components/lib/math"]);
    expect(result.ok).toBe(true);
    expect(result.toJSON()).toEqual({
      vendor: "eslint",
      envName: "node",
      targets,
      exitCode: 0,
    });
  });
});
