import { parseCliArguments } from "bit-lite-context";
import { describe, expect, it } from "vitest";
import { meta as barXVendor } from "./bar-x.js";
import { meta as barYVendor } from "./bar-y.js";
import { meta as barZVendor } from "./bar-z.js";
import { meta as bazXVendor } from "./baz-x.js";
import { meta as fooXVendor } from "./foo-x.js";
import { meta as mixedResultsVendor } from "./mixed-results.js";
import { meta as testXVendor } from "./test-x.js";
import { meta as testYVendor } from "./test-y.js";
import startFooXVendor from "./foo-x.js";
import startBarZVendor from "./bar-z.js";
import type {
  JsonValue,
  VendorData,
  VendorStartResult,
  VendorMessage,
  VendorResultMessage,
  VendorRuntime,
} from "bit-lite-vendors";

describe("demo vendors", () => {
  it("exports the configured sample vendors", () => {
    expect(fooXVendor.id).toBe("foo-x");
    expect(barXVendor.id).toBe("bar-x");
    expect(barYVendor.id).toBe("bar-y");
    expect(barZVendor.id).toBe("bar-z");
    expect(bazXVendor.id).toBe("baz-x");
    expect(testXVendor.id).toBe("test-x");
    expect(testYVendor.id).toBe("test-y");
    expect(mixedResultsVendor.id).toBe("mixed-results");
    expect(fooXVendor.moduleUrl).toBeTruthy();
  });

  it("posts lifecycle messages and result data", async () => {
    const harness = createHarness({
      env: selectedEnv("demo"),
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
      env: selectedEnv("vue"),
      components: [{ id: "components/vue/card", rootDir: "/workspace/components/vue/card" }],
      config: { delay: 10 },
      args: parseCliArguments([]),
    });

    const handle = startBarZVendor(harness.runtime);
    await handle.stop?.();
    await handle.stop?.();

    await expect(waitForResult(harness.messages)).resolves.toMatchObject({
      statusText: "stopped:1",
    });
    expect(harness.messages.filter((message) => message.type === "result")).toHaveLength(1);
  });
});

function createHarness<Config extends Record<string, unknown>>(data: VendorData<Config>) {
  type Runtime = VendorRuntime<Config>;

  const messages: VendorMessage[] = [];
  const runtime: Runtime = {
    data,
    postMessage(message) {
      messages.push(message);
    },
    onMessage() {
      return () => undefined;
    },
  };

  return { runtime, messages };
}

function selectedEnv(packageName: string) {
  return { packageName, requestedVersion: "1.0.0", installedVersion: "1.0.0" };
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
