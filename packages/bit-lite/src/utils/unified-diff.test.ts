import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { formatPatch, type PatchComponent, type PatchFile } from "./unified-diff.js";

/**
 * These assert the serialized bytes rather than a rendered impression of them.
 * The patch is the command's output contract: what tools read is the exact
 * text, so a test that only checked "contains a minus sign" would not be
 * testing the thing that matters.
 */

function present(content: string, mode = "100644", blobHex = "aaaaaaa"): PatchFile["before"] {
  return { kind: "present", mode, blobHex, content: Buffer.from(content, "utf8") };
}

const absent = { kind: "absent" } as const;

function patch(files: readonly PatchFile[], componentId = "ui/button"): string {
  const component: PatchComponent = {
    componentId,
    fromLabel: "0.0.0-ga17d5e0",
    toLabel: "working",
    files,
  };
  return formatPatch([component]);
}

describe("file headers", () => {
  it("qualifies paths with the component and separates them from the file path", () => {
    const output = patch([
      { path: "src/button.tsx", before: present("a\n", "100644", "1111111"), after: present("b\n", "100644", "2222222") },
    ]);

    expect(output).toContain("diff --git a/ui/button::src/button.tsx b/ui/button::src/button.tsx");
    expect(output).toContain("--- a/ui/button::src/button.tsx");
    expect(output).toContain("+++ b/ui/button::src/button.tsx");
  });

  it("carries the real blob ids on the index line", () => {
    const output = patch([
      { path: "a.ts", before: present("a\n", "100644", "1111111"), after: present("b\n", "100644", "2222222") },
    ]);

    expect(output).toContain("index 1111111..2222222 100644");
  });

  it("records an added file against /dev/null with its mode", () => {
    const output = patch([
      { path: "new.ts", before: absent, after: present("added\n", "100755", "3333333") },
    ]);

    expect(output).toContain("new file mode 100755");
    expect(output).toContain("--- /dev/null");
    expect(output).toContain("+++ b/ui/button::new.ts");
    expect(output).toContain("@@ -0,0 +1,1 @@");
    expect(output).toContain("+added");
  });

  it("records a deleted file against /dev/null with its mode", () => {
    const output = patch([
      { path: "gone.ts", before: present("gone\n", "100644", "4444444"), after: absent },
    ]);

    expect(output).toContain("deleted file mode 100644");
    expect(output).toContain("--- a/ui/button::gone.ts");
    expect(output).toContain("+++ /dev/null");
    expect(output).toContain("@@ -1,1 +0,0 @@");
    expect(output).toContain("-gone");
  });

  it("records a mode-only change with no hunk", () => {
    const output = patch([
      {
        path: "run.sh",
        before: present("same\n", "100644", "5555555"),
        after: present("same\n", "100755", "5555555"),
      },
    ]);

    expect(output).toContain("old mode 100644");
    expect(output).toContain("new mode 100755");
    expect(output).not.toContain("@@");
    expect(output).not.toContain("index ");
  });

  it("reports differing binary content instead of rendering lines", () => {
    const output = formatPatch([
      {
        componentId: "ui/button",
        fromLabel: "0.0.1",
        toLabel: "working",
        files: [
          {
            path: "icon.png",
            before: { kind: "present", mode: "100644", blobHex: "6666666", content: Buffer.from([0x89, 0x50, 0x00, 0x01]) },
            after: { kind: "present", mode: "100644", blobHex: "7777777", content: Buffer.from([0x89, 0x50, 0x00, 0x02]) },
          },
        ],
      },
    ]);

    expect(output).toContain("Binary files a/ui/button::icon.png and b/ui/button::icon.png differ");
    expect(output).not.toContain("@@");
  });
});

describe("hunks", () => {
  it("emits a modified line with surrounding context", () => {
    const before = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
    const after = "1\n2\n3\n4\nX\n6\n7\n8\n9\n";

    const output = patch([
      { path: "a.ts", before: present(before, "100644", "1111111"), after: present(after, "100644", "2222222") },
    ]);

    expect(output).toContain("@@ -2,7 +2,7 @@");
    expect(output).toContain(" 4\n-5\n+X\n 6\n");
  });

  it("splits distant changes into separate hunks", () => {
    const before = Array.from({ length: 30 }, (_, index) => String(index)).join("\n") + "\n";
    const after = before.replace("\n1\n", "\nONE\n").replace("\n25\n", "\nTWENTYFIVE\n");

    const output = patch([
      { path: "a.ts", before: present(before, "100644", "1111111"), after: present(after, "100644", "2222222") },
    ]);

    expect(output.match(/^@@ /gm)).toHaveLength(2);
  });

  it("merges changes closer together than twice the context into one hunk", () => {
    const before = Array.from({ length: 12 }, (_, index) => String(index)).join("\n") + "\n";
    const after = before.replace("\n3\n", "\nTHREE\n").replace("\n7\n", "\nSEVEN\n");

    const output = patch([
      { path: "a.ts", before: present(before, "100644", "1111111"), after: present(after, "100644", "2222222") },
    ]);

    expect(output.match(/^@@ /gm)).toHaveLength(1);
  });
});

