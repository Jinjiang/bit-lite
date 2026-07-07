import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs, parseCliArguments } from "./args.js";

describe("CLI args", () => {
  it("parses raw argv into a shared CLI arguments shape", () => {
    expect(parseCliArguments(["--port", "3000", "src", "--", "--debug"])).toEqual({
      raw: ["--port", "3000", "src", "--", "--debug"],
      positional: ["src"],
      options: {
        port: 3000,
      },
      passthrough: ["--debug"],
    });
  });

  it("parses command, workspace root, and command args", () => {
    const parsed = parseArgs(["build", "--workspace", "demo-workspace", "--port", "3000", "src"]);

    expect(parsed).toEqual({
      command: "build",
      args: {
        raw: ["build", "--workspace", "demo-workspace", "--port", "3000", "src"],
        positional: ["src"],
        options: {
          port: 3000,
        },
        passthrough: [],
      },
      workspaceRoot: path.resolve("demo-workspace"),
      componentFilters: [],
      help: false,
    });
  });

  it("parses global component filters outside command options", () => {
    const parsed = parseArgs([
      "test",
      "--filter",
      "components/ui/**",
      "--filter",
      "components/lib/math",
      "--watch",
    ]);

    expect(parsed.componentFilters).toEqual(["components/ui/**", "components/lib/math"]);
    expect(parsed.args.options).toEqual({
      watch: true,
    });
  });

  it("parses help flags without requiring a command", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("rejects workspace flags without a path", () => {
    expect(() => parseArgs(["--workspace"])).toThrow("--workspace requires a path");
  });

  it("rejects filter flags without a pattern", () => {
    expect(() => parseArgs(["test", "--filter"])).toThrow("--filter requires a component pattern");
  });
});
