import { parseCliArguments } from "bit-lite-context";
import { describe, expect, it } from "vitest";
import { barXVendor, barYVendor, barZVendor, bazXVendor, fooXVendor } from "./index.js";
import startFooXVendor from "./foo-x.js";
import startBarZVendor from "./bar-z.js";
import type {
  JsonValue,
  VendorData,
  VendorHandle,
  VendorMessage,
  VendorResultMessage,
  VendorRuntime,
} from "./index.js";

describe("demo vendors", () => {
  it("exports the five configured demo vendors", () => {
    expect(fooXVendor.id).toBe("foo-x");
    expect(barXVendor.id).toBe("bar-x");
    expect(barYVendor.id).toBe("bar-y");
    expect(barZVendor.id).toBe("bar-z");
    expect(bazXVendor.id).toBe("baz-x");
    expect(fooXVendor.moduleUrl).toBeTruthy();
  });

  it("posts lifecycle messages and result data", async () => {
    const harness = createHarness({
      components: [{ id: "components/lib/math", rootDir: "/workspace/components/lib/math" }],
      config: {},
      args: parseCliArguments(["--demo"]),
    });

    startFooXVendor(harness.runtime);

    const result = await waitForResult(harness.messages);

    expect(result).toMatchObject({
      service: "foo",
      vendor: "x",
      compList: ["components/lib/math"],
      calls: [],
    });
    expect(harness.messages.map((message) => message.type)).toContain("ready");
    expect(harness.messages.map((message) => message.type)).toContain("status");
    expect(harness.messages.map((message) => message.type)).toContain("result");
  });

  it("supports handle stop", async () => {
    const harness = createHarness({
      components: [{ id: "components/vue/card", rootDir: "/workspace/components/vue/card" }],
      config: { delay: 10 },
      args: parseCliArguments([]),
    });

    const handle = startBarZVendor(harness.runtime);
    await handle.stop?.();

    await expect(waitForResult(harness.messages)).resolves.toMatchObject({
      statusText: "stopped:1",
    });
  });
});

function createHarness<Config extends Record<string, unknown>>(data: VendorData<Config>) {
  type Runtime = VendorRuntime<Config>;
  type ControlListener = Parameters<Runtime["onMessage"]>[0];

  const messages: VendorMessage[] = [];
  const controlListeners = new Set<ControlListener>();
  const runtime: Runtime = {
    data,
    postMessage(message) {
      messages.push(message);
    },
    onMessage(listener) {
      controlListeners.add(listener);
      return () => controlListeners.delete(listener);
    },
  };

  return {
    runtime,
    messages,
    shutdown() {
      for (const listener of Array.from(controlListeners)) void listener({ type: "shutdown" });
    },
  };
}

async function waitForResult(messages: VendorMessage[]) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = messages.find(isResultMessage);
    if (result) return result.data;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  throw new Error("Timed out waiting for vendor result message.");
}

function isResultMessage(message: VendorMessage): message is VendorResultMessage<JsonValue> {
  return message.type === "result";
}
