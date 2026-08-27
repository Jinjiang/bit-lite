import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readComponentHead } from "./commits.js";
import { ComponentHistoryError, GitCommandError } from "./errors.js";
import { createGitRunner, runGitLine, type GitCommandInput } from "./git-process.js";
import { parseObjectId } from "./object-id.js";
import { componentHeadRef, componentTagRef, remoteComponentHeadRef } from "./refs.js";
import { readStoreRemoteUrl, resolveStoreRemote } from "./remote.js";
import { snapComponents, type SnapRequest } from "./snap.js";
import { openComponentHistoryStore, type ComponentHistoryStore } from "./store.js";
import { syncComponentHistory } from "./sync.js";
import { tagComponent } from "./tags.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function createTemporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

/** A bare repository on disk is a deterministic stand-in for a real remote. */
async function createRemote(): Promise<string> {
  const root = await createTemporaryRoot("bit-lite-history-remote-");
  const remotePath = path.join(root, "components.git");
  await createGitRunner()({ args: ["init", "--bare", "--quiet", remotePath] });
  return remotePath;
}

type Peer = {
  workspaceRoot: string;
  store: ComponentHistoryStore;
};

async function createPeer(): Promise<Peer> {
  const workspaceRoot = await createTemporaryRoot("bit-lite-history-sync-");
  const store = await openComponentHistoryStore({ workspaceRoot });
  return { workspaceRoot, store };
}

async function createComponent(
  peer: Peer,
  componentId: string,
  directoryName: string,
  contents = "initial"
): Promise<SnapRequest> {
  const rootDir = path.join(peer.workspaceRoot, directoryName);
  await mkdir(rootDir, { recursive: true });
  await writeFile(path.join(rootDir, "index.ts"), `export const id = "${contents}";\n`);
  return { componentId, rootDir };
}

async function changeComponent(request: SnapRequest, contents: string): Promise<void> {
  await writeFile(path.join(request.rootDir, "index.ts"), `export const id = "${contents}";\n`);
}

async function remoteRefs(remotePath: string): Promise<string[]> {
  const run = createGitRunner({ gitDir: remotePath });
  const output = await runGitLine(run, ["for-each-ref", "--format=%(refname)"]);
  return output.length === 0 ? [] : output.split("\n");
}

describe("remote configuration", () => {
  it("configures origin on first sync and reuses it afterwards", async () => {
    const remotePath = await createRemote();
    const peer = await createPeer();
    const component = await createComponent(peer, "ui/button", "button");
    await snapComponents(peer.store, [component]);

    const first = await syncComponentHistory(peer.store, { requestedUrl: remotePath });
    expect(first.remoteUrl).toBe(remotePath);
    expect(await readStoreRemoteUrl(peer.store)).toBe(remotePath);

    const second = await syncComponentHistory(peer.store);
    expect(second.remoteUrl).toBe(remotePath);
  });

  it("fails when no remote is configured and none is supplied", async () => {
    const peer = await createPeer();
    await expect(syncComponentHistory(peer.store)).rejects.toThrow(/no component history remote/);
  });

  it("refuses to replace a configured remote", async () => {
    const remotePath = await createRemote();
    const otherPath = await createRemote();
    const peer = await createPeer();
    await resolveStoreRemote(peer.store, { requestedUrl: remotePath });

    await expect(
      syncComponentHistory(peer.store, { requestedUrl: otherPath })
    ).rejects.toThrow(/refusing to replace it/);
    expect(await readStoreRemoteUrl(peer.store)).toBe(remotePath);
  });

  it("configures the remote inside the store, not the workspace", async () => {
    const remotePath = await createRemote();
    const peer = await createPeer();
    await createGitRunner()({ args: ["init", "--quiet", peer.workspaceRoot] });
    const sourceGit = createGitRunner({ gitDir: path.join(peer.workspaceRoot, ".git") });

    const component = await createComponent(peer, "ui/button", "button");
    await snapComponents(peer.store, [component]);
    await syncComponentHistory(peer.store, { requestedUrl: remotePath });

    expect(await runGitLine(sourceGit, ["remote", "-v"])).toBe("");
  });
});