describe("banner", () => {
  it("names the component and both states once per component", () => {
    const output = patch([
      { path: "a.ts", before: present("a\n", "100644", "1111111"), after: present("b\n", "100644", "2222222") },
    ]);

    expect(output.startsWith("# ui/button  0.0.0-ga17d5e0 -> working\n")).toBe(true);
    expect(output.match(/^# ui\/button/gm)).toHaveLength(1);
  });

  it("begins every banner line with a character unified diff gives no meaning to", () => {
    const output = patch([
      { path: "a.ts", before: present("a\n", "100644", "1111111"), after: present("b\n", "100644", "2222222") },
    ]);

    const meaningful = new Set(["-", "+", "@", "\\", " "]);
    for (const line of output.split("\n")) {
      if (!line.startsWith("#")) continue;
      expect(meaningful.has(line[0]!)).toBe(false);
    }
  });

  it("keeps two components owning a file of the same name on distinct paths", () => {
    const file: PatchFile = {
      path: "src/index.ts",
      before: present("a\n", "100644", "1111111"),
      after: present("b\n", "100644", "2222222"),
    };
    const output = formatPatch([
      { componentId: "ui/button", fromLabel: "1.0.0", toLabel: "working", files: [file] },
      { componentId: "ui/theme", fromLabel: "2.0.0", toLabel: "working", files: [file] },
    ]);

    expect(output).toContain("diff --git a/ui/button::src/index.ts b/ui/button::src/index.ts");
    expect(output).toContain("diff --git a/ui/theme::src/index.ts b/ui/theme::src/index.ts");
    expect(output.match(/^diff --git /gm)).toHaveLength(2);
  });

  it("omits a component whose files all turn out identical", () => {
    const output = formatPatch([
      {
        componentId: "ui/button",
        fromLabel: "1.0.0",
        toLabel: "working",
        files: [{ path: "a.ts", before: absent, after: absent }],
      },
    ]);

    expect(output).toBe("");
  });
});

describe("empty patch", () => {
  it("produces nothing when no component differs", () => {
    expect(formatPatch([])).toBe("");
  });
});

/**
 * This serializer is a second implementation of something Git already does, and
 * this is the only thing tying it to Git's own — the same relationship the tree
 * serializer has with `write-tree`. Treat a failure here as a bug in the
 * serializer, never as a reason to loosen the comparison.
 *
 * Only the hunks are compared. The headers deliberately differ: ours carry
 * component-qualified paths, which is the whole point of addressing them in the
 * workspace's vocabulary.
 */
describe("agreement with git", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
    );
  });

  async function gitHunks(before: string, after: string): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "bit-lite-unified-diff-"));
    temporaryRoots.push(root);
    const beforePath = path.join(root, "a");
    const afterPath = path.join(root, "b");
    await writeFile(beforePath, before);
    await writeFile(afterPath, after);

    // `git diff --no-index` exits 1 when the files differ, which is not a failure.
    const result = await promisify(execFile)(
      "git",
      ["diff", "--no-index", "--", beforePath, afterPath],
      { encoding: "utf8" }
    ).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? "" }));

    return hunksOf(result.stdout);
  }

  function hunksOf(patchText: string): string {
    const lines = patchText.split("\n");
    const start = lines.findIndex((line) => line.startsWith("@@"));
    if (start === -1) return "";
    return lines.slice(start).join("\n").replace(/\n+$/, "");
  }

  const cases: { name: string; before: string; after: string }[] = [
    {
      name: "one changed line mid-file",
      before: lines(1, 20),
      after: lines(1, 20).replace("\n10\n", "\nTEN\n"),
    },
    {
      name: "two changes far enough apart to split",
      before: lines(1, 30),
      after: lines(1, 30).replace("\n2\n", "\nTWO\n").replace("\n25\n", "\nTWENTYFIVE\n"),
    },
    {
      name: "two changes close enough to merge",
      before: lines(1, 12),
      after: lines(1, 12).replace("\n4\n", "\nFOUR\n").replace("\n8\n", "\nEIGHT\n"),
    },
    { name: "wholly replaced content", before: lines(1, 5), after: "x\ny\n" },
    { name: "a deleted line", before: lines(1, 8), after: lines(1, 8).replace("3\n", "") },
    { name: "a change at the first line", before: lines(1, 10), after: lines(1, 10).replace("1\n", "ONE\n") },
    {
      name: "a change at the last line",
      before: lines(1, 10),
      after: lines(1, 10).replace("\n10\n", "\nTEN\n"),
    },
  ];

  for (const testCase of cases) {
    it(`produces the same hunks as git for ${testCase.name}`, async () => {
      const ours = hunksOf(
        patch([
          {
            path: "f.txt",
            before: present(testCase.before, "100644", "1111111"),
            after: present(testCase.after, "100644", "2222222"),
          },
        ])
      );

      expect(ours).toBe(await gitHunks(testCase.before, testCase.after));
      expect(ours).not.toBe("");
    });
  }
});

function lines(from: number, to: number): string {
  return (
    Array.from({ length: to - from + 1 }, (_, index) => String(from + index)).join("\n") + "\n"
  );
}
