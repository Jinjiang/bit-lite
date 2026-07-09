type JestWatchReporterCallback = {
  onRunStart?(): void | Promise<void>;
  onRunComplete(results: unknown): void | Promise<void>;
};

const callbacks = new Map<string, JestWatchReporterCallback>();
let nextReporterId = 0;

export function registerJestWatchReporter(callback: JestWatchReporterCallback) {
  nextReporterId += 1;
  const id = `bit-lite-jest-watch-${nextReporterId}`;
  callbacks.set(id, callback);
  return id;
}

export function unregisterJestWatchReporter(id: string) {
  callbacks.delete(id);
}

export default class BitLiteJestWatchReporter {
  #id: string | undefined;

  constructor(_globalConfig: unknown, options: Record<string, unknown> = {}) {
    this.#id = typeof options.reporterId === "string" ? options.reporterId : undefined;
  }

  async onRunStart() {
    if (this.#id === undefined) return;
    await callbacks.get(this.#id)?.onRunStart?.();
  }

  async onRunComplete(_testContexts: unknown, results: unknown) {
    if (this.#id === undefined) return;
    await callbacks.get(this.#id)?.onRunComplete(results);
  }
}