describe("publish and import", () => {
  it("publishes local-only component history on first sync", async () => {
    const remotePath = await createRemote();
    const peer = await createPeer();
    const component = await createComponent(peer, "ui/button", "button");
    await snapComponents(peer.store, [component]);

    const result = await syncComponentHistory(peer.store, { requestedUrl: remotePath });

    expect(result.heads).toEqual([
      expect.objectContaining({ componentId: "ui/button", outcome: "published" }),
    ]);
    expect(result.published).toBe(true);
    expect(await remoteRefs(remotePath)).toContain(componentHeadRef("ui/button"));
  });

  it("imports remote-only component history", async () => {
    const remotePath = await createRemote();
    const publisher = await createPeer();
    const component = await createComponent(publisher, "ui/button", "button");
    await snapComponents(publisher.store, [component]);
    await syncComponentHistory(publisher.store, { requestedUrl: remotePath });

    const consumer = await createPeer();
    const result = await syncComponentHistory(consumer.store, { requestedUrl: remotePath });

    expect(result.heads).toEqual([
      expect.objectContaining({ componentId: "ui/button", outcome: "imported" }),
    ]);
    const localHead = await readComponentHead(consumer.store, "ui/button");
    const publisherHead = await readComponentHead(publisher.store, "ui/button");
    expect(localHead?.hex).toBe(publisherHead?.hex);
  });

  it("reports an unchanged store as up to date and issues no push", async () => {
    const remotePath = await createRemote();
    const peer = await createPeer();
    const component = await createComponent(peer, "ui/button", "button");
    await snapComponents(peer.store, [component]);
    await syncComponentHistory(peer.store, { requestedUrl: remotePath });

    const second = await syncComponentHistory(peer.store);

    expect(second.upToDate).toBe(true);
    expect(second.published).toBe(false);
    expect(second.heads).toEqual([
      expect.objectContaining({ componentId: "ui/button", outcome: "unchanged" }),
    ]);
  });

  it("keeps independent components independent across peers", async () => {
    const remotePath = await createRemote();
    const first = await createPeer();
    const second = await createPeer();
    await snapComponents(first.store, [await createComponent(first, "ui/button", "button")]);
    await snapComponents(second.store, [await createComponent(second, "ui/card", "card", "card")]);

    await syncComponentHistory(first.store, { requestedUrl: remotePath });
    await syncComponentHistory(second.store, { requestedUrl: remotePath });
    const back = await syncComponentHistory(first.store);

    expect(back.heads.map((head) => [head.componentId, head.outcome])).toEqual([
      ["ui/button", "unchanged"],
      ["ui/card", "imported"],
    ]);
  });
});

