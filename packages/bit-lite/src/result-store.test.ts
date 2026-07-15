import { describe, expect, it } from "vitest";
import { createResultStore } from "./result-store.js";

describe("result store", () => {
  it("stores generic result entries and returns their stored text", () => {
    const store = createResultStore<{ ok: boolean; run: number }>();

    const firstEntry = store.add({
      observedAt: "2026-07-09T00:00:00.000Z",
      taskId: "react:lint",
      env: selectedEnv("react"),
      vendor: "lint",
      json: { ok: true, run: 1 },
      text: "lint passed",
    });
    store.add({
      observedAt: "2026-07-09T00:00:01.000Z",
      taskId: "vue:test",
      env: selectedEnv("vue"),
      vendor: "test",
      json: { ok: false, run: 2 },
      text: "test failed",
    });

    expect(firstEntry).toEqual({
      observedAt: "2026-07-09T00:00:00.000Z",
      taskId: "react:lint",
      env: selectedEnv("react"),
      vendor: "lint",
      json: { ok: true, run: 1 },
      text: "lint passed",
    });
    expect(store.entries("lint")).toEqual([firstEntry]);
    expect(store.json("test")).toEqual([{ ok: false, run: 2 }]);
    expect(store.text()).toBe(["lint passed", "test failed"].join("\n---\n"));
  });
});

function selectedEnv(packageName: string) {
  return { packageName, requestedVersion: "1.0.0", installedVersion: "1.0.0" };
}
