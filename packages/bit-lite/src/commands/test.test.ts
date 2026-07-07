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
      "- Test X (node): 2/2 passed",
      "- Test Y (react): 3/3 passed",
      "- Test X (vue): 2/2 passed",
    ]);
  });

  it("filters selected components before env grouping", async () => {
    const workspaceRoot = await createWorkspace();
    const code = await runCli(["test", "--workspace", workspaceRoot, "--filter", "components/ui/*"]);

    expect(code).toBe(0);
    expect(logs).toEqual([
      "Test results:",
      "- Test Y (react): 3/3 passed",
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
          node: {
            services: {
              test: {
                vendor: "demo-vendors/test-x",
                config: {
                  shard: "unit",
                  retries: 1,
                  coverage: true,
                },
              },
            },
          },
          react: {
            extends: "node",
            services: {
              test: {
                vendor: "demo-vendors/test-y",
                config: {
                  shard: "browser",
                  retries: 2,
                  coverage: false,
                },
              },
            },
          },
          vue: {
            extends: "node",
            services: {
              test: {
                vendor: "demo-vendors/test-x",
                config: {
                  shard: "sfc",
                  retries: 1,
                  coverage: true,
                },
              },
            },
          },
        },
        components: {
          "components/lib/**": "node",
          "components/ui/**": "react",
          "components/vue/**": "vue",
        },
      },
      null,
      2
    )
  );

  await writeComponent(workspaceRoot, "components/lib/math", "export const add = () => 1;\n");
  await writeComponent(workspaceRoot, "components/ui/button", "export const Button = {};\n");
  await writeComponent(workspaceRoot, "components/vue/card", "<template><div>Card</div></template>\n");

  return workspaceRoot;
}

async function writeComponent(workspaceRoot: string, componentDir: string, contents: string) {
  const absoluteDir = path.join(workspaceRoot, componentDir);
  await mkdir(absoluteDir, { recursive: true });
  const fileName = componentDir.endsWith("/card") ? "index.vue" : "index.ts";
  await writeFile(path.join(absoluteDir, fileName), contents);
}