describe("fast-forward reconciliation", () => {
  it("fast-forwards a local head that is behind the remote", async () => {
    const remotePath = await createRemote();
    const publisher = await createPeer();
    const component = await createComponent(publisher, "ui/button", "button");
    await snapComponents(publisher.store, [component]);
    await syncComponentHistory(publisher.store, { requestedUrl: remotePath });

    const consumer = await createPeer();
    await syncComponentHistory(consumer.store, { requestedUrl: remotePath });
    const behind = (await readComponentHead(consumer.store, "ui/button"))!;

    await changeComponent(component, "second");
    await snapComponents(publisher.store, [component]);
    await syncComponentHistory(publisher.store);

    const result = await syncComponentHistory(consumer.store);

    expect(result.heads).toEqual([
      expect.objectContaining({ componentId: "ui/button", outcome: "fast-forwarded" }),
    ]);
    const after = (await readComponentHead(consumer.store, "ui/button"))!;
    expect(after.hex).not.toBe(behind.hex);
    expect(after.hex).toBe((await readComponentHead(publisher.store, "ui/button"))!.hex);
  });

  it("publishes a local head that is ahead of the remote", async () => {
    const remotePath = await createRemote();
    const peer = await createPeer();
    const component = await createComponent(peer, "ui/button", "button");
    await snapComponents(peer.store, [component]);
    await syncComponentHistory(peer.store, { requestedUrl: remotePath });

    await changeComponent(component, "second");
    await snapComponents(peer.store, [component]);
    const result = await syncComponentHistory(peer.store);

    expect(result.heads).toEqual([
      expect.objectContaining({ componentId: "ui/button", outcome: "published" }),
    ]);
    const remoteHead = await runGitLine(createGitRunner({ gitDir: remotePath }), [
      "rev-parse",
      componentHeadRef("ui/button"),
    ]);
    expect(remoteHead).toBe((await readComponentHead(peer.store, "ui/button"))!.hex);
  });

  it("reports divergence without changing or publishing anything", async () => {
    const remotePath = await createRemote();
    const first = await createPeer();
    const component = await createComponent(first, "ui/button", "button");
    await snapComponents(first.store, [component]);
    await syncComponentHistory(first.store, { requestedUrl: remotePath });

    const second = await createPeer();
    await syncComponentHistory(second.store, { requestedUrl: remotePath });
    const secondComponent = await createComponent(second, "ui/button", "button", "from-second");
    await snapComponents(second.store, [secondComponent]);
    await syncComponentHistory(second.store);

    // The first peer now builds a different commit on the same base.
    await changeComponent(component, "from-first");
    await snapComponents(first.store, [component]);
    const localBefore = (await readComponentHead(first.store, "ui/button"))!;

    const result = await syncComponentHistory(first.store);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatch(/has diverged/);
    expect(result.published).toBe(false);
    expect(result.heads).toEqual([
      expect.objectContaining({ componentId: "ui/button", outcome: "conflicted" }),
    ]);
    expect((await readComponentHead(first.store, "ui/button"))!.hex).toBe(localBefore.hex);
  });
});

describe("tag reconciliation", () => {
  it("publishes and imports annotated tags", async () => {
    const remotePath = await createRemote();
    const publisher = await createPeer();
    const component = await createComponent(publisher, "ui/button", "button");
    await snapComponents(publisher.store, [component]);
    await tagComponent(publisher.store, { componentId: "ui/button", version: "1.0.0" });

    const published = await syncComponentHistory(publisher.store, { requestedUrl: remotePath });
    expect(published.tags).toEqual([
      expect.objectContaining({ componentId: "ui/button", version: "1.0.0", outcome: "published" }),
    ]);

    const consumer = await createPeer();
    const imported = await syncComponentHistory(consumer.store, { requestedUrl: remotePath });
    expect(imported.tags).toEqual([
      expect.objectContaining({ componentId: "ui/button", version: "1.0.0", outcome: "imported" }),
    ]);
    // The imported ref is still an annotated tag object.
    expect(
      await runGitLine(consumer.store.run, ["cat-file", "-t", componentTagRef("ui/button", "1.0.0")])
    ).toBe("tag");
  });

  it("reports an immutable-tag conflict without changing anything", async () => {
    const remotePath = await createRemote();
    const first = await createPeer();
    const component = await createComponent(first, "ui/button", "button");
    await snapComponents(first.store, [component]);
    await syncComponentHistory(first.store, { requestedUrl: remotePath });

    const second = await createPeer();
    await syncComponentHistory(second.store, { requestedUrl: remotePath });

    // Both peers advance the same history, then tag the same version at
    // different snaps.
    await changeComponent(component, "second-snap");
    await snapComponents(first.store, [component]);
    await tagComponent(first.store, { componentId: "ui/button", version: "1.0.0" });
    await syncComponentHistory(first.store);

    const secondPeerTag = await tagComponent(second.store, {
      componentId: "ui/button",
      version: "1.0.0",
    });

    const result = await syncComponentHistory(second.store);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatch(/is immutable but points at/);
    expect(result.published).toBe(false);
    // The local tag still names the snap it originally did.
    expect(
      await runGitLine(second.store.run, [
        "rev-parse",
        `${componentTagRef("ui/button", "1.0.0")}^{commit}`,
      ])
    ).toBe(parseObjectId(secondPeerTag.snapId).hex);
  });
});

