import { describe, expect, it, vi } from "vitest";
import {
  createDependencyProgressAdapter,
  createDependencyProgressReader,
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

describe("dependency progress reader", () => {
  const stage = (name: string) =>
    JSON.stringify({ name: "pnpm:stage", prefix: "/workspace", stage: name });

  it("reassembles records split across chunk boundaries", () => {
    const events: DependencyInstallProgressEvent[] = [];
    const reader = createDependencyProgressReader("/workspace", (event) => events.push(event));
    const line = stage("resolution_started");

    reader.write(line.slice(0, 10));
    expect(events).toEqual([]);
    reader.write(`${line.slice(10)}\n${stage("resolution_done")}\n`);

    expect(events).toEqual([
      { type: "stage", stage: "resolution", status: "started" },
      { type: "stage", stage: "resolution", status: "completed" },
    ]);
  });

  it("flushes an unterminated trailing record on end", () => {
    const events: DependencyInstallProgressEvent[] = [];
    const reader = createDependencyProgressReader("/workspace", (event) => events.push(event));

    reader.write(stage("importing_started"));
    expect(events).toEqual([]);
    reader.end();
    reader.end();

    expect(events).toEqual([{ type: "stage", stage: "importing", status: "started" }]);
  });

  it("ignores blank and non-JSON output", () => {
    const events: DependencyInstallProgressEvent[] = [];
    const reader = createDependencyProgressReader("/workspace", (event) => events.push(event));

    reader.write(`\n  \nProgress: resolved 3\n{"broken":\n${stage("importing_done")}\n`);

    expect(events).toEqual([{ type: "stage", stage: "importing", status: "completed" }]);
  });

  it("stops reporting after a reporter failure instead of aborting the install", () => {
    const onProgress = vi.fn(() => {
      throw new Error("renderer failed");
    });
    const reader = createDependencyProgressReader("/workspace", onProgress);

    expect(() => reader.write(`${stage("resolution_started")}\n`)).not.toThrow();
    reader.write(`${stage("resolution_done")}\n`);

    expect(onProgress).toHaveBeenCalledOnce();
  });
});
