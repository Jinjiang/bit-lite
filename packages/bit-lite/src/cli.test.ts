import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compile: vi.fn(),
  install: vi.fn(),
  link: vi.fn(),
  preview: vi.fn(),
  start: vi.fn(),
  test: vi.fn(),
}));

vi.mock("./commands/compile.js", () => ({ runCompileCommand: mocks.compile }));
vi.mock("./commands/install.js", () => ({ runInstallCommand: mocks.install }));
vi.mock("./commands/link.js", () => ({ runLinkCommand: mocks.link }));
vi.mock("./commands/preview.js", () => ({ runPreviewCommand: mocks.preview }));
vi.mock("./commands/start.js", () => ({ runStartCommand: mocks.start }));
vi.mock("./commands/test.js", () => ({ runTestCommand: mocks.test }));

import { runCli } from "./cli.js";
import { createWatchCommandArgs } from "./commands/watch.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("watch command", () => {
  it("dispatches to the compile runner with watch forced on and all arguments preserved", async () => {
    const argv = [
      "watch",
      "-w",
      "demo-workspace",
      "--filter",
      "components/a",
      "--filter",
      "components/b",
      "--custom",
      "value",
      "--",
      "--vendor-option",
      "payload",
    ];

    expect(await runCli(argv)).toBe(0);
    expect(mocks.compile).toHaveBeenCalledOnce();
    expect(mocks.compile).toHaveBeenCalledWith({
      command: "watch",
      args: {
        raw: argv,
        options: { custom: "value", watch: true },
        passthrough: ["--vendor-option", "payload"],
      },
      workspaceRoot: path.resolve("demo-workspace"),
      componentFilters: ["components/a", "components/b"],
      help: false,
    });
  });

  it("accepts redundant --watch without invoking the compile runner twice", async () => {
    expect(await runCli(["watch", "--watch"])).toBe(0);
    expect(mocks.compile).toHaveBeenCalledOnce();
    expect(mocks.compile.mock.calls[0]?.[0].args.options.watch).toBe(true);
  });

  it("rejects --no-watch before invoking the compile runner", async () => {
    expect(await runCli(["watch", "--no-watch"])).toBe(1);
    expect(mocks.compile).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("bit-lite watch conflicts with --no-watch");
  });

  it("normalizes a cloned parsed value without mutating its source", () => {
    const source = {
      command: "watch",
      args: {
        raw: ["watch", "--custom", "value", "--", "payload"],
        options: { custom: "value" },
        passthrough: ["payload"],
      },
      workspaceRoot: "/workspace",
      componentFilters: ["components/**"],
      help: false,
    };
    const before = structuredClone(source);

    const effective = createWatchCommandArgs(source);

    expect(source).toEqual(before);
    expect(effective).not.toBe(source);
    expect(effective.args).not.toBe(source.args);
    expect(effective.args.raw).not.toBe(source.args.raw);
    expect(effective.args.passthrough).not.toBe(source.args.passthrough);
    expect(effective.componentFilters).not.toBe(source.componentFilters);
    expect(effective).toEqual({
      ...before,
      args: { ...before.args, options: { custom: "value", watch: true } },
    });
  });

  it("lists watch as a compile-watch alias in help", async () => {
    expect(await runCli(["--help"])).toBe(0);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n"))
      .toContain("watch   alias for compile --watch");
  });
});
