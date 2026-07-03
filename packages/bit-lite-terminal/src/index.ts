import readline from "node:readline";

export type TerminalOutputStream = "stdout" | "stderr";

export type TerminalSize = {
  columns?: number | undefined;
  rows?: number | undefined;
};

export type TerminalResizeMessage = TerminalSize & {
  type: "terminal:resize";
};

export type WorkerTtyShimOptions = {
  terminal?: TerminalSize | undefined;
  forceColor?: boolean | undefined;
  term?: string | undefined;
};

export type RawOutputEntry = {
  stream: TerminalOutputStream;
  chunk: Buffer;
};

export type RawOutputBufferOptions = {
  limitBytes?: number | undefined;
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

const defaultColumns = 80;
const defaultRows = 24;
const defaultRawOutputLimitBytes = 2_000_000;

export class RawOutputBuffer {
  #entries: RawOutputEntry[] = [];
  #byteLength = 0;
  #limitBytes: number;

  constructor(options: RawOutputBufferOptions = {}) {
    this.#limitBytes = options.limitBytes ?? defaultRawOutputLimitBytes;
  }

  get byteLength() {
    return this.#byteLength;
  }

  append(stream: TerminalOutputStream, chunk: Buffer | string) {
    const entry: RawOutputEntry = {
      stream,
      chunk: Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk),
    };

    this.#entries.push(entry);
    this.#byteLength += entry.chunk.byteLength;

    while (this.#byteLength > this.#limitBytes) {
      const removed = this.#entries.shift();
      if (!removed) break;
      this.#byteLength -= removed.chunk.byteLength;
    }
  }

  entries() {
    return this.#entries;
  }
}

export function installWorkerTtyShim(options: WorkerTtyShimOptions = {}) {
  const forceColor = options.forceColor ?? true;
  if (forceColor) {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR ??= "1";
  }
  process.env.TERM ||= options.term ?? "xterm-256color";

  installWritableTty(process.stdout as MutableWriteStream, options.terminal);
  installWritableTty(process.stderr as MutableWriteStream, options.terminal);
  installReadableTty(process.stdin as MutableReadStream);
}

export function setTerminalSize(terminal: TerminalSize = {}) {
  const columns = readPositiveInteger(terminal.columns, defaultColumns);
  const rows = readPositiveInteger(terminal.rows, defaultRows);

  define(process.stdout, "columns", columns);
  define(process.stdout, "rows", rows);
  define(process.stderr, "columns", columns);
  define(process.stderr, "rows", rows);
}

export function readTerminalSize(stream: NodeJS.WriteStream = process.stdout): Required<TerminalSize> {
  return {
    columns: readPositiveInteger(stream.columns, defaultColumns),
    rows: readPositiveInteger(stream.rows, defaultRows),
  };
}

export function createTerminalResizeMessage(terminal: TerminalSize = readTerminalSize()): TerminalResizeMessage {
  return {
    type: "terminal:resize",
    columns: terminal.columns,
    rows: terminal.rows,
  };
}

export function isTerminalResizeMessage(message: unknown): message is TerminalResizeMessage {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "terminal:resize";
}

export function bindTerminalResize(
  target: { postMessage(message: TerminalResizeMessage): void },
  stream: NodeJS.WriteStream = process.stdout
) {
  const handleResize = () => {
    target.postMessage(createTerminalResizeMessage(readTerminalSize(stream)));
  };

  stream.on("resize", handleResize);
  return () => stream.off("resize", handleResize);
}

export function writeTerminalOutput(stream: TerminalOutputStream, chunk: Buffer | string) {
  const target = stream === "stderr" ? process.stderr : process.stdout;
  target.write(chunk);
}

function installWritableTty(stream: MutableWriteStream, terminal: TerminalSize | undefined) {
  define(stream, "isTTY", true);
  setTerminalSize(terminal);

  stream.clearLine ??= (dir = 0, callback?: () => void) => readline.clearLine(stream, dir, callback);
  stream.cursorTo ??= (x: number, yOrCallback?: number | (() => void), callback?: () => void) => {
    if (typeof yOrCallback === "function") return readline.cursorTo(stream, x, undefined, yOrCallback);
    if (typeof yOrCallback === "number") return readline.cursorTo(stream, x, yOrCallback, callback);
    return readline.cursorTo(stream, x, yOrCallback, callback);
  };
  stream.moveCursor ??= (dx: number, dy: number, callback?: () => void) => readline.moveCursor(stream, dx, dy, callback);
  stream.clearScreenDown ??= (callback?: () => void) => readline.clearScreenDown(stream, callback);
  stream.getColorDepth ??= () => 8;
  stream.hasColors ??= () => true;
}

function installReadableTty(stream: MutableReadStream) {
  define(stream, "isTTY", true);
  define(stream, "isRaw", false);
  stream.setRawMode ??= (mode: boolean) => {
    define(stream, "isRaw", mode);
    return stream;
  };
}

function readPositiveInteger(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function define(target: object, property: string, value: unknown) {
  Object.defineProperty(target, property, {
    value,
    writable: true,
    configurable: true,
  });
}
