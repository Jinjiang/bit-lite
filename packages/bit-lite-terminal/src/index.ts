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

export type ManagedTerminalInputStream = NodeJS.ReadStream & {
  isRaw?: boolean;
  isTTY?: boolean;
  setRawMode?(mode: boolean): NodeJS.ReadStream;
};

export type ManagedTerminalItem = {
  id: string;
  label: string;
  status: string;
  hint?: string | undefined;
  details?: string[] | undefined;
  rawOutput: RawOutputBuffer;
  writeInput?(chunk: Buffer | string): void;
  canAttach?: boolean | undefined;
};

export type ManagedTerminalScreen = "menu" | "terminal";

export type ManagedTerminalQuitReason = "quit" | "ctrl-c";

export type ManagedTerminalOptions<Item extends ManagedTerminalItem = ManagedTerminalItem> = {
  title: string | (() => string);
  items: Item[];
  instructions?: string | undefined;
  labelWidth?: number | undefined;
  statusWidth?: number | undefined;
  stdin?: ManagedTerminalInputStream | undefined;
  stdout?: NodeJS.WriteStream | undefined;
  stderr?: NodeJS.WriteStream | undefined;
  canAttach?(item: Item): boolean;
  onQuit?(reason: ManagedTerminalQuitReason): void | Promise<void>;
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
const defaultMenuColumns = 100;
const defaultMenuRows = 30;
const defaultLabelWidth = 22;
const defaultStatusWidth = 10;

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

export class ManagedTerminal<Item extends ManagedTerminalItem = ManagedTerminalItem> {
  #activeItemId: string | undefined;
  #items: Item[];
  #keypressListener: ((input: string | undefined, key: readline.Key) => void) | undefined;
  #options: ManagedTerminalOptions<Item>;
  #renderPending = false;
  #running = false;
  #screen: ManagedTerminalScreen = "menu";
  #selectedIndex = 0;
  #stderr: NodeJS.WriteStream;
  #stdin: ManagedTerminalInputStream;
  #stdout: NodeJS.WriteStream;

  constructor(options: ManagedTerminalOptions<Item>) {
    this.#options = options;
    this.#items = options.items;
    this.#stdin = options.stdin ?? process.stdin;
    this.#stdout = options.stdout ?? process.stdout;
    this.#stderr = options.stderr ?? process.stderr;
  }

  get activeItem() {
    return this.#items.find((item) => item.id === this.#activeItemId);
  }

  get screen() {
    return this.#screen;
  }

  get selectedItem() {
    return this.#items[this.#selectedIndex];
  }

  appendOutput(itemOrId: Item | string, stream: TerminalOutputStream, chunk: Buffer | string) {
    const item = this.#resolveItem(itemOrId);
    if (!item) return;

    item.rawOutput.append(stream, chunk);

    this.writeOutput(item, stream, chunk);
  }

  writeOutput(itemOrId: Item | string, stream: TerminalOutputStream, chunk: Buffer | string) {
    const item = this.#resolveItem(itemOrId);
    if (!item) return;

    if (this.#screen === "terminal" && this.#activeItemId === item.id) {
      this.#writeOutput(stream, chunk);
    }
  }

  renderNow() {
    this.#renderPending = false;
    this.#render();
  }

  scheduleRender() {
    if (this.#renderPending || !this.#running || this.#screen === "terminal") return;

    this.#renderPending = true;
    setImmediate(() => {
      this.#renderPending = false;
      this.#render();
    });
  }

  start() {
    if (this.#running) return;
    this.#running = true;

    this.#keypressListener = (input, key) => {
      this.#handleKeypress(input, key);
    };

    readline.emitKeypressEvents(this.#stdin);
    this.#stdin.setRawMode?.(true);
    this.#stdin.resume();
    this.#stdin.on("keypress", this.#keypressListener);
    this.scheduleRender();
  }

  stop(options: { clearScreen?: boolean | undefined } = {}) {
    if (!this.#running) return;
    this.#running = false;

    if (this.#keypressListener) {
      this.#stdin.off("keypress", this.#keypressListener);
      this.#keypressListener = undefined;
    }

    this.#stdin.setRawMode?.(false);
    this.#stdin.pause();
    this.#stdout.write(options.clearScreen ? "\x1b[?25h\x1b[2J\x1b[H" : "\x1b[?25h");
  }

  #attachToItem(item: Item | undefined) {
    if (!item || !this.#canAttach(item)) return;

    this.#activeItemId = item.id;
    this.#screen = "terminal";
    this.#renderPending = false;

    this.#stdout.write("\x1b[?25h\x1b[2J\x1b[H");
    for (const entry of item.rawOutput.entries()) {
      this.#writeOutput(entry.stream, entry.chunk);
    }
  }

  #canAttach(item: Item) {
    if (this.#options.canAttach) return this.#options.canAttach(item);
    return item.canAttach ?? typeof item.writeInput === "function";
  }

  #detachFromItem() {
    this.#screen = "menu";
    this.#activeItemId = undefined;
    this.#stdout.write("\x1b[2J\x1b[H");
    this.scheduleRender();
  }

  #handleKeypress(input: string | undefined, key: readline.Key) {
    if (key.ctrl && key.name === "c") {
      void this.#options.onQuit?.("ctrl-c");
      return;
    }

    if (this.#screen === "terminal") {
      this.#handleTerminalKey(input, key);
      return;
    }

    if (key.name === "q") {
      void this.#options.onQuit?.("quit");
      return;
    }

    if (this.#screen === "menu") {
      this.#handleMenuKey(key);
    }
  }

  #handleMenuKey(key: readline.Key) {
    if (this.#items.length === 0) return;

    if (key.name === "up") {
      this.#selectedIndex = (this.#selectedIndex + this.#items.length - 1) % this.#items.length;
      this.scheduleRender();
      return;
    }

    if (key.name === "down") {
      this.#selectedIndex = (this.#selectedIndex + 1) % this.#items.length;
      this.scheduleRender();
      return;
    }

    if (key.name === "return") {
      this.#attachToItem(this.selectedItem);
    }
  }

  #handleTerminalKey(input: string | undefined, key: readline.Key) {
    if (key.name === "escape") {
      this.#detachFromItem();
      return;
    }

    if (input) {
      this.activeItem?.writeInput?.(input);
    }
  }

  #render() {
    if (this.#screen === "terminal") return;

    const columns = readPositiveInteger(this.#stdout.columns, defaultMenuColumns);
    const rows = readPositiveInteger(this.#stdout.rows, defaultMenuRows);
    const lines = this.#renderMenu(columns, rows);

    this.#stdout.write("\x1b[?25l");
    this.#stdout.write("\x1b[2J\x1b[H");
    this.#stdout.write(lines.join("\n"));
  }

  #renderMenu(columns: number, rows: number) {
    const title = typeof this.#options.title === "function" ? this.#options.title() : this.#options.title;
    const instructions =
      this.#options.instructions ?? "Use Up/Down and Enter for raw terminal. Press q or Ctrl+C to stop.";
    const labelWidth = this.#options.labelWidth ?? defaultLabelWidth;
    const statusWidth = this.#options.statusWidth ?? defaultStatusWidth;
    const lines = [title, "", instructions, ""];

    this.#items.forEach((item, index) => {
      const marker = index === this.#selectedIndex ? ">" : " ";
      const label = item.label.padEnd(labelWidth);
      const status = item.status.padEnd(statusWidth);
      const hint = item.hint ? ` ${item.hint}` : "";
      const details = item.details?.length ? ` ${item.details.join(" ")}` : "";
      lines.push(fitTerminalLine(`${marker} ${label} ${status}${hint}${details}`, columns));
    });

    return fillTerminalScreen(lines, rows);
  }

  #resolveItem(itemOrId: Item | string) {
    return typeof itemOrId === "string" ? this.#items.find((item) => item.id === itemOrId) : itemOrId;
  }

  #writeOutput(stream: TerminalOutputStream, chunk: Buffer | string) {
    const target = stream === "stderr" ? this.#stderr : this.#stdout;
    target.write(chunk);
  }
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

function fillTerminalScreen(lines: string[], rows: number) {
  const result = lines.slice(0, rows);
  while (result.length < rows) result.push("");
  return result;
}

function fitTerminalLine(line: string, columns: number) {
  if (line.length <= columns) return line;
  return line.slice(0, Math.max(0, columns - 1));
}

function define(target: object, property: string, value: unknown) {
  Object.defineProperty(target, property, {
    value,
    writable: true,
    configurable: true,
  });
}
