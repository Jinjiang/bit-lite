import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ParsedCliArgs } from "bit-lite-context";
import { createGitRunner, resolveComponentStorePath, runGitLine } from "bit-lite-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSnapCommand } from "./snap.js";
import { runTagCommand, type TagReport, type TagReporter } from "./tag.js";

// These tests drive real Git subprocesses against real repositories, which
// exceeds the 5s default when the package suite runs in parallel with the
// preview and start end-to-end tests.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

const fixtureComponents = [
  { id: "lib/math", directory: "components/lib/math", packageName: "@my-scope/lib.math" },
  { id: "ui/button", directory: "components/ui/button", packageName: "@my-scope/ui.button" },
];

async function writeWorkspaceFile(
  root: string,
  relativePath: string,
  contents: string
): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-tag-cli-"));
  temporaryRoots.push(root);

  await writeWorkspaceFile(
    root,
    "bit-lite.json",
    JSON.stringify({
      defaultScope: "my-scope",
      components: fixtureComponents.map((component) => ({
        path: component.directory,
        id: component.id,
        packageName: component.packageName,
        env: { packageName: "demo-env-node", version: "0.0.0" },
      })),
    })
  );

  for (const component of fixtureComponents) {
    await writeWorkspaceFile(
      root,
      `${component.directory}/.comp.json`,
      JSON.stringify({ dependencies: {}, devDependencies: {}, peerDependencies: {} })
    );
    await writeWorkspaceFile(
      root,
      `${component.directory}/index.ts`,
      `export const id = "${component.id}";\n`
    );
  }

  return root;
}

function parsedTag(
  workspaceRoot: string,
  componentFilters: string[],
  version: string | string[] | undefined
): ParsedCliArgs {
  return {
    command: "tag",
    workspaceRoot,
    componentFilters,
    help: false,
    args: {
      raw: ["tag"],
      options: version === undefined ? {} : { version },
      passthrough: [],
    },
  };
}

function parsedSnap(workspaceRoot: string): ParsedCliArgs {
  return {
    command: "snap",
    workspaceRoot,
    componentFilters: [],
    help: false,
    args: { raw: ["snap"], options: {}, passthrough: [] },
  };
}

function recorder(): { reports: TagReport[]; reporter: TagReporter } {
  const reports: TagReport[] = [];
  return { reports, reporter: { report: (report) => reports.push(report) } };
}

const silentSnapReporter = { report: () => undefined };

