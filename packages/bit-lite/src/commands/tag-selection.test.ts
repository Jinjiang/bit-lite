import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { renderSelection, selectVersions, type SelectionRow } from "./tag-selection.js";
import type { TagPlanEntry, TagRelease } from "./tag.js";
import type { VersionDecisions } from "bit-lite-versioning";

/**
 * The interface is driven through injected streams, so navigation, editing, and
 * cancellation are testable without a terminal. Rendering is a pure function
 * over rows, so layout is asserted directly.
 */

describe("rendering the selection", () => {
  it("shows what each component carries, what it would get, and why", () => {
    const lines = renderSelection({
      rows: [row("lib/math", entry({ currentVersion: "0.0.1", version: "0.0.2" })), row("ui/card", undefined)],
      cursor: 0,
      columns: 120,
      height: 24,
    });

    expect(lines[0]).toBe("Release: 1 of 2 components");
    expect(lines[2]).toContain("lib/math");
    expect(lines[2]).toContain("0.0.1 → 0.0.2");
    expect(lines[2]).toContain("source changed");
  });

  it("marks the row under edit", () => {
    const lines = renderSelection({
      rows: [row("a", entry({})), row("b", entry({}))],
      cursor: 1,
      columns: 120,
      height: 24,
    });

    expect(lines[2]?.startsWith(" ")).toBe(true);
    expect(lines[3]?.startsWith(">")).toBe(true);
  });

  it("names the dependency that drew a component in", () => {
    const lines = renderSelection({
      rows: [
        row(
          "ui/button",
          entry({
            reason: {
              neverReleased: false,
              sources: ["deps"],
              dependencies: [
                {
                  field: "dependencies",
                  packageName: "@my-scope/lib.math",
                  before: "0.0.1",
                  after: "0.0.2",
                  status: "changed",
                },
              ],
              env: undefined,
              otherMetadataChanged: false,
            },
          })
        ),
      ],
      cursor: 0,
      columns: 120,
      height: 24,
    });

    expect(lines[2]).toContain("@my-scope/lib.math moved");
  });

  it("shows a skipped component as nothing new, and an excluded one as left out", () => {
    const lines = renderSelection({
      rows: [
        row("skipped", entry({ action: "skip", currentVersion: "1.0.0" })),
        row("excluded", undefined),
      ],
      cursor: 0,
      columns: 120,
      height: 24,
    });

    expect(lines[2]).toContain("nothing new");
    expect(lines[3]).toContain("left out of this release");
  });

  it("scrolls to keep the row under edit visible and says how many are hidden", () => {
    const rows = Array.from({ length: 40 }, (_, index) => row(`c/${index}`, entry({})));

    const lines = renderSelection({ rows, cursor: 30, columns: 120, height: 12 });

    expect(lines.join("\n")).toContain("c/30");
    expect(lines.some((line) => /… \d+ above, \d+ below/.test(line))).toBe(true);
  });

  it("truncates rather than wrapping a narrow terminal", () => {
    const lines = renderSelection({
      rows: [row("a-very-long-component-identifier", entry({}))],
      cursor: 0,
      columns: 30,
      height: 24,
    });

    expect(lines.every((line) => line.length <= 30)).toBe(true);
  });

  it("shows the exact-version prompt while one is being typed", () => {
    const lines = renderSelection({
      rows: [row("a", entry({}))],
      cursor: 0,
      columns: 120,
      height: 24,
      editing: { text: "2.1" },
    });

    expect(lines.join("\n")).toContain("exact version: 2.1_");
  });
});

