import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  createStore: vi.fn(),
  mutateModules: vi.fn(),
  restartWorkers: vi.fn(),
  finishWorkers: vi.fn(),
  observeProgress: vi.fn(),
  disposeProgress: vi.fn(),
}));

vi.mock("@pnpm/config", () => ({ getConfig: mocks.getConfig }));
vi.mock("@pnpm/core", () => ({ mutateModules: mocks.mutateModules }));
vi.mock("@pnpm/store-connection-manager", () => ({
  createOrConnectStoreController: mocks.createStore,
}));
vi.mock("@pnpm/worker", () => ({
  restartWorkerPool: mocks.restartWorkers,
  finishWorkers: mocks.finishWorkers,
}));
vi.mock("./progress.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./progress.js")>();
  return { ...original, observeDependencyInstallProgress: mocks.observeProgress };
});

import {
  installDependencyProjects,
  type DependencyInstallProgressEvent,
} from "./index.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConfig.mockResolvedValue({
    config: { rawConfig: {}, registries: { default: "https://registry.example/" } },
  });
  mocks.createStore.mockResolvedValue({ ctrl: {}, dir: "/store" });
  mocks.mutateModules.mockResolvedValue([]);
  mocks.restartWorkers.mockResolvedValue(undefined);
  mocks.finishWorkers.mockResolvedValue(undefined);
  mocks.observeProgress.mockReturnValue(mocks.disposeProgress);
});

describe("installDependencyProjects progress lifecycle", () => {
  it("disposes progress after a successful install and worker cleanup", async () => {
    const onProgress = vi.fn();

    await installDependencyProjects(options(onProgress));

    expect(mocks.observeProgress).toHaveBeenCalledWith("/workspace/.bit-lite/deps", onProgress);
    expect(mocks.finishWorkers).toHaveBeenCalledOnce();
    expect(mocks.disposeProgress).toHaveBeenCalledOnce();
    expect(mocks.finishWorkers.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.disposeProgress.mock.invocationCallOrder[0]!);
  });

  it("attempts worker cleanup and disposes progress after setup fails", async () => {
    const setupError = new Error("config failed");
    mocks.getConfig.mockRejectedValue(setupError);

    await expect(installDependencyProjects(options(vi.fn()))).rejects.toBe(setupError);

    expect(mocks.restartWorkers).not.toHaveBeenCalled();
    expect(mocks.finishWorkers).toHaveBeenCalledOnce();
    expect(mocks.disposeProgress).toHaveBeenCalledOnce();
  });

  it("preserves mutation and worker cleanup failures together", async () => {
    const mutationError = new Error("mutation failed");
    const cleanupError = new Error("cleanup failed");
    mocks.mutateModules.mockRejectedValue(mutationError);
    mocks.finishWorkers.mockRejectedValue(cleanupError);

    const failure = await installDependencyProjects(options(vi.fn())).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([mutationError, cleanupError]);
    expect(mocks.disposeProgress).toHaveBeenCalledOnce();
  });

  it("does not install a listener when progress is not requested", async () => {
    await installDependencyProjects(options());

    expect(mocks.observeProgress).not.toHaveBeenCalled();
    expect(mocks.disposeProgress).not.toHaveBeenCalled();
  });
});

function options(onProgress?: (event: DependencyInstallProgressEvent) => void) {
  return {
    rootDir: "/workspace/.bit-lite/deps",
    projects: [
      {
        rootDir: "/workspace/.bit-lite/deps",
        manifest: { name: "fixture", version: "1.0.0" },
      },
    ],
    ...(onProgress === undefined ? {} : { onProgress }),
  };
}
