import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type {
  CompileWatchResult,
  CompilerVendorRuntime,
} from "bit-lite-compiler";
import type {
  VendorMessage,
} from "bit-lite-vendors";

const chokidarMocks = vi.hoisted(() => ({
  watch: vi.fn(),
}));

vi.mock("chokidar", () => ({
  default: {
    watch: chokidarMocks.watch,
  },
}));

import { startCompilerWatch } from "./watch.js";

describe("maintained compiler watcher errors", () => {
  it("writes the full component-identified watcher diagnostic and retains the structured error", async () => {
    const watcher = new FakeWatcher();
    const messages: VendorMessage<CompileWatchResult>[] = [];
    const runtime = createRuntime(messages);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr: string[] = [];
    const errorOutput = vi.spyOn(console, "error").mockImplementation((...values) => {
      stderr.push(values.map(String).join(" "));
    });
    chokidarMocks.watch.mockImplementation(() => {
      queueMicrotask(() => watcher.emit("ready"));
      return watcher;
    });
    let stop: (() => void | Promise<void>) | undefined;

    try {
      const started = await startCompilerWatch(runtime, async () => ({ artifactCount: 1 }));
      stop = started.stop;
      const watcherError = new Error("watcher exploded");
      const diagnostic = watcherError.stack ?? watcherError.message;

      watcher.emit("error", watcherError);

      expect(stderr).toEqual([
        `[compile:component/fixture] Watcher error\n${diagnostic}`,
      ]);
      expect(errorMessages(messages)).toEqual([
        { type: "error", message: diagnostic },
      ]);
    } finally {
      await stop?.();
      chokidarMocks.watch.mockReset();
      stdout.mockRestore();
      errorOutput.mockRestore();
    }
  });
});

class FakeWatcher extends EventEmitter {
  close = vi.fn(async () => {});
}

function createRuntime(messages: VendorMessage<CompileWatchResult>[]) {
  return {
    data: {
      context: {
        args: {
          options: { watch: true },
        },
      },
      components: [{
        id: "component/fixture",
        rootDir: "/fixture/component",
      }],
      runtime: {},
    },
    postMessage(message: VendorMessage<CompileWatchResult>) {
      messages.push(message);
    },
    onMessage() {
      return () => undefined;
    },
  } as unknown as CompilerVendorRuntime;
}

function errorMessages(messages: VendorMessage<CompileWatchResult>[]) {
  return messages.filter((message): message is { type: "error"; message: string } => message.type === "error");
}