describe("driving the selection", () => {
  it("confirms with no decisions when enter is pressed straight away", async () => {
    const { run, press } = harness();
    const result = run();

    press({ name: "return" });

    expect(await result).toMatchObject({ kind: "confirmed" });
    expect([...(await result as { decisions: VersionDecisions }).decisions]).toEqual([]);
  });

  it("cancels on escape without producing decisions", async () => {
    const { run, press } = harness();
    const result = run();

    press({ name: "escape" });

    expect(await result).toEqual({ kind: "cancelled" });
  });

  it("cancels on ctrl-c", async () => {
    const { run, press } = harness();
    const result = run();

    press({ name: "c", ctrl: true });

    expect(await result).toEqual({ kind: "cancelled" });
  });

  it("cycles a row's increment and records it against that component", async () => {
    const { run, press, settle } = harness();
    const result = run();

    press({ name: "right" });
    await settle();
    press({ name: "right" });
    await settle();
    press({ name: "return" });

    const confirmed = (await result) as { decisions: VersionDecisions };
    expect(confirmed.decisions.get("lib/math")).toEqual({ kind: "increment", increment: "minor" });
  });

  it("applies a decision to the row the cursor is on", async () => {
    const { run, press, settle } = harness();
    const result = run();

    press({ name: "down" });
    press({ name: "right" });
    await settle();
    press({ name: "return" });

    const confirmed = (await result) as { decisions: VersionDecisions };
    expect(confirmed.decisions.has("lib/math")).toBe(false);
    expect(confirmed.decisions.get("ui/button")).toEqual({ kind: "increment", increment: "patch" });
  });

  it("excludes and re-includes a component with space", async () => {
    const { run, press, settle } = harness();
    const result = run();

    press({ name: "space" });
    await settle();
    press({ name: "space" });
    await settle();
    press({ name: "return" });

    const confirmed = (await result) as { decisions: VersionDecisions };
    expect(confirmed.decisions.has("lib/math")).toBe(false);
  });

  it("accepts an exact version typed in place", async () => {
    const { run, press, settle } = harness();
    const result = run();

    press({ name: "e" }, "e");
    for (const character of "2.5.1") press({ name: character }, character);
    press({ name: "return" });
    await settle();
    press({ name: "return" });

    const confirmed = (await result) as { decisions: VersionDecisions };
    expect(confirmed.decisions.get("lib/math")).toEqual({ kind: "explicit", version: "2.5.1" });
  });

  it("reports an invalid exact version in place and keeps the review open", async () => {
    const { run, press, settle, output } = harness();
    const result = run();

    press({ name: "e" }, "e");
    for (const character of "1.2") press({ name: character }, character);
    press({ name: "return" });
    await settle();

    expect(output()).toContain("not an assignable component version");

    // Still open: correcting the version and confirming works.
    press({ name: "escape" });
    press({ name: "return" });
    expect(await result).toMatchObject({ kind: "confirmed" });
  });

  it("rolls a decision back when re-planning refuses it", async () => {
    const { run, press, settle, output } = harness({
      replan: async (decisions) => {
        if (decisions.get("lib/math")?.kind === "exclude") {
          throw new Error('component "lib/math" has uncommitted changes');
        }
        return release();
      },
    });
    const result = run();

    press({ name: "space" });
    await settle();

    expect(output()).toContain("uncommitted changes");

    press({ name: "return" });
    const confirmed = (await result) as { decisions: VersionDecisions };
    expect(confirmed.decisions.has("lib/math")).toBe(false);
  });

  it("restores the terminal when it finishes", async () => {
    const { run, press, stdin } = harness();
    const result = run();

    expect(stdin.isRaw).toBe(true);
    press({ name: "escape" });
    await result;

    expect(stdin.isRaw).toBe(false);
  });
});

type Key = { name?: string; ctrl?: boolean; meta?: boolean };

function harness(options: { replan?: (decisions: VersionDecisions) => Promise<TagRelease> } = {}) {
  const stdin = new EventEmitter() as unknown as EventEmitter & {
    isRaw: boolean;
    isTTY: boolean;
    setRawMode(mode: boolean): unknown;
    resume(): void;
    pause(): void;
  };
  stdin.isRaw = false;
  stdin.isTTY = true;
  stdin.setRawMode = (mode: boolean) => {
    stdin.isRaw = mode;
    return stdin;
  };
  stdin.resume = () => undefined;
  stdin.pause = () => undefined;

  const written: string[] = [];
  const stdout = new EventEmitter() as unknown as EventEmitter & {
    columns: number;
    rows: number;
    write(chunk: string): boolean;
  };
  stdout.columns = 120;
  stdout.rows = 24;
  stdout.write = (chunk: string) => {
    written.push(chunk);
    return true;
  };

  return {
    stdin,
    output: () => written.join(""),
    run: () =>
      selectVersions({
        components: [
          { id: "lib/math" } as never,
          { id: "ui/button" } as never,
        ],
        initial: release(),
        replan: options.replan ?? (async () => release()),
        stdin: stdin as never,
        stdout: stdout as never,
      }),
    press: (key: Key, input?: string) => stdin.emit("keypress", input, key),
    // Keypresses are queued onto a promise chain so re-plans cannot interleave,
    // so draining it takes a full turn of the event loop, not a few microtasks.
    settle: async () => {
      for (let index = 0; index < 3; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
  };
}

function release(): TagRelease {
  return {
    store: {} as never,
    workspace: {} as never,
    recording: {} as never,
    entries: [entry({ componentId: "lib/math" }), entry({ componentId: "ui/button" })],
    fingerprint: "f",
  };
}

function entry(overrides: Partial<TagPlanEntry>): TagPlanEntry {
  return {
    componentId: "lib/math",
    currentVersion: "0.0.1",
    version: "0.0.2",
    action: "tag",
    createsSnap: true,
    reason: {
      neverReleased: false,
      sources: ["source"],
      dependencies: [],
      env: undefined,
      otherMetadataChanged: false,
    },
    ...overrides,
  };
}

function row(componentId: string, planEntry: TagPlanEntry | undefined): SelectionRow {
  return {
    componentId,
    entry: planEntry === undefined ? undefined : { ...planEntry, componentId },
    decision: undefined,
  };
}
