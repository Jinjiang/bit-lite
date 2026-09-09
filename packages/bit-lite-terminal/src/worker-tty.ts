import readline from "node:readline";
import { defineProperty, setTerminalSize, type TerminalSize } from "./terminal-size.js";

/**
 * What: makes a worker thread's standard streams look like a terminal.
 *
 * Why: a worker's streams are pipes, and the tools Bit Lite runs in workers —
 * Jest, Vitest, dev servers — check `isTTY` to decide whether to colorize,
 * redraw, or accept keypresses. Without this shim a watch session in a worker
 * degrades to plain scrolling output, which is exactly what the managed
 * terminal exists to avoid.
 */

export type WorkerTtyShimOptions = {
  terminal?: TerminalSize | undefined;
  forceColor?: boolean | undefined;
  term?: string | undefined;
};

type MutableWriteStream = NodeJS.WriteStream & {
  clearLine?(dir?: readline.Direction, callback?: () => void): boolean;
  cursorTo?(x: number, y?: number, callback?: () => void): boolean;
  moveCursor?(dx: number, dy: number, callback?: () => void): boolean;
  clearScreenDown?(callback?: () => void): boolean;
};

type MutableReadStream = NodeJS.ReadStream & {
  isRaw?: boolean;
};

export function installWorkerTtyShim(options: WorkerTtyShimOptions = {}): void {
  if (options.forceColor ?? true) {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR ??= "1";
  }
  process.env.TERM ||= options.term ?? "xterm-256color";

  installWritableTty(process.stdout as MutableWriteStream, options.terminal);
  installWritableTty(process.stderr as MutableWriteStream, options.terminal);
  installReadableTty(process.stdin as MutableReadStream);
}

function installWritableTty(stream: MutableWriteStream, terminal: TerminalSize | undefined) {
  defineProperty(stream, "isTTY", true);
  setTerminalSize(terminal);

  stream.clearLine ??= (dir = 0, callback?: () => void) => readline.clearLine(stream, dir, callback);
  stream.cursorTo ??= (x: number, yOrCallback?: number | (() => void), callback?: () => void) => {
    if (typeof yOrCallback === "function") return readline.cursorTo(stream, x, undefined, yOrCallback);
    return readline.cursorTo(stream, x, yOrCallback, callback);
  };
  stream.moveCursor ??= (dx: number, dy: number, callback?: () => void) =>
    readline.moveCursor(stream, dx, dy, callback);
  stream.clearScreenDown ??= (callback?: () => void) => readline.clearScreenDown(stream, callback);
  stream.getColorDepth ??= () => 8;
  stream.hasColors ??= () => true;
}

function installReadableTty(stream: MutableReadStream) {
  defineProperty(stream, "isTTY", true);
  defineProperty(stream, "isRaw", false);
  stream.setRawMode ??= (mode: boolean) => {
    defineProperty(stream, "isRaw", mode);
    return stream;
  };
}
