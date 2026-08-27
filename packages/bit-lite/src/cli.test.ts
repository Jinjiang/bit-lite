import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compile: vi.fn(),
  install: vi.fn(),
  link: vi.fn(),
  preview: vi.fn(),
  snap: vi.fn(),
  start: vi.fn(),
  sync: vi.fn(),
  tag: vi.fn(),
  test: vi.fn(),
}));

vi.mock("./commands/compile.js", () => ({ runCompileCommand: mocks.compile }));
vi.mock("./commands/install.js", () => ({ runInstallCommand: mocks.install }));
vi.mock("./commands/link.js", () => ({ runLinkCommand: mocks.link }));
vi.mock("./commands/preview.js", () => ({ runPreviewCommand: mocks.preview }));
vi.mock("./commands/snap.js", () => ({ runSnapCommand: mocks.snap }));
vi.mock("./commands/start.js", () => ({ runStartCommand: mocks.start }));
vi.mock("./commands/sync.js", () => ({ runSyncCommand: mocks.sync }));
vi.mock("./commands/tag.js", () => ({ runTagCommand: mocks.tag }));
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

describe("snap command", () => {
  it("dispatches to the snap runner with component filters preserved", async () => {
    const argv = ["snap", "-w", "demo-workspace", "--filter", "ui/**", "--filter", "lib/math"];

    expect(await runCli(argv)).toBe(0);
    expect(mocks.snap).toHaveBeenCalledOnce();
    expect(mocks.snap).toHaveBeenCalledWith({
      command: "snap",
      args: {
        raw: argv,
        options: {},
        passthrough: [],
      },
      workspaceRoot: path.resolve("demo-workspace"),
      componentFilters: ["ui/**", "lib/math"],
      help: false,
    });
  });

  it("reports a non-zero exit code when the snap runner fails", async () => {
    mocks.snap.mockRejectedValueOnce(new Error("git is unavailable"));

    expect(await runCli(["snap"])).toBe(1);
    expect(console.error).toHaveBeenCalledWith("git is unavailable");
  });

  it("lists snap in help", async () => {
    expect(await runCli(["--help"])).toBe(0);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain(
      "snap    record selected components in the component history store"
    );
  });

  it("does not load the snap runner for other commands", async () => {
    expect(await runCli(["compile", "-w", "demo-workspace"])).toBe(0);
    expect(mocks.compile).toHaveBeenCalledOnce();
    expect(mocks.snap).not.toHaveBeenCalled();
  });
});

describe("tag command", () => {
  it("dispatches to the tag runner with the filter and version preserved", async () => {
    const argv = ["tag", "-w", "demo-workspace", "--filter", "ui/button", "--version", "1.2.3"];

    expect(await runCli(argv)).toBe(0);
    expect(mocks.tag).toHaveBeenCalledOnce();
    expect(mocks.tag).toHaveBeenCalledWith({
      command: "tag",
      args: {
        raw: argv,
        options: { version: "1.2.3" },
        passthrough: [],
      },
      workspaceRoot: path.resolve("demo-workspace"),
      componentFilters: ["ui/button"],
      help: false,
    });
  });

  it("reports a non-zero exit code when the tag runner fails", async () => {
    mocks.tag.mockRejectedValueOnce(new Error("component versions are immutable"));

    expect(await runCli(["tag", "--filter", "ui/button", "--version", "1.0.0"])).toBe(1);
    expect(console.error).toHaveBeenCalledWith("component versions are immutable");
  });

  it("lists tag in help", async () => {
    expect(await runCli(["--help"])).toBe(0);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain(
      "tag     assign an immutable --version <semver> to one component's snap"
    );
  });
});

describe("sync command", () => {
  it("dispatches to the sync runner with the remote preserved", async () => {
    const argv = ["sync", "-w", "demo-workspace", "--remote", "git@example.com:components.git"];

    expect(await runCli(argv)).toBe(0);
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledWith({
      command: "sync",
      args: {
        raw: argv,
        options: { remote: "git@example.com:components.git" },
        passthrough: [],
      },
      workspaceRoot: path.resolve("demo-workspace"),
      componentFilters: [],
      help: false,
    });
  });

  it("dispatches without a remote once one is configured", async () => {
    expect(await runCli(["sync"])).toBe(0);
    expect(mocks.sync.mock.calls[0]?.[0].args.options).toEqual({});
  });

  it("reports a non-zero exit code when synchronization conflicts", async () => {
    mocks.sync.mockRejectedValueOnce(new Error("synchronization stopped with 1 conflict"));

    expect(await runCli(["sync"])).toBe(1);
    expect(console.error).toHaveBeenCalledWith("synchronization stopped with 1 conflict");
  });

  it("lists sync in help", async () => {
    expect(await runCli(["--help"])).toBe(0);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain(
      "sync    exchange component histories and tags with [--remote <url>]"
    );
  });
});