describe("tag command", () => {
  it("assigns a version to the selected component's snap", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });

    const { reports, reporter } = recorder();
    const report = await runTagCommand(parsedTag(root, ["ui/button"], "1.0.0"), { reporter });

    expect(report.tags).toHaveLength(1);
    expect(report.tags[0]).toMatchObject({
      componentId: "ui/button",
      version: "1.0.0",
      status: "created",
    });
    expect(reports).toHaveLength(1);

    const store = createGitRunner({ gitDir: resolveComponentStorePath(root) });
    expect(await runGitLine(store, ["cat-file", "-t", report.tags[0]!.ref])).toBe("tag");
  });

  it("tags every registered component when no filter is supplied", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });

    const report = await runTagCommand(parsedTag(root, [], undefined), {
      reporter: recorder().reporter,
    });

    expect(report.tags.map((tag) => tag.componentId).sort()).toEqual(["lib/math", "ui/button"]);
  });

  it("derives a first version when none is supplied", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });

    const report = await runTagCommand(parsedTag(root, ["ui/button"], undefined), {
      reporter: recorder().reporter,
    });

    expect(report.tags[0]?.version).toBe("0.0.1");
  });

  it("increments the patch of a component's highest version", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });
    await runTagCommand(parsedTag(root, ["ui/button"], "1.4.2"), {
      reporter: recorder().reporter,
    });

    await writeWorkspaceFile(root, "components/ui/button/index.ts", "export const id = 3;\n");
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });
    const report = await runTagCommand(parsedTag(root, ["ui/button"], undefined), {
      reporter: recorder().reporter,
    });

    expect(report.tags[0]?.version).toBe("1.4.3");
  });

  it("derives versions independently across components", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });
    await runTagCommand(parsedTag(root, ["lib/math"], "2.0.0"), {
      reporter: recorder().reporter,
    });

    // Both components need something to release, or the unchanged one is skipped.
    for (const component of fixtureComponents) {
      await writeWorkspaceFile(root, `${component.directory}/index.ts`, "export const v = 2;\n");
    }
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });
    const report = await runTagCommand(parsedTag(root, [], undefined), {
      reporter: recorder().reporter,
    });

    const versions = Object.fromEntries(report.tags.map((tag) => [tag.componentId, tag.version]));
    expect(versions).toEqual({ "lib/math": "2.0.1", "ui/button": "0.0.1" });
  });

  it("skips a component that has nothing new", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });
    const first = await runTagCommand(parsedTag(root, [], undefined), {
      reporter: recorder().reporter,
    });

    const second = await runTagCommand(parsedTag(root, [], undefined), {
      reporter: recorder().reporter,
    });

    expect(first.tags).toHaveLength(2);
    expect(second.tags).toEqual([]);
    expect(second.planned.every((entry) => entry.action === "skip")).toBe(true);
    // Every component still carries what the first operation assigned.
    expect(second.planned.map((entry) => entry.version)).toEqual(
      first.tags.map((tag) => tag.version)
    );
  });

  it("advances only the components that changed", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });
    await runTagCommand(parsedTag(root, [], undefined), { reporter: recorder().reporter });

    await writeWorkspaceFile(root, "components/lib/math/index.ts", "export const v = 9;\n");
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });
    const report = await runTagCommand(parsedTag(root, [], undefined), {
      reporter: recorder().reporter,
    });

    expect(report.tags.map((tag) => [tag.componentId, tag.version])).toEqual([
      ["lib/math", "0.0.2"],
    ]);
    expect(
      report.planned.find((entry) => entry.componentId === "ui/button")
    ).toMatchObject({ action: "skip", version: "0.0.1" });
  });

  it("still assigns a version to an unchanged component that was never released", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });

    // Content is unchanged relative to its snap, but nothing has been released.
    const report = await runTagCommand(parsedTag(root, ["ui/button"], undefined), {
      reporter: recorder().reporter,
    });

    expect(report.tags[0]).toMatchObject({ componentId: "ui/button", version: "0.0.1" });
  });

  it("lets an explicit version override the skip", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });
    await runTagCommand(parsedTag(root, ["ui/button"], "1.0.0"), {
      reporter: recorder().reporter,
    });

    const report = await runTagCommand(parsedTag(root, ["ui/button"], "2.0.0"), {
      reporter: recorder().reporter,
    });

    expect(report.planned[0]?.action).toBe("tag");
    expect(report.tags[0]).toMatchObject({ version: "2.0.0", status: "created" });
  });

  it("rejects a repeated --version", async () => {
    const root = await createWorkspace();
    await expect(
      runTagCommand(parsedTag(root, ["ui/button"], ["1.0.0", "2.0.0"]), {
        reporter: recorder().reporter,
      })
    ).rejects.toThrow(/exactly one value/);
  });

  it("rejects an explicit version for more than one component", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });

    await expect(
      runTagCommand(parsedTag(root, ["**"], "1.0.0"), { reporter: recorder().reporter })
    ).rejects.toThrow(/--version applies to exactly one component, but the selection matched 2/);
  });

  it("rejects a version that is not exactly major.minor.patch", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });

    for (const version of ["v1.0", "1.2.3-rc.1", "1.2.3+build.5"]) {
      await expect(
        runTagCommand(parsedTag(root, ["ui/button"], version), { reporter: recorder().reporter })
      ).rejects.toThrow(/exactly major\.minor\.patch/);
    }
  });

  it("fails when the component has no snap", async () => {
    const root = await createWorkspace();
    await expect(
      runTagCommand(parsedTag(root, ["ui/button"], "1.0.0"), { reporter: recorder().reporter })
    ).rejects.toThrow(/has no snap to tag/);
  });

  it("reports a repeat of the same assignment as unchanged", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });
    await runTagCommand(parsedTag(root, ["ui/button"], "1.0.0"), {
      reporter: recorder().reporter,
    });

    const second = await runTagCommand(parsedTag(root, ["ui/button"], "1.0.0"), {
      reporter: recorder().reporter,
    });
    expect(second.tags[0]?.status).toBe("unchanged");
  });

  it("refuses to reassign a version to a newer snap", async () => {
    const root = await createWorkspace();
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });
    await runTagCommand(parsedTag(root, ["ui/button"], "1.0.0"), {
      reporter: recorder().reporter,
    });

    await writeWorkspaceFile(root, "components/ui/button/index.ts", "export const id = 2;\n");
    await runSnapCommand(parsedSnap(root), { reporter: silentSnapReporter });

    await expect(
      runTagCommand(parsedTag(root, ["ui/button"], "1.0.0"), { reporter: recorder().reporter })
    ).rejects.toThrow(/immutable/);
  });
});
