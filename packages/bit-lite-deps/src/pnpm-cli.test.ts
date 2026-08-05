import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

import { resolvePnpmCliEntry, runPnpmInstall } from "./pnpm-cli.js";

class FakeChildProcess extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
}

let child: FakeChildProcess;

beforeEach(() => {
  vi.clearAllMocks();
  child = new FakeChildProcess();
  mocks.spawn.mockReturnValue(child);
});

describe("resolvePnpmCliEntry", () => {
  it("points at the CLI entry of the pinned pnpm dependency", () => {
    const entry = resolvePnpmCliEntry();

    expect(entry.endsWith("/bin/pnpm.mjs")).toBe(true);
    expect(existsSync(entry)).toBe(true);
  });
});

describe("runPnpmInstall", () => {
  it("runs the resolved CLI in the install root with reproducible flags", async () => {
    const pending = runPnpmInstall({
      cwd: "/workspace/.bit-lite/deps",
      filters: [".", "./components/@my-scope/ui.button"],
    });
    child.emit("close", 0, null);
    await pending;

    const [command, args, options] = mocks.spawn.mock.calls[0]!;
    expect(command).toBe(process.execPath);
    expect(args).toEqual([
      resolvePnpmCliEntry(),
      "install",
      "--reporter=ndjson",
      "--ignore-scripts",
      "--no-frozen-lockfile",
      "--filter",
      ".",
      "--filter",
      "./components/@my-scope/ui.button",
    ]);
    expect(options.cwd).toBe("/workspace/.bit-lite/deps");
  });

  it("drops inherited npm_config_* overrides from the child environment", async () => {
    vi.stubEnv("npm_config_frozen_lockfile", "true");
    vi.stubEnv("NPM_CONFIG_NODE_LINKER", "hoisted");
    vi.stubEnv("PNPM_HOME", "/home/user/.pnpm");

    const pending = runPnpmInstall({ cwd: "/workspace", filters: ["."] });
    child.emit("close", 0, null);
    await pending;

    const { env } = mocks.spawn.mock.calls[0]![2];
    expect(env.npm_config_frozen_lockfile).toBeUndefined();
    expect(env.NPM_CONFIG_NODE_LINKER).toBeUndefined();
    expect(env.PNPM_HOME).toBe("/home/user/.pnpm");

    vi.unstubAllEnvs();
  });

  it("forwards stdout chunks to the output callback", async () => {
    const chunks: string[] = [];
    const pending = runPnpmInstall({ cwd: "/workspace", filters: ["."], onOutput: (chunk) => chunks.push(chunk) });

    child.stdout.emit("data", '{"name":"pnpm:stage"}\n');
    child.stdout.emit("data", '{"name":"pnpm:stats"}\n');
    child.emit("close", 0, null);
    await pending;

    expect(chunks).toEqual(['{"name":"pnpm:stage"}\n', '{"name":"pnpm:stats"}\n']);
  });

  it("reports the exit code together with captured stderr", async () => {
    const pending = runPnpmInstall({ cwd: "/workspace", filters: ["."] });
    child.stderr.emit("data", "ERR_PNPM_NO_MATCHING_VERSION\n");
    child.emit("close", 1, null);

    await expect(pending).rejects.toThrow(
      "pnpm install failed with exit code 1\nERR_PNPM_NO_MATCHING_VERSION"
    );
  });

  it("reports a terminating signal when the CLI is killed", async () => {
    const pending = runPnpmInstall({ cwd: "/workspace", filters: ["."] });
    child.emit("close", null, "SIGKILL");

    await expect(pending).rejects.toThrow("pnpm install failed with signal SIGKILL");
  });

  it("reports a spawn failure without waiting for a close event", async () => {
    const pending = runPnpmInstall({ cwd: "/workspace", filters: ["."] });
    child.emit("error", new Error("ENOENT"));

    await expect(pending).rejects.toThrow("Failed to start pnpm install: ENOENT");
  });
});