describe("fetch isolation and validation", () => {
  it("records fetched state in private tracking refs", async () => {
    const remotePath = await createRemote();
    const publisher = await createPeer();
    const component = await createComponent(publisher, "ui/button", "button");
    await snapComponents(publisher.store, [component]);
    await syncComponentHistory(publisher.store, { requestedUrl: remotePath });

    const consumer = await createPeer();
    await syncComponentHistory(consumer.store, { requestedUrl: remotePath });

    const tracking = await runGitLine(consumer.store.run, [
      "rev-parse",
      remoteComponentHeadRef("origin", "ui/button"),
    ]);
    expect(tracking).toBe((await readComponentHead(publisher.store, "ui/button"))!.hex);
  });

  it("rejects a fetched head whose history is not linear", async () => {
    const remotePath = await createRemote();
    const publisher = await createPeer();
    const button = await createComponent(publisher, "ui/button", "button");
    const card = await createComponent(publisher, "ui/card", "card", "card");
    const snap = await snapComponents(publisher.store, [button, card]);
    const buttonId = parseObjectId(
      snap.components.find((entry) => entry.componentId === "ui/button")!.snapId
    );
    const cardId = parseObjectId(
      snap.components.find((entry) => entry.componentId === "ui/card")!.snapId
    );

    // Hand-build a merge commit and publish it as a component head.
    const treeHex = await runGitLine(publisher.store.run, ["rev-parse", `${buttonId.hex}^{tree}`]);
    const mergeHex = await runGitLine(publisher.store.run, [
      "commit-tree",
      treeHex,
      "-p",
      buttonId.hex,
      "-p",
      cardId.hex,
      "-m",
      "hand written merge",
    ]);
    await publisher.store.run({
      args: ["update-ref", componentHeadRef("ui/button"), mergeHex],
    });
    await publisher.store.run({
      args: [
        "push",
        remotePath,
        `${componentHeadRef("ui/button")}:${componentHeadRef("ui/button")}`,
      ],
    });

    const consumer = await createPeer();
    await expect(
      syncComponentHistory(consumer.store, { requestedUrl: remotePath })
    ).rejects.toThrow(/must be linear/);
    expect(await readComponentHead(consumer.store, "ui/button")).toBeUndefined();
  });

  it("rejects a fetched tag that is not an annotated tag", async () => {
    const remotePath = await createRemote();
    const publisher = await createPeer();
    const component = await createComponent(publisher, "ui/button", "button");
    const snap = await snapComponents(publisher.store, [component]);
    const snapHex = parseObjectId(snap.components[0]!.snapId).hex;

    const tagRef = componentTagRef("ui/button", "1.0.0");
    await publisher.store.run({ args: ["update-ref", tagRef, snapHex] });
    await publisher.store.run({
      args: [
        "push",
        remotePath,
        `${componentHeadRef("ui/button")}:${componentHeadRef("ui/button")}`,
        `${tagRef}:${tagRef}`,
      ],
    });

    const consumer = await createPeer();
    await expect(
      syncComponentHistory(consumer.store, { requestedUrl: remotePath })
    ).rejects.toThrow(/must be annotated tags/);
    expect(await readComponentHead(consumer.store, "ui/button")).toBeUndefined();
  });
});

