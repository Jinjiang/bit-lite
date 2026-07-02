import { describe, expect, it } from "vitest";
import { barXVendor, barYVendor, barZVendor, bazXVendor, fooXVendor } from "./index.js";

describe("demo vendors", () => {
  it("exports the five configured demo vendors", () => {
    expect(fooXVendor.name).toBe("x");
    expect(barXVendor.name).toBe("x");
    expect(barYVendor.name).toBe("y");
    expect(barZVendor.name).toBe("z");
    expect(bazXVendor.name).toBe("x");
  });

  it("emits simple event payloads and resolves a result", async () => {
    const events: string[] = [];
    const task = fooXVendor.run(
      {
        components: [{ id: "components/lib/math", rootDir: "/workspace/components/lib/math" }],
        config: {},
        args: ["--demo"],
      },
      undefined,
      (type) => events.push(type)
    );

    task.call("stdin", { chunk: "hello" });

    const result = await task.result;

    expect(result.status).toBe("success");
    expect(result.toJSON()).toMatchObject({
      service: "foo",
      vendor: "x",
      compList: ["components/lib/math"],
    });
    expect(events).toContain("progress");
    expect(events).toContain("result");
    expect(events).not.toContain("log");
    expect(events).not.toContain("status");
  });

  it("supports stop calls", async () => {
    const task = barZVendor.run(
      {
        components: [{ id: "components/vue/card", rootDir: "/workspace/components/vue/card" }],
        config: { delay: 10 },
        args: [],
      },
      undefined,
      () => {}
    );

    task.call("stop", { reason: "test" });

    await expect(task.result).resolves.toMatchObject({
      status: "stopped",
    });
  });
});
