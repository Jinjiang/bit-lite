import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";

describe("CLI args", () => {
  it("parses command, workspace root, and command args", () => {
    const parsed = parseArgs(["build", "--workspace", "demo-workspace", "--port", "3000"]);

    expect(parsed).toEqual({
      command: "build",
      args: ["--port", "3000"],
      workspaceRoot: path.resolve("demo-workspace"),
      help: false,
    });
  });

  it("parses help flags without requiring a command", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("rejects workspace flags without a path", () => {
    expect(() => parseArgs(["--workspace"])).toThrow("--workspace requires a path");
  });
});
