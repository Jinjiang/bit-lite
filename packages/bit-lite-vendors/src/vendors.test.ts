import { describe, expect, it } from "vitest";
import { barYVendor, barZVendor, bazXVendor, demoVendors, fooXVendor, fooZVendor } from "./index.js";

describe("demo vendors", () => {
  it("exports the five configured demo vendors", () => {
    expect(demoVendors.foo.x).toBe(fooXVendor);
    expect(demoVendors.foo.z).toBe(fooZVendor);
    expect(demoVendors.bar.y).toBe(barYVendor);
    expect(demoVendors.bar.z).toBe(barZVendor);
    expect(demoVendors.baz.x).toBe(bazXVendor);
  });

  it("emits simple event payloads and resolves a result", async () => {
    const events: string[] = [];
    const task = fooXVendor.run({
      components: [{ id: "components/lib/math", rootDir: "/workspace/components/lib/math" }],
      config: {},
      args: ["--demo"],
    });

    task.listen((type) => events.push(type));
    task.call("stdin", { chunk: "hello" });

    const result = await task.result;

    expect(result.status).toBe("success");
    expect(result.toJSON()).toMatchObject({
      service: "foo",
      vendor: "x",
      componentIds: ["components/lib/math"],
    });
    expect(events).toContain("log");
    expect(events).toContain("status");
    expect(events).toContain("progress");
    expect(events).toContain("result");
  });

  it("supports stop calls", async () => {
    const task = barZVendor.run({
      components: [{ id: "components/vue/card", rootDir: "/workspace/components/vue/card" }],
      config: { delay: 10 },
      args: [],
    });

    task.call("stop", { reason: "test" });

    await expect(task.result).resolves.toMatchObject({
      status: "stopped",
    });
  });
});
