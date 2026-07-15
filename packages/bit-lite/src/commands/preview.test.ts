import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseCliArguments } from "bit-lite-context";
import { PreviewProxyServer } from "bit-lite-preview/node";
import { describe, expect, it } from "vitest";
import { preparePreviewTasks, type PreviewTaskSpec } from "./preview.js";

describe("preview command preparation isolation", () => {
  it("starts valid env inputs while retaining failed env state and command-owned cleanup", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-preview-command-"));
    const validRoot = path.join(workspaceRoot, "components", "valid");
    const failedRoot = path.join(workspaceRoot, "components", "failed");
    await Promise.all([mkdir(validRoot, { recursive: true }), mkdir(failedRoot, { recursive: true })]);
    await Promise.all([
      writeFile(path.join(workspaceRoot, "package.json"), '{"type":"module"}\n', "utf8"),
      writeFile(path.join(validRoot, "valid.docs.md"), "# Valid docs\n", "utf8"),
      writeFile(path.join(failedRoot, "failed.docs.md"), "# Failed docs\n", "utf8"),
      writeFile(path.join(workspaceRoot, "vite.mjs"), "export default {};\n", "utf8"),
    ]);
    const tasks: PreviewTaskSpec[] = [
      createTask("valid", validRoot, "./vite.mjs", workspaceRoot),
      createTask("failed", failedRoot, "./missing.mjs", workspaceRoot),
    ];
    const proxy = new PreviewProxyServer({
      envs: tasks.map((task) => ({
        envName: task.envName,
        taskId: task.envName,
        vendor: "vite-preview",
        status: "starting",
        components: task.components,
      })),
      skipped: [],
    });

    const result = await preparePreviewTasks(tasks, workspaceRoot, "http://127.0.0.1:4000", "127.0.0.1", proxy);
    expect(result.taskOptions).toHaveLength(1);
    expect(result.preparedEnvs).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.taskOptions[0]?.components).toEqual([]);
    expect(result.taskOptions[0]?.runtime).toEqual(result.preparedEnvs[0]?.runtime);
    expect(Object.keys(result.taskOptions[0]?.runtime ?? {})).toEqual(["server", "prepared", "workspace"]);
    expect(result.taskOptions[0]?.runtime?.workspace).toEqual({
      rootDir: workspaceRoot,
      components: [{ packageName: "@scope/valid", sourceDir: validRoot }],
    });
    expect(result.taskOptions[0]?.workspaceRoot).toBe(workspaceRoot);
    expect(result.taskOptions[0]?.service.declaredBy).toBe("valid");
    expect(proxy.manifest().envs).toMatchObject([
      { envName: "failed", status: "failed", error: expect.stringContaining("could not resolve") },
      { envName: "valid", status: "starting" },
    ]);

    const tempDir = result.preparedEnvs[0]?.tempDir;
    await Promise.all(result.preparedEnvs.map((prepared) => prepared.cleanup()));
    await expect(access(tempDir ?? "")).rejects.toThrow();
  });
});

function createTask(
  envName: string,
  rootDir: string,
  configFile: string,
  workspaceRoot: string
): PreviewTaskSpec {
  const serviceConfig = { vendor: "vite-preview", config: { configFile } };
  const service = {
    definition: serviceConfig,
    declaredBy: envName,
    packageRoot: workspaceRoot,
    entryUrl: new URL(`file://${path.join(workspaceRoot, "index.json")}`).href,
    entryDirectory: workspaceRoot,
  };
  return {
    envName,
    components: [{ id: `scope/${envName}`, rootDir, packageName: `@scope/${envName}` }],
    service,
    taskOptions: {
      envName,
      components: [{ id: `scope/${envName}`, rootDir, packageName: `@scope/${envName}` }],
      args: parseCliArguments([]),
      workspaceRoot,
      service,
    },
  };
}
