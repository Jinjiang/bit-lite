import type { DependencyInstallProgressEvent } from "bit-lite-deps";

export type InstallProgressStream = {
  isTTY?: boolean;
  write(value: string): unknown;
};

export type InstallReporter = {
  start(message: string): void;
  update(message: string): void;
  dependency(event: DependencyInstallProgressEvent): void;
  diagnostic(kind: "warning" | "retry", message: string): void;
  succeed(message: string): void;
  fail(message: string): void;
  close(): void;
};

export type CreateInstallReporterOptions = {
  stream?: InstallProgressStream;
  now?: () => number;
  progressIntervalMs?: number;
};

const CLEAR_LINE = "\r\u001b[2K";

export function createInstallReporter(
  options: CreateInstallReporterOptions = {}
): InstallReporter {
  const stream = options.stream ?? process.stderr;
  const interactive = stream.isTTY === true;
  const now = options.now ?? Date.now;
  const progressIntervalMs = options.progressIntervalMs ?? 100;
  let activeMessage: string | undefined;
  let disabled = false;
  let closed = false;
  let lastStatusMessage: string | undefined;
  let lastDurableProgress: string | undefined;
  let lastProgressAt = Number.NEGATIVE_INFINITY;
  let pendingProgress: string | undefined;
  let skippedOptionalPlatformPackages = 0;

  const reporter: InstallReporter = {
    start(message) {
      if (closed) return;
      flushPendingProgress();
      flushOptionalPlatformSkips();
      activeMessage = message;
      lastStatusMessage = message;
      lastDurableProgress = undefined;
      lastProgressAt = Number.NEGATIVE_INFINITY;
      pendingProgress = undefined;
      writeStatus(message);
    },
    update(message) {
      if (closed || message === lastStatusMessage) return;
      flushPendingProgress();
      activeMessage = message;
      lastStatusMessage = message;
      writeStatus(message);
    },
    dependency(event) {
      if (closed) return;
      switch (event.type) {
        case "stage":
          flushPendingProgress();
          reporter.update(formatDependencyStage(event));
          return;
        case "progress": {
          const message = formatDependencyCounts(event.counts);
          activeMessage = message;
          lastStatusMessage = message;
          if (interactive) {
            renderActive();
            return;
          }
          if (message === lastDurableProgress || message === pendingProgress) return;
          if (now() - lastProgressAt >= progressIntervalMs) {
            writeAppendOnly(message);
            lastDurableProgress = message;
            lastProgressAt = now();
          } else {
            pendingProgress = message;
          }
          return;
        }
        case "stats": {
          flushPendingProgress();
          const changes = [
            event.added > 0 ? `+${event.added}` : undefined,
            event.removed > 0 ? `-${event.removed}` : undefined,
          ].filter((value): value is string => value !== undefined);
          if (changes.length > 0) reporter.update(`Installing dependencies: packages ${changes.join(" ")}`);
          return;
        }
        case "warning":
          reporter.diagnostic("warning", event.message);
          return;
        case "optional-skip":
          skippedOptionalPlatformPackages = Math.max(
            skippedOptionalPlatformPackages,
            event.count
          );
          return;
        case "retry":
          reporter.diagnostic("retry", formatRetry(event));
      }
    },
    diagnostic(kind, message) {
      if (closed) return;
      if (interactive) {
        clearActive();
        safeWrite(`${kind === "warning" ? "!" : "↻"} ${message}\n`);
        renderActive();
      } else {
        safeWrite(`[install] ${kind}: ${message}\n`);
      }
    },
    succeed(message) {
      if (closed) return;
      flushPendingProgress();
      flushOptionalPlatformSkips();
      if (interactive) {
        clearActive();
        safeWrite(`✓ ${message}\n`);
      } else {
        writeAppendOnly(message);
      }
      activeMessage = undefined;
      lastStatusMessage = undefined;
    },
    fail(message) {
      if (closed) return;
      flushPendingProgress();
      flushOptionalPlatformSkips();
      if (interactive) {
        clearActive();
        safeWrite(`✗ ${message}\n`);
      } else {
        writeAppendOnly(message);
      }
      activeMessage = undefined;
      lastStatusMessage = undefined;
    },
    close() {
      if (closed) return;
      flushPendingProgress();
      flushOptionalPlatformSkips();
      if (interactive && activeMessage !== undefined) clearActive();
      activeMessage = undefined;
      closed = true;
    },
  };

  return reporter;

  function writeStatus(message: string) {
    if (interactive) renderActive();
    else writeAppendOnly(message);
  }

  function renderActive() {
    if (!interactive || activeMessage === undefined) return;
    clearActive();
    safeWrite(`- ${activeMessage}`);
  }

  function clearActive() {
    if (interactive) safeWrite(CLEAR_LINE);
  }

  function writeAppendOnly(message: string) {
    safeWrite(`[install] ${message}\n`);
  }

  function flushPendingProgress() {
    if (interactive || pendingProgress === undefined) return;
    const message = pendingProgress;
    pendingProgress = undefined;
    if (message === lastDurableProgress) return;
    writeAppendOnly(message);
    lastDurableProgress = message;
    lastProgressAt = now();
  }

  function flushOptionalPlatformSkips() {
    if (skippedOptionalPlatformPackages === 0) return;
    const count = skippedOptionalPlatformPackages;
    skippedOptionalPlatformPackages = 0;
    reporter.diagnostic(
      "warning",
      `Skipped ${count} optional ${count === 1 ? "package" : "packages"} for other platforms`
    );
  }

  function safeWrite(value: string) {
    if (disabled) return;
    try {
      stream.write(value);
    } catch {
      disabled = true;
    }
  }
}

function formatDependencyStage(
  event: Extract<DependencyInstallProgressEvent, { type: "stage" }>
) {
  if (event.stage === "resolution") {
    return event.status === "started"
      ? "Installing dependencies: resolving packages"
      : "Installing dependencies: resolution complete";
  }
  return event.status === "started"
    ? "Installing dependencies: importing packages"
    : "Installing dependencies: import complete";
}

function formatDependencyCounts(
  counts: Extract<DependencyInstallProgressEvent, { type: "progress" }>["counts"]
) {
  return `Installing dependencies: resolved ${counts.resolved}, reused ${counts.reused}, ` +
    `downloaded ${counts.downloaded}, added ${counts.added}`;
}

function formatRetry(event: Extract<DependencyInstallProgressEvent, { type: "retry" }>) {
  const retriesLeft = Math.max(0, event.maxRetries - event.attempt + 1);
  const error = event.errorCode === undefined ? "request error" : String(event.errorCode);
  return `${event.method} ${sanitizeUrl(event.url)} failed (${error}); retrying in ` +
    `${event.timeout}ms, ${retriesLeft} ${retriesLeft === 1 ? "retry" : "retries"} left`;
}

function sanitizeUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return value;
  }
}