describe("publication policy", () => {
  it("requires atomic push for a multi-ref publication", async () => {
    const remotePath = await createRemote();
    const peer = await createPeer();
    const button = await createComponent(peer, "ui/button", "button");
    const card = await createComponent(peer, "ui/card", "card", "card");
    await snapComponents(peer.store, [button, card]);

    const pushes: string[][] = [];
    const observed: ComponentHistoryStore = {
      ...peer.store,
      run: async (input: GitCommandInput) => {
        if (input.args[0] === "push") pushes.push([...input.args]);
        return peer.store.run(input);
      },
    };

    await syncComponentHistory(observed, { requestedUrl: remotePath });

    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toContain("--atomic");
    // No force push, ever.
    expect(pushes[0]!.some((argument) => argument.startsWith("+"))).toBe(false);
    expect(pushes[0]).not.toContain("--force");
  });

  it("does not use atomic push for a single ref", async () => {
    const remotePath = await createRemote();
    const peer = await createPeer();
    const component = await createComponent(peer, "ui/button", "button");
    await snapComponents(peer.store, [component]);

    const pushes: string[][] = [];
    const observed: ComponentHistoryStore = {
      ...peer.store,
      run: async (input: GitCommandInput) => {
        if (input.args[0] === "push") pushes.push([...input.args]);
        return peer.store.run(input);
      },
    };

    await syncComponentHistory(observed, { requestedUrl: remotePath });

    expect(pushes).toHaveLength(1);
    expect(pushes[0]).not.toContain("--atomic");
  });

  it("fails without a non-atomic fallback when atomic push is unsupported", async () => {
    const remotePath = await createRemote();
    const peer = await createPeer();
    const button = await createComponent(peer, "ui/button", "button");
    const card = await createComponent(peer, "ui/card", "card", "card");
    await snapComponents(peer.store, [button, card]);

    let pushAttempts = 0;
    const unsupported: ComponentHistoryStore = {
      ...peer.store,
      run: async (input: GitCommandInput) => {
        if (input.args[0] === "push") {
          pushAttempts += 1;
          throw new GitCommandError({
            args: input.args,
            exitCode: 1,
            signal: null,
            stderr: "fatal: the receiving end does not support --atomic push",
          });
        }
        return peer.store.run(input);
      },
    };

    await expect(syncComponentHistory(unsupported, { requestedUrl: remotePath })).rejects.toThrow(
      /does not support atomic push/
    );
    // Exactly one attempt: no silent retry as separate pushes.
    expect(pushAttempts).toBe(1);
    expect(await remoteRefs(remotePath)).toEqual([]);
  });

  it("does not push when validation fails", async () => {
    const remotePath = await createRemote();
    const peer = await createPeer();
    const component = await createComponent(peer, "ui/button", "button");
    const snap = await snapComponents(peer.store, [component]);

    // A lightweight local tag makes validation fail before any publication.
    await peer.store.run({
      args: [
        "update-ref",
        componentTagRef("ui/button", "1.0.0"),
        parseObjectId(snap.components[0]!.snapId).hex,
      ],
    });

    let pushAttempts = 0;
    const observed: ComponentHistoryStore = {
      ...peer.store,
      run: async (input: GitCommandInput) => {
        if (input.args[0] === "push") pushAttempts += 1;
        return peer.store.run(input);
      },
    };

    await expect(
      syncComponentHistory(observed, { requestedUrl: remotePath })
    ).rejects.toThrow(ComponentHistoryError);
    expect(pushAttempts).toBe(0);
    expect(await remoteRefs(remotePath)).toEqual([]);
  });

  it("fails and asks for a rerun when the remote moved during synchronization", async () => {
    const remotePath = await createRemote();
    const first = await createPeer();
    const component = await createComponent(first, "ui/button", "button");
    await snapComponents(first.store, [component]);
    await syncComponentHistory(first.store, { requestedUrl: remotePath });

    const second = await createPeer();
    await syncComponentHistory(second.store, { requestedUrl: remotePath });

    await changeComponent(component, "local-ahead");
    await snapComponents(first.store, [component]);

    // Another peer publishes a conflicting advance between fetch and push.
    const racing: ComponentHistoryStore = {
      ...first.store,
      run: async (input: GitCommandInput) => {
        if (input.args[0] === "push") {
          const secondComponent = await createComponent(
            second,
            "ui/button",
            "button",
            "remote-ahead"
          );
          await snapComponents(second.store, [secondComponent]);
          await second.store.run({
            args: [
              "push",
              remotePath,
              `${componentHeadRef("ui/button")}:${componentHeadRef("ui/button")}`,
            ],
          });
        }
        return first.store.run(input);
      },
    };

    await expect(syncComponentHistory(racing)).rejects.toThrow(/run "bit-lite sync" again/);
  });
});
