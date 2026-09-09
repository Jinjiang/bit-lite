import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ParsedCliArgs } from "../cli-args-types.js";
import { openComponentHistoryStore } from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand } from "./snap.js";
import { runTagCommand, type TagReport } from "./tag.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("tag --interactive", () => {
  it("refuses to combine with --json", async () => {
    const root = await createWorkspace();
    await snap(root);

    await expect(
      tag(root, { interactive: true, json: true })
    ).rejects.toThrow(/--interactive and --json cannot be combined/);
  });

  it("refuses to combine with --version", async () => {
    const root = await createWorkspace();
    await snap(root);

    await expect(
      tag(root, { interactive: true, version: "1.0.0" })
    ).rejects.toThrow(/--interactive and --version cannot be combined/);
  });

  it("fails without a terminal instead of hanging or deriving silently", async () => {
    const root = await createWorkspace();
    await snap(root);

    const { stdin, stdout } = streams({ tty: false });

    await expect(
      runTagCommand(parsed("tag", root, { interactive: true }), {
        reporter: silent,
        stdin: stdin as never,
        stdout: stdout as never,
      })
    ).rejects.toThrow(/needs an interactive terminal[\s\S]*Omit --interactive/);
  });

  it("assigns the versions chosen in the selection", async () => {
    const root = await createWorkspace();
    await snap(root);

    const report = await drive(root, {}, (press) => {
      // lib/math: patch -> minor. Then confirm.
      press({ name: "right" });
      press({ name: "right" });
      press({ name: "return" });
    });

    expect(versionOf(report, "lib/math")).toBe("0.1.0");
    expect(report.tags.map((tag) => tag.componentId).sort()).toEqual(["lib/math", "ui/button"]);
  });

  it("writes nothing when the review is abandoned", async () => {
    const root = await createWorkspace();
    await snap(root);

    const refsBefore = await allRefs(root);
    const anchorsBefore = await readFile(path.join(root, "bit-lite.json"), "utf8");

    const report = await drive(root, {}, (press) => {
      press({ name: "right" });
      press({ name: "escape" });
    });

    expect(report.cancelled).toBe(true);
    expect(report.tags).toEqual([]);
    expect(await allRefs(root)).toBe(refsBefore);
    expect(await readFile(path.join(root, "bit-lite.json"), "utf8")).toBe(anchorsBefore);
  });

  it("rehearses with --dry-run and writes nothing", async () => {
    const root = await createWorkspace();
    await snap(root);

    const refsBefore = await allRefs(root);

    const report = await drive(root, { "dry-run": true }, (press) => {
      press({ name: "right" });
      press({ name: "return" });
    });

    expect(report.dryRun).toBe(true);
    expect(report.tags).toEqual([]);
    expect(report.planned.length).toBeGreaterThan(0);
    expect(await allRefs(root)).toBe(refsBefore);
  });

  it("reports nothing to release rather than presenting an empty selection", async () => {
    const root = await createWorkspace();
    await snap(root);
    await tag(root, {});

    // Everything already carries a version and nothing changed, so there is no
    // decision to make. No key is pressed; the command must not wait for one.
    const { stdin, stdout } = streams({ tty: true });
    const report = await runTagCommand(parsed("tag", root, { interactive: true }), {
      reporter: silent,
      stdin: stdin as never,
      stdout: stdout as never,
    });

    expect(report.tags).toEqual([]);
    expect(report.planned.every((entry) => entry.action === "skip")).toBe(true);
  });
});

type Key = { name?: string; ctrl?: boolean };

function versionOf(report: TagReport, componentId: string): string {
  const entry = report.planned.find((item) => item.componentId === componentId);
  if (!entry) throw new Error(`no plan entry for "${componentId}"`);
  return entry.version;
}

/** Runs the command and feeds it keystrokes once the selection is listening. */
async function drive(
  root: string,
  options: Record<string, unknown>,
  keys: (press: (key: Key, input?: string) => void) => void
): Promise<TagReport> {
  const { stdin, stdout } = streams({ tty: true });
  const press = (key: Key, input?: string) => stdin.emit("keypress", input, key);

  const running = runTagCommand(parsed("tag", root, { ...options, interactive: true }), {
    reporter: silent,
    stdin: stdin as never,
    stdout: stdout as never,
  });

  // The first plan is computed before the interface starts listening.
  await waitFor(() => stdin.listenerCount("keypress") > 0);
  keys((key, input) => press(key, input));

  return running;
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for the selection to start");
}

function streams(options: { tty: boolean }) {
  const stdin = new EventEmitter() as unknown as EventEmitter & Record<string, unknown>;
  stdin.isTTY = options.tty;
  stdin.isRaw = false;
  stdin.setRawMode = (mode: boolean) => {
    stdin.isRaw = mode;
    return stdin;
  };
  stdin.resume = () => undefined;
  stdin.pause = () => undefined;

  const stdout = new EventEmitter() as unknown as EventEmitter & Record<string, unknown>;
  stdout.isTTY = options.tty;
  stdout.columns = 120;
  stdout.rows = 24;
  stdout.write = () => true;

  return { stdin, stdout };
}

const silent = { report: () => undefined };

async function snap(root: string): Promise<void> {
  await runSnapCommand(parsed("snap", root, {}), { reporter: silent });
}

async function tag(root: string, options: Record<string, unknown>): Promise<TagReport> {
  return runTagCommand(parsed("tag", root, options), { reporter: silent });
}

async function allRefs(root: string): Promise<string> {
  const store = await openComponentHistoryStore({ workspaceRoot: root, create: false });
  const result = await store.run({ args: ["for-each-ref", "--format=%(refname) %(objectname)"] });
  return result.stdout.toString("utf8");
}

function parsed(
  command: string,
  workspaceRoot: string,
  options: Record<string, unknown>
): ParsedCliArgs {
  return {
    command,
    workspaceRoot,
    componentFilters: [],
    help: { kind: "none" },
    consumedBareWords: [],
    args: { raw: [command], options: options as never, passthrough: [] },
  };
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-tag-interactive-"));
  temporaryRoots.push(root);

  const components = [
    {
      path: "components/lib/math",
      id: "lib/math",
      packageName: "@my-scope/lib.math",
      env: { packageName: "demo-env-node", version: "0.0.0" },
    },
    {
      path: "components/ui/button",
      id: "ui/button",
      packageName: "@my-scope/ui.button",
      env: { packageName: "demo-env-node", version: "0.0.0" },
    },
  ];

  await touch(
    root,
    "bit-lite.json",
    JSON.stringify({ defaultScope: "my-scope", components }, null, 2)
  );
  await touch(root, "components/lib/math/.comp.json", JSON.stringify({ dependencies: {} }));
  await touch(root, "components/lib/math/index.ts", "export const add = 0;\n");
  await touch(
    root,
    "components/ui/button/.comp.json",
    JSON.stringify({ dependencies: { "@my-scope/lib.math": "workspace:*" } })
  );
  await touch(root, "components/ui/button/index.ts", "export const id = 'ui/button';\n");

  return root;
}

async function touch(root: string, relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}
