import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../cli.js";

describe("test command", () => {
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs configured test vendors once", async () => {
    const workspaceRoot = await createWorkspace();
    const code = await runCli(["test", "--workspace", workspaceRoot]);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(logs).toEqual([
      "Test results:",
      "- Jest (jest): 2/2 passed",
      "  - components/jest/math: 2/2 passed (2 files)",
      "- Vitest (vitest): 2/2 passed",
      "  - components/vitest/math: 2/2 passed (2 files)",
    ]);
  });

  it("filters selected components before env grouping", async () => {
    const workspaceRoot = await createWorkspace();
    const code = await runCli(["test", "--workspace", workspaceRoot, "--filter", "components/vitest/*"]);

    expect(code).toBe(0);
    expect(logs).toEqual([
      "Test results:",
      "- Vitest (vitest): 2/2 passed",
      "  - components/vitest/math: 2/2 passed (2 files)",
    ]);
  });

  it("runs non-interactive watch with worker tasks", async () => {
    const workspaceRoot = await createWorkspace();
    const code = await runCli(["test", "--workspace", workspaceRoot, "--watch"]);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
  });
});

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-cli-"));
  await writeFile(
    path.join(workspaceRoot, "bit-lite.json"),
    JSON.stringify(
      {
        envs: {
          jest: {
            services: {
              test: {
                vendor: "demo-vendors/testers/jest",
                config: {
                  configFile: "demo-config/testers/jest/react",
                },
              },
            },
          },
          vitest: {
            services: {
              test: {
                vendor: "demo-vendors/testers/vitest",
                config: {
                  configFile: "demo-config/testers/vitest/node",
                },
              },
            },
          },
        },
        components: {
          "components/jest/**": "jest",
          "components/vitest/**": "vitest",
        },
      },
      null,
      2
    )
  );

  await writeMathComponent(workspaceRoot, "components/jest/math");
  await writeMathComponent(workspaceRoot, "components/vitest/math");

  return workspaceRoot;
}

async function writeMathComponent(workspaceRoot: string, componentDir: string) {
  const absoluteDir = path.join(workspaceRoot, componentDir);
  await mkdir(absoluteDir, { recursive: true });
  await writeFile(path.join(absoluteDir, "index.ts"), "export const add = (left: number, right: number) => left + right;\n");
  await writeFile(
    path.join(absoluteDir, "index.test.ts"),
    [
      'import assert from "node:assert/strict";',
      'import { add } from "./index.js";',
      "",
      'describe("add", () => {',
      '  it("adds two numbers", () => {',
      "    assert.equal(add(2, 3), 5);",
      "  });",
      "});",
      "",
    ].join("\n")
  );
  await writeFile(
    path.join(absoluteDir, "arithmetic.spec.ts"),
    [
      'import assert from "node:assert/strict";',
      'import { add } from "./index.js";',
      "",
      'describe("arithmetic", () => {',
      '  it("adds negative numbers", () => {',
      "    assert.equal(add(-2, -3), -5);",
      "  });",
      "});",
      "",
    ].join("\n")
  );
}
