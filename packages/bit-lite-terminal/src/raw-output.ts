export type TerminalOutputStream = "stdout" | "stderr";

export type RawOutputEntry = {
  stream: TerminalOutputStream;
  chunk: Buffer;
};

export type RawOutputBufferOptions = {
  limitBytes?: number | undefined;
};

const defaultLimitBytes = 2_000_000;

/**
 * What: everything a task has written, kept so attaching to it can replay the
 * output that arrived while nobody was watching.
 *
 * Why bounded: a watch session runs for hours and a chatty dev server would
 * otherwise grow this without limit. The oldest chunks are dropped, because a
 * terminal's scrollback is what this stands in for and that is what scrollback
 * does.
 */
export class RawOutputBuffer {
  #entries: RawOutputEntry[] = [];
  #byteLength = 0;
  #limitBytes: number;

  constructor(options: RawOutputBufferOptions = {}) {
    this.#limitBytes = options.limitBytes ?? defaultLimitBytes;
  }

  get byteLength() {
    return this.#byteLength;
  }

  append(stream: TerminalOutputStream, chunk: Buffer | string) {
    const entry: RawOutputEntry = { stream, chunk: Buffer.from(chunk) };
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
