import readline from "node:readline";
import { RawOutputBuffer, type TerminalOutputStream } from "./raw-output.js";
import { readPositiveInteger } from "./terminal-size.js";

/**
 * What: the interface that supervises several long-lived tasks in one terminal.
 *
 * Why: a watch session runs a compiler, a test runner, and a dev server at
 * once, and each of them would happily take the whole terminal. This owns the
 * terminal instead and lends it out: a menu lists every task with its status,
 * and attaching to one forwards raw input and output to that task alone until
 * the user detaches.
 */

export type ManagedTerminalInputStream = NodeJS.ReadStream & {
  isRaw?: boolean;
  isTTY?: boolean;
  setRawMode?(mode: boolean): NodeJS.ReadStream;
};

/** What the menu shows for one task, and how input reaches it. */
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
  onInterrupt?(): void | Promise<void>;
};

const defaultMenuColumns = 100;
const defaultMenuRows = 30;
const defaultLabelWidth = 22;
const defaultStatusWidth = 10;

const showCursor = "\x1b[?25h";
const hideCursor = "\x1b[?25l";
const clearScreen = "\x1b[2J\x1b[H";

export class ManagedTerminal<Item extends ManagedTerminalItem = ManagedTerminalItem> {
  #activeItemId: string | undefined;
  #items: Item[];
  #keypressListener: ((input: string | undefined, key: readline.Key) => void) | undefined;
  #options: ManagedTerminalOptions<Item>;
  #renderPending = false;
  #running = false;
  #attached = false;
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

  /** `"terminal"` while attached to one task, `"menu"` otherwise. */
  get screen(): "menu" | "terminal" {
    return this.#attached ? "terminal" : "menu";
  }

  get selectedItem() {
    return this.#items[this.#selectedIndex];
  }

  /** Records output in the item's buffer and shows it if that item is attached. */
  appendOutput(itemOrId: Item | string, stream: TerminalOutputStream, chunk: Buffer | string) {
    const item = this.#resolveItem(itemOrId);
    if (!item) return;
    item.rawOutput.append(stream, chunk);
    this.writeOutput(item, stream, chunk);
  }

  /** Shows output that the caller has already recorded. */
  writeOutput(itemOrId: Item | string, stream: TerminalOutputStream, chunk: Buffer | string) {
    const item = this.#resolveItem(itemOrId);
    if (item && this.#attached && this.#activeItemId === item.id) {
      this.#writeOutput(stream, chunk);
    }
  }

  renderNow() {
    this.#renderPending = false;
    this.#render();
  }

  /** Coalesces the many status changes one event loop turn can produce. */
  scheduleRender() {
    if (this.#renderPending || !this.#running || this.#attached) return;

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
    this.#stdout.write(options.clearScreen ? `${showCursor}${clearScreen}` : showCursor);
  }

  #attachToItem(item: Item | undefined) {
    if (!item || !this.#canAttach(item)) return;

    this.#activeItemId = item.id;
    this.#attached = true;
    this.#renderPending = false;

    this.#stdout.write(`${showCursor}${clearScreen}`);
    for (const entry of item.rawOutput.entries()) {
      this.#writeOutput(entry.stream, entry.chunk);
    }
  }

  #canAttach(item: Item) {
    if (this.#options.canAttach) return this.#options.canAttach(item);
    return item.canAttach ?? typeof item.writeInput === "function";
  }

  #detachFromItem() {
    this.#attached = false;
    this.#activeItemId = undefined;
    this.#stdout.write(clearScreen);
    this.scheduleRender();
  }

  #handleKeypress(input: string | undefined, key: readline.Key) {
    if (key.ctrl && key.name === "c") {
      void this.#options.onInterrupt?.();
      return;
    }
    if (this.#attached) this.#handleAttachedKey(input, key);
    else this.#handleMenuKey(key);
  }

  #handleMenuKey(key: readline.Key) {
    if (this.#items.length === 0) return;

    if (key.name === "up" || key.name === "down") {
      const step = key.name === "up" ? this.#items.length - 1 : 1;
      this.#selectedIndex = (this.#selectedIndex + step) % this.#items.length;
      this.scheduleRender();
      return;
    }
    if (key.name === "return") this.#attachToItem(this.selectedItem);
  }

  #handleAttachedKey(input: string | undefined, key: readline.Key) {
    if (key.name === "escape") this.#detachFromItem();
    else if (input) this.activeItem?.writeInput?.(input);
  }

  #render() {
    if (this.#attached) return;

    const columns = readPositiveInteger(this.#stdout.columns, defaultMenuColumns);
    const rows = readPositiveInteger(this.#stdout.rows, defaultMenuRows);

    this.#stdout.write(hideCursor);
    this.#stdout.write(clearScreen);
    this.#stdout.write(this.#renderMenu(columns, rows).join("\n"));
  }

  #renderMenu(columns: number, rows: number) {
    const { title, instructions, labelWidth, statusWidth } = this.#options;
    const lines = [
      typeof title === "function" ? title() : title,
      "",
      instructions ?? "Use Up/Down and Enter for raw terminal. Press Ctrl+C to stop.",
      "",
    ];

    this.#items.forEach((item, index) => {
      const marker = index === this.#selectedIndex ? ">" : " ";
      const label = item.label.padEnd(labelWidth ?? defaultLabelWidth);
      const status = item.status.padEnd(statusWidth ?? defaultStatusWidth);
      const hint = item.hint ? ` ${item.hint}` : "";
      const details = item.details?.length ? ` ${item.details.join(" ")}` : "";
      lines.push(fitTerminalLine(`${marker} ${label} ${status}${hint}${details}`, columns));
    });

    // Padded to the full height so the previous frame never shows through.
    return [...lines.slice(0, rows), ...Array(Math.max(0, rows - lines.length)).fill("")];
  }

  #resolveItem(itemOrId: Item | string) {
    return typeof itemOrId === "string"
      ? this.#items.find((item) => item.id === itemOrId)
      : itemOrId;
  }

  #writeOutput(stream: TerminalOutputStream, chunk: Buffer | string) {
    (stream === "stderr" ? this.#stderr : this.#stdout).write(chunk);
  }
}

function fitTerminalLine(line: string, columns: number) {
  return line.length <= columns ? line : line.slice(0, Math.max(0, columns - 1));
}
