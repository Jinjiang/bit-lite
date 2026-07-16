import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getSelectedEnvKey, parseCliArguments } from "bit-lite-context";
import type { Workspace, WorkspaceEnvGroup } from "bit-lite-context";
import { PreviewProxyServer } from "bit-lite-preview/node";
import { describe, expect, it } from "vitest";
import { isPreviewServiceResult, preparePreviewTasks } from "./preview.js";

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
    const groups: WorkspaceEnvGroup[] = [
      createGroup("valid", validRoot, "./vite.mjs", workspaceRoot, "parent"),
      createGroup("failed", failedRoot, "./missing.mjs", workspaceRoot),
    ];
    const workspace = createWorkspace(workspaceRoot, groups);
    const proxy = new PreviewProxyServer({
      envs: groups.map((group) => ({
        env: group.env.env,
        taskId: getSelectedEnvKey(group.env.env),
        vendor: "vite-preview",
        status: "starting",
        components: group.components,
      })),
    });

    const result = await preparePreviewTasks(
      groups,
      workspace,
      parseCliArguments([]),
      "http://127.0.0.1:4000",
      "127.0.0.1",
      proxy
    );
    const task = result.tasks[0];
    expect(result.tasks).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(task?.options.components).toBe(groups[0]?.components);
    expect(task?.options.runtime).toEqual(task?.prepared.runtime);
    expect(Object.keys(task?.options.runtime ?? {})).toEqual(["server", "prepared", "aliases"]);
    expect(task?.options.runtime?.aliases).toEqual([
      { packageName: "@scope/valid", sourceDir: validRoot },
    ]);
    expect(task?.options.context.env.packageName).toBe("valid");
    expect(task?.options.context.service.source.identity.packageName).toBe("parent");
    expect(proxy.manifest().envs).toMatchObject([
      { env: selectedEnv("failed"), status: "failed", error: expect.stringContaining("could not resolve") },
      { env: selectedEnv("valid"), status: "starting" },
    ]);

    const tempDir = task?.prepared.tempDir;
    await Promise.all(result.tasks.map((preparedTask) => preparedTask.prepared.cleanup()));
    await expect(access(tempDir ?? "")).rejects.toThrow();
  });

  it("accepts additional JSON data without reserving historical field names", () => {
    expect(isPreviewServiceResult({
      mode: "serve",
      vendorSpecific: true,
    })).toBe(true);
    expect(isPreviewServiceResult({
      envName: "valid",
      mode: "serve",
    })).toBe(true);
    expect(isPreviewServiceResult({ mode: "serve", env: selectedEnv("valid") })).toBe(true);
    expect(isPreviewServiceResult({ mode: "serve", server: { port: 6000 } })).toBe(true);
    expect(isPreviewServiceResult({ mode: "invalid" })).toBe(false);
  });
});

function createGroup(
  envPackageName: string,
  rootDir: string,
  configFile: string,
  workspaceRoot: string,
  serviceSourcePackageName = envPackageName
): WorkspaceEnvGroup {
  const serviceConfig = {
    vendor: "data:text/javascript,export const meta = {}",
    config: { configFile },
  };
  const envIdentity = selectedEnv(envPackageName);
  const selectedSource = {
    identity: { packageName: envPackageName, version: "0.0.0" },
    rootDir: workspaceRoot,
    entryFile: path.join(workspaceRoot, "index.json"),
  };
  const serviceSource = {
    identity: { packageName: serviceSourcePackageName, version: "0.0.0" },
    rootDir: workspaceRoot,
    entryFile: path.join(workspaceRoot, "index.json"),
  };
  const service = {
    name: "preview" as const,
    definition: serviceConfig,
    source: serviceSource,
  };
  const env = {
    env: envIdentity,
    package: selectedSource,
    config: undefined,
    services: { preview: service },
    inheritance: serviceSourcePackageName === envPackageName
      ? [selectedSource.identity]
      : [serviceSource.identity, selectedSource.identity],
  };
  const component = {
    id: `scope/${envPackageName}`,
    path: `components/${envPackageName}`,
    rootDir,
    packageName: `@scope/${envPackageName}`,
    kind: "component" as const,
    env: { packageName: envPackageName, version: "workspace:*" },
    mainFile: path.join(rootDir, "index.ts"),
    mainFileRelative: "index.ts",
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    internalDependencyPackageNames: [],
    internalEnvPackageName: undefined,
  };
  return {
    env,
    components: [component],
  };
}

function createWorkspace(rootDir: string, groups: WorkspaceEnvGroup[]): Workspace {
  const components = groups.flatMap((group) => group.components);
  return {
    rootDir,
    configPath: path.join(rootDir, "bit-lite.json"),
    config: {
      components: components.map((component) => ({
        path: component.path,
        id: component.id,
        packageName: component.packageName,
        env: component.env,
      })),
    },
    components,
  };
}

function selectedEnv(packageName: string) {
  return { packageName, requestedVersion: "workspace:*", installedVersion: "0.0.0" };
}
