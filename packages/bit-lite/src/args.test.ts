import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";

describe("CLI args", () => {
  it("keeps arguments after -- as vendor passthrough", () => {
    expect(parseArgs(["test", "--port", "3000", "--", "--debug"]).args).toEqual({
      raw: ["test", "--port", "3000", "--", "--debug"],
      options: {
        port: 3000,
      },
      passthrough: ["--debug"],
    });
  });

  it("parses command, workspace root, and command args", () => {
    const parsed = parseArgs(["test", "--workspace", "demo-workspace", "--port", "3000"]);

    expect(parsed).toEqual({
      command: "test",
      args: {
        raw: ["test", "--workspace", "demo-workspace", "--port", "3000"],
        options: {
          port: 3000,
        },
        passthrough: [],
      },
      workspaceRoot: path.resolve("demo-workspace"),
      componentFilters: [],
      help: { kind: "none" },
      // `test` does not declare --port, so the parser notes the word it took.
      // "3000" names no component, so the selection path leaves it alone.
      consumedBareWords: [{ option: "--port", value: "3000" }],
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

  describe("help requests", () => {
    it("resolves an absent command and the global help flags to the command list", () => {
      expect(parseArgs([]).help).toEqual({ kind: "list" });
      expect(parseArgs(["--help"]).help).toEqual({ kind: "list" });
      expect(parseArgs(["-h"]).help).toEqual({ kind: "list" });
      expect(parseArgs(["help"]).help).toEqual({ kind: "list" });
    });

    it("resolves every per-command spelling to the same request", () => {
      const expected = { kind: "command", command: "tag" };
      expect(parseArgs(["tag", "-h"]).help).toEqual(expected);
      expect(parseArgs(["tag", "--help"]).help).toEqual(expected);
      expect(parseArgs(["help", "tag"]).help).toEqual(expected);
    });

    it("carries an unknown help target through for dispatch to report", () => {
      expect(parseArgs(["help", "nope"]).help).toEqual({ kind: "command", command: "nope" });
    });

    it("wins over an argument the command would otherwise reject", () => {
      expect(parseArgs(["snap", "--dryrun", "-h"]).help).toEqual({
        kind: "command",
        command: "snap",
      });
    });
  });

  describe("declared option kinds", () => {
    it("keeps a flag from swallowing the bare word after it", () => {
      const parsed = parseArgs(["snap", "--json", "ui/button"]);

      expect(parsed.args.options.json).toBe(true);
      expect(parsed.componentFilters).toEqual(["ui/button"]);
    });

    it("lets a value option consume the bare word after it", () => {
      const parsed = parseArgs(["snap", "--message", "hello"]);

      expect(parsed.args.options.message).toBe("hello");
      expect(parsed.componentFilters).toEqual([]);
    });

    it("parses lazy as an option of the two commands that declare it", () => {
      expect(parseArgs(["preview", "--lazy"]).args.options.lazy).toBe(true);
      expect(parseArgs(["start", "--no-lazy"]).args.options.lazy).toBe(false);
      expect(parseArgs(["preview", "--lazy=false"]).args.options.lazy).toBe(false);
      expect(parseArgs(["preview", "--lazy=true"]).args.options.lazy).toBe(true);
      expect(() => parseArgs(["preview", "--lazy=sometimes"])).toThrow(
        "--lazy requires a boolean value"
      );
    });

    it("refuses lazy on a command that does not declare it", () => {
      expect(() => parseArgs(["snap", "--lazy"])).toThrow("Unrecognized option");
    });

    it("accepts the boolean forms on every flag, not only on lazy", () => {
      expect(parseArgs(["snap", "--json=true"]).args.options.json).toBe(true);
      expect(parseArgs(["snap", "--json=false"]).args.options.json).toBe(false);
      expect(parseArgs(["snap", "--no-json"]).args.options.json).toBe(false);
    });

    it("rejects a non-boolean value on every flag with one wording", () => {
      expect(() => parseArgs(["snap", "--json=maybe"])).toThrow("--json requires a boolean value");
      expect(() => parseArgs(["snap", "--dry-run=yes"])).toThrow(
        "--dry-run requires a boolean value"
      );
      expect(() => parseArgs(["tag", "--interactive=1"])).toThrow(
        "--interactive requires a boolean value"
      );
      expect(() => parseArgs(["status", "--detail=maybe"])).toThrow(
        "--detail requires a boolean value"
      );
      expect(() => parseArgs(["install", "--compile=yes"])).toThrow(
        "--compile requires a boolean value"
      );
      expect(() => parseArgs(["compile", "--watch=maybe"])).toThrow(
        "--watch requires a boolean value"
      );
      expect(() => parseArgs(["test", "--watch=maybe"])).toThrow(
        "--watch requires a boolean value"
      );
    });
  });

  describe("positional component patterns", () => {
    it("means what the same text means as --filter", () => {
      expect(parseArgs(["snap", "ui/button"]).componentFilters).toEqual(
        parseArgs(["snap", "--filter", "ui/button"]).componentFilters
      );
    });

    it("accepts several patterns", () => {
      expect(parseArgs(["status", "ui/**", "lib/math"]).componentFilters).toEqual([
        "ui/**",
        "lib/math",
      ]);
    });

    it("combines with an explicit filter as a union", () => {
      expect(parseArgs(["compile", "ui/button", "--filter", "lib/math"]).componentFilters).toEqual([
        "lib/math",
        "ui/button",
      ]);
    });

    it("never reaches a vendor as a positional argument", () => {
      const parsed = parseArgs(["compile", "ui/button", "--", "--vendor-option"]);

      expect(parsed.componentFilters).toEqual(["ui/button"]);
      expect(parsed.args.passthrough).toEqual(["--vendor-option"]);
      expect(parsed.args).not.toHaveProperty("positional");
      expect(Object.values(parsed.args.options)).not.toContain("ui/button");
    });

    it("is refused by a command that acts on the whole workspace", () => {
      expect(() => parseArgs(["install", "ui/button"])).toThrow(
        "install operates on the whole workspace and does not select components"
      );
      // The old message pointed at --filter, which those commands do not take.
      expect(() => parseArgs(["install", "ui/button"])).not.toThrow(
        "Use --filter for component selection"
      );
    });

    it("refuses --filter on a command that acts on the whole workspace", () => {
      // It used to be accepted and silently ignored.
      expect(() => parseArgs(["install", "--filter", "ui/button"])).toThrow(
        "install operates on the whole workspace and does not select components"
      );
      expect(() => parseArgs(["link", "--filter", "ui/button"])).toThrow(
        "link operates on the whole workspace"
      );
    });
  });

  describe("unknown options", () => {
    it("forwards them on a command that can reach a vendor", () => {
      expect(parseArgs(["test", "--reporter", "verbose"]).args.options.reporter).toBe("verbose");
    });

    it("refuses them on a command that reaches no vendor", () => {
      expect(() => parseArgs(["snap", "--dryrun"])).toThrow("--dryrun");
      expect(() => parseArgs(["status", "--detials"])).toThrow("--detials");
    });

    it("names the command's own options when refusing", () => {
      expect(() => parseArgs(["snap", "--dryrun"])).toThrow("--dry-run");
    });

    it("records the bare word an undeclared option consumed", () => {
      expect(parseArgs(["test", "--verbose", "ui/button"]).consumedBareWords).toEqual([
        { option: "--verbose", value: "ui/button" },
      ]);
    });

    it("records nothing when the undeclared option is followed by another option", () => {
      expect(parseArgs(["test", "--verbose", "--watch"]).consumedBareWords).toEqual([]);
    });

    it("records nothing for a value the CLI declares", () => {
      expect(parseArgs(["snap", "--message", "hello"]).consumedBareWords).toEqual([]);
    });

    it("leaves an undeclared option and its value alongside a positional pattern", () => {
      const parsed = parseArgs(["test", "--reporter", "verbose", "ui/button"]);

      expect(parsed.args.options.reporter).toBe("verbose");
      expect(parsed.componentFilters).toEqual(["ui/button"]);
      expect(parsed.consumedBareWords).toEqual([{ option: "--reporter", value: "verbose" }]);
    });
  });
});
