import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ManagedTerminal, RawOutputBuffer } from "./index.js";
import type { ManagedTerminalInputStream } from "./index.js";

describe("ManagedTerminal", () => {
  it("pauses stdin on stop when start resumed it", () => {
    const stdin = new FakeInput({ paused: true });
    const { terminal, stdout } = createTerminal(stdin);

    terminal.start();
    expect(stdin.isPaused()).toBe(false);
    expect(stdin.isRaw).toBe(true);
    expect(stdin.listenerCount("keypress")).toBe(1);

    terminal.stop();
    expect(stdin.isPaused()).toBe(true);
    expect(stdin.isRaw).toBe(false);
    expect(stdin.listenerCount("keypress")).toBe(0);
    expect(stdout.chunks.at(-1)).toBe("\x1b[?25h");
  });

  it("pauses stdin on stop even when the TTY initially reports resumed", () => {
    const stdin = new FakeInput({ paused: false });
    const { terminal } = createTerminal(stdin);

    terminal.start();
    terminal.stop();

    expect(stdin.isPaused()).toBe(true);
  });

  it("reports Ctrl+C as the only terminal interrupt", () => {
    const stdin = new FakeInput({ paused: true });
    const onInterrupt = vi.fn();
    const { terminal } = createTerminal(stdin, { onInterrupt });

    terminal.start();
    stdin.emit("keypress", "q", { name: "q" });
    expect(onInterrupt).not.toHaveBeenCalled();

    stdin.emit("keypress", undefined, { ctrl: true, name: "c" });
    expect(onInterrupt).toHaveBeenCalledOnce();
    terminal.stop();
  });
});

function createTerminal(
  stdin: FakeInput,
  options: { onInterrupt?(): void } = {}
) {
  const stdout = new FakeOutput();
  const terminal = new ManagedTerminal({
    title: "test terminal",
    items: [
      {
        id: "task",
        label: "Task",
        status: "ready",
        rawOutput: new RawOutputBuffer(),
      },
    ],
    stdin: stdin as unknown as ManagedTerminalInputStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeOutput() as unknown as NodeJS.WriteStream,
    ...options,
  });
  return { terminal, stdout };
}

class FakeInput extends EventEmitter {
  isRaw = false;
  isTTY = true;
  #paused: boolean;

  constructor(options: { paused: boolean }) {
    super();
    this.#paused = options.paused;
  }

  isPaused() {
    return this.#paused;
  }

  pause() {
    this.#paused = true;
    return this;
  }

  resume() {
    this.#paused = false;
    return this;
  }

  setRawMode(mode: boolean) {
    this.isRaw = mode;
    return this as unknown as NodeJS.ReadStream;
  }
}

class FakeOutput extends EventEmitter {
  columns = 80;
  rows = 24;
  chunks: string[] = [];

  write(chunk: string | Uint8Array) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    return true;
  }
}
