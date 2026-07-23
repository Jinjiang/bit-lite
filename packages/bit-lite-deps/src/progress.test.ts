import { describe, expect, it, vi } from "vitest";
import {
  createDependencyProgressAdapter,
  observeDependencyInstallProgress,
  type DependencyInstallProgressEvent,
} from "./progress.js";

describe("dependency progress adapter", () => {
  it("maps stages and unique downloaded progress inside the install root", () => {
    const events: DependencyInstallProgressEvent[] = [];
    const adapt = createDependencyProgressAdapter("/workspace/.bit-lite/deps", (event) => {
      events.push(event);
    });

    adapt({ name: "pnpm:stage", prefix: "/workspace/.bit-lite/deps", stage: "resolution_started" });
    adapt({
      name: "pnpm:progress",
      requester: "/workspace/.bit-lite/deps",
      status: "resolved",
      packageId: "pkg-a@1",
    });
    adapt({
      name: "pnpm:progress",
      requester: "/workspace/.bit-lite/deps",
      status: "resolved",
      packageId: "pkg-a@1",
    });
    adapt({
      name: "pnpm:progress",
      requester: "/workspace/.bit-lite/deps",
      status: "fetched",
      packageId: "pkg-a@1",
    });
    adapt({
      name: "pnpm:progress",
      requester: "/workspace/.bit-lite/deps",
      status: "imported",
      to: "/workspace/.bit-lite/deps/node_modules/.pnpm/pkg-a",
    });
    adapt({ name: "pnpm:stage", prefix: "/workspace/.bit-lite/deps", stage: "importing_done" });

    expect(events).toEqual([
      { type: "stage", stage: "resolution", status: "started" },
      {
        type: "progress",
        counts: { resolved: 1, reused: 0, downloaded: 0, added: 0 },
      },
      {
        type: "progress",
        counts: { resolved: 1, reused: 0, downloaded: 1, added: 0 },
      },
      {
        type: "progress",
        counts: { resolved: 1, reused: 0, downloaded: 1, added: 1 },
      },
      { type: "stage", stage: "importing", status: "completed" },
    ]);
  });

  it("reports cached reuse with zero downloads and filters other roots", () => {
    const events: DependencyInstallProgressEvent[] = [];
    const adapt = createDependencyProgressAdapter("/workspace/.bit-lite/deps", (event) => {
      events.push(event);
    });

    adapt({
      name: "pnpm:progress",
      requester: "/other/.bit-lite/deps",
      status: "fetched",
      packageId: "outside@1",
    });
    adapt({
      name: "pnpm:progress",
      requester: "/workspace/.bit-lite/deps/components/a",
      status: "found_in_store",
      packageId: "cached@1",
    });

    expect(events).toEqual([
      {
        type: "progress",
        counts: { resolved: 0, reused: 1, downloaded: 0, added: 0 },
      },
    ]);
  });

  it("maps statistics, warnings, and retries while ignoring unknown records", () => {
    const events: DependencyInstallProgressEvent[] = [];
    const adapt = createDependencyProgressAdapter("/workspace/.bit-lite/deps", (event) => {
      events.push(event);
    });

    adapt({ name: "pnpm:stats", prefix: "/workspace/.bit-lite/deps", added: 8 });
    adapt({ name: "pnpm", level: "warn", message: "registry warning" });
    adapt({
      name: "pnpm:request-retry",
      attempt: 1,
      maxRetries: 2,
      method: "GET",
      url: "https://registry.example/pkg",
      timeout: 1_000,
      error: { code: "ECONNRESET" },
    });
    adapt({ name: "pnpm:future-event", value: true });

    expect(events).toEqual([
      { type: "stats", added: 8, removed: 0 },
      { type: "warning", message: "registry warning" },
      {
        type: "retry",
        attempt: 1,
        maxRetries: 2,
        method: "GET",
        url: "https://registry.example/pkg",
        timeout: 1_000,
        errorCode: "ECONNRESET",
      },
    ]);
  });

  it("deduplicates unsupported-platform install checks while preserving other warnings", () => {
    const events: DependencyInstallProgressEvent[] = [];
    const adapt = createDependencyProgressAdapter("/workspace/.bit-lite/deps", (event) => {
      events.push(event);
    });
    const unsupportedPlatform = (packageId: string) => ({
      name: "pnpm:install-check",
      level: "warn",
      prefix: "/workspace/.bit-lite/deps",
      message:
        `Unsupported platform for ${packageId}: wanted ` +
        `{"cpu":["x64"],"os":["linux"],"libc":["glibc"]} ` +
        `(current: {"os":"linux","cpu":"arm64","libc":"glibc"})`,
    });

    adapt(unsupportedPlatform("@swc/core-linux-x64-gnu@1.15.46"));
    adapt(unsupportedPlatform("@swc/core-linux-x64-gnu@1.15.46"));
    adapt(unsupportedPlatform("fsevents@2.3.3"));
    adapt({
      name: "pnpm:install-check",
      level: "warn",
      prefix: "/workspace/.bit-lite/deps",
      message: "Unsupported engine for package-a",
    });

    expect(events).toEqual([
      { type: "optional-skip", reason: "unsupported-platform", count: 1 },
      { type: "optional-skip", reason: "unsupported-platform", count: 2 },
      { type: "warning", message: "Unsupported engine for package-a" },
    ]);
  });
});

describe("dependency progress observation", () => {
  it("removes its listener when disposed", () => {
    const stream = new FakeProgressStream();
    const dispose = observeDependencyInstallProgress("/workspace", vi.fn(), stream);

    expect(stream.listenerCount).toBe(1);
    dispose();
    dispose();

    expect(stream.listenerCount).toBe(0);
    expect(stream.removeCalls).toBe(1);
  });

  it("removes its listener and suppresses callback failures", () => {
    const stream = new FakeProgressStream();
    const callback = vi.fn(() => {
      throw new Error("renderer failed");
    });
    observeDependencyInstallProgress("/workspace", callback, stream);

    expect(() => stream.emit({
      name: "pnpm:stage",
      prefix: "/workspace",
      stage: "resolution_started",
    })).not.toThrow();
    stream.emit({
      name: "pnpm:stage",
      prefix: "/workspace",
      stage: "resolution_done",
    });

    expect(callback).toHaveBeenCalledOnce();
    expect(stream.listenerCount).toBe(0);
  });
});

class FakeProgressStream {
  #listeners = new Set<(record: unknown) => void>();
  removeCalls = 0;

  get listenerCount() {
    return this.#listeners.size;
  }

  on(_event: "data", listener: (record: unknown) => void) {
    this.#listeners.add(listener);
  }

  removeListener(_event: "data", listener: (record: unknown) => void) {
    this.removeCalls += 1;
    this.#listeners.delete(listener);
  }

  emit(record: unknown) {
    for (const listener of [...this.#listeners]) listener(record);
  }
}
