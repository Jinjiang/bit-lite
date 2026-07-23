import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs, parseCliArguments } from "./args.js";

describe("CLI args", () => {
  it("parses raw argv into a shared CLI arguments shape", () => {
    expect(parseCliArguments(["--port", "3000", "--", "--debug"])).toEqual({
      raw: ["--port", "3000", "--", "--debug"],
      options: {
        port: 3000,
      },
      passthrough: ["--debug"],
    });
  });

  it("parses command, workspace root, and command args", () => {
    const parsed = parseArgs(["build", "--workspace", "demo-workspace", "--port", "3000"]);

    expect(parsed).toEqual({
      command: "build",
      args: {
        raw: ["build", "--workspace", "demo-workspace", "--port", "3000"],
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

  it("parses lazy as a command boolean", () => {
    expect(parseArgs(["preview", "--lazy"]).args.options.lazy).toBe(true);
    expect(parseArgs(["start", "--no-lazy"]).args.options.lazy).toBe(false);
    expect(parseArgs(["preview", "--lazy=false"]).args.options.lazy).toBe(false);
    expect(() => parseArgs(["preview", "--lazy=sometimes"])).toThrow("--lazy requires a boolean value");
  });

  it("keeps -w assigned to workspace and parses an explicit negative watch option", () => {
    const parsed = parseArgs(["watch", "-w", "demo-workspace", "--no-watch"]);

    expect(parsed.workspaceRoot).toBe(path.resolve("demo-workspace"));
    expect(parsed.args.options.watch).toBe(false);
    expect(parsed.command).toBe("watch");
  });

  it("rejects workspace flags without a path", () => {
    expect(() => parseArgs(["--workspace"])).toThrow("--workspace requires a path");
  });

  it("rejects filter flags without a pattern", () => {
    expect(() => parseArgs(["test", "--filter"])).toThrow("--filter requires a component pattern");
  });

  it("rejects bare arguments after the command with named-option guidance", () => {
    expect(() => parseArgs(["compile", "ui/button"]))
      .toThrow("Use --filter for component selection or place vendor arguments after --");
    expect(() => parseCliArguments(["ui/button"]))
      .toThrow("Unsupported positional argument");
  });
});
