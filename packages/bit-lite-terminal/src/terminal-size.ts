/**
 * What: the terminal's dimensions, and how they reach a worker.
 *
 * Why a message: a worker thread has no terminal of its own, so the parent
 * reads the real size and forwards every change. A vendor that renders to a
 * width therefore renders to the width the user actually has.
 */

export type TerminalSize = {
  columns?: number | undefined;
  rows?: number | undefined;
};

export type TerminalResizeMessage = TerminalSize & {
  type: "terminal:resize";
};

const defaultColumns = 80;
const defaultRows = 24;

export function readTerminalSize(
  stream: NodeJS.WriteStream = process.stdout
): Required<TerminalSize> {
  return {
    columns: readPositiveInteger(stream.columns, defaultColumns),
    rows: readPositiveInteger(stream.rows, defaultRows),
  };
}

/** Applies a size to this process's output streams, as a TTY would report it. */
export function setTerminalSize(terminal: TerminalSize = {}): void {
  const columns = readPositiveInteger(terminal.columns, defaultColumns);
  const rows = readPositiveInteger(terminal.rows, defaultRows);

  for (const stream of [process.stdout, process.stderr]) {
    defineProperty(stream, "columns", columns);
    defineProperty(stream, "rows", rows);
  }
}

export function isTerminalResizeMessage(message: unknown): message is TerminalResizeMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "terminal:resize"
  );
}

/** Forwards this terminal's size to a worker now and on every later resize. */
export function bindTerminalResize(
  target: { postMessage(message: TerminalResizeMessage): void },
  stream: NodeJS.WriteStream = process.stdout
): () => void {
  const handleResize = () => {
    target.postMessage({ type: "terminal:resize", ...readTerminalSize(stream) });
  };

  stream.on("resize", handleResize);
  return () => {
    stream.off("resize", handleResize);
  };
}

export function readPositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function defineProperty(target: object, property: string, value: unknown): void {
  Object.defineProperty(target, property, { value, writable: true, configurable: true });
}
