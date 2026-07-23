import path from "node:path";
import { streamParser } from "@pnpm/logger";
import { isRecord } from "bit-lite-utils";

export type DependencyInstallProgressCounts = {
  resolved: number;
  reused: number;
  downloaded: number;
  added: number;
};

export type DependencyInstallProgressEvent =
  | {
      type: "stage";
      stage: "resolution" | "importing";
      status: "started" | "completed";
    }
  | {
      type: "progress";
      counts: DependencyInstallProgressCounts;
    }
  | {
      type: "stats";
      added: number;
      removed: number;
    }
  | {
      type: "warning";
      message: string;
    }
  | {
      type: "optional-skip";
      reason: "unsupported-platform";
      count: number;
    }
  | {
      type: "retry";
      attempt: number;
      maxRetries: number;
      method: string;
      url: string;
      timeout: number;
      errorCode?: string | number;
    };

type ProgressStream = {
  on(event: "data", listener: (record: unknown) => void): void;
  removeListener(event: "data", listener: (record: unknown) => void): void;
};

export function observeDependencyInstallProgress(
  rootDir: string,
  onProgress: (event: DependencyInstallProgressEvent) => void,
  progressStream: ProgressStream = streamParser as unknown as ProgressStream
) {
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    progressStream.removeListener("data", listener);
  };
  const adapter = createDependencyProgressAdapter(rootDir, (event) => {
    try {
      onProgress(event);
    } catch {
      dispose();
    }
  });
  const listener = (record: unknown) => {
    if (active) adapter(record);
  };
  progressStream.on("data", listener);
  return dispose;
}

export function createDependencyProgressAdapter(
  rootDir: string,
  emit: (event: DependencyInstallProgressEvent) => void
) {
  const normalizedRoot = path.resolve(rootDir);
  const resolved = new Set<string>();
  const reused = new Set<string>();
  const downloaded = new Set<string>();
  const added = new Set<string>();
  const unsupportedPlatformPackages = new Set<string>();
  let lastCounts = "";
  let lastStage = "";
  let lastStats = "";

  return (value: unknown) => {
    if (!isRecord(value) || typeof value.name !== "string") return;

    if (value.name === "pnpm:stage") {
      if (!isScopedToRoot(value, normalizedRoot) || typeof value.stage !== "string") return;
      const event = readStage(value.stage);
      if (!event) return;
      const key = `${event.stage}:${event.status}`;
      if (key === lastStage) return;
      lastStage = key;
      emit(event);
      return;
    }

    if (value.name === "pnpm:progress") {
      if (!isScopedToRoot(value, normalizedRoot) || typeof value.status !== "string") return;
      let changed = false;
      if (
        (value.status === "resolved" ||
          value.status === "found_in_store" ||
          value.status === "fetched") &&
        typeof value.packageId === "string"
      ) {
        const target =
          value.status === "resolved"
            ? resolved
            : value.status === "found_in_store"
              ? reused
              : downloaded;
        const before = target.size;
        target.add(value.packageId);
        changed = target.size !== before;
      } else if (value.status === "imported" && typeof value.to === "string") {
        const before = added.size;
        added.add(path.resolve(value.to));
        changed = added.size !== before;
      }
      if (!changed) return;
      const counts = {
        resolved: resolved.size,
        reused: reused.size,
        downloaded: downloaded.size,
        added: added.size,
      };
      const key = formatCountsKey(counts);
      if (key === lastCounts) return;
      lastCounts = key;
      emit({ type: "progress", counts });
      return;
    }

    if (value.name === "pnpm:stats") {
      if (!isScopedToRoot(value, normalizedRoot)) return;
      const addedCount = typeof value.added === "number" && value.added >= 0 ? value.added : 0;
      const removedCount = typeof value.removed === "number" && value.removed >= 0 ? value.removed : 0;
      if (value.added === undefined && value.removed === undefined) return;
      const key = `${addedCount}:${removedCount}`;
      if (key === lastStats) return;
      lastStats = key;
      emit({ type: "stats", added: addedCount, removed: removedCount });
      return;
    }

    if (value.name === "pnpm:request-retry") {
      const event = readRetry(value);
      if (event) emit(event);
      return;
    }

    if (
      value.level === "warn" &&
      typeof value.message === "string" &&
      isScopedToRoot(value, normalizedRoot)
    ) {
      const packageId = readUnsupportedPlatformPackageId(value);
      if (packageId !== undefined) {
        const previousCount = unsupportedPlatformPackages.size;
        unsupportedPlatformPackages.add(packageId);
        if (unsupportedPlatformPackages.size !== previousCount) {
          emit({
            type: "optional-skip",
            reason: "unsupported-platform",
            count: unsupportedPlatformPackages.size,
          });
        }
        return;
      }
      emit({ type: "warning", message: value.message });
    }
  };
}

function readUnsupportedPlatformPackageId(value: Record<string, unknown>) {
  if (value.name !== "pnpm:install-check" || typeof value.message !== "string") {
    return undefined;
  }
  return /^Unsupported platform for (.+): wanted .+ \(current: .+\)$/.exec(value.message)?.[1];
}

function readStage(
  value: string
): Extract<DependencyInstallProgressEvent, { type: "stage" }> | undefined {
  switch (value) {
    case "resolution_started":
      return { type: "stage", stage: "resolution", status: "started" };
    case "resolution_done":
      return { type: "stage", stage: "resolution", status: "completed" };
    case "importing_started":
      return { type: "stage", stage: "importing", status: "started" };
    case "importing_done":
      return { type: "stage", stage: "importing", status: "completed" };
    default:
      return undefined;
  }
}

function readRetry(
  value: Record<string, unknown>
): Extract<DependencyInstallProgressEvent, { type: "retry" }> | undefined {
  if (
    typeof value.attempt !== "number" ||
    typeof value.maxRetries !== "number" ||
    typeof value.method !== "string" ||
    typeof value.url !== "string" ||
    typeof value.timeout !== "number"
  ) {
    return undefined;
  }
  const errorCode = readErrorCode(value.error);
  return {
    type: "retry",
    attempt: value.attempt,
    maxRetries: value.maxRetries,
    method: value.method,
    url: value.url,
    timeout: value.timeout,
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

function readErrorCode(value: unknown): string | number | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["httpStatusCode", "status", "errno", "code"]) {
    if (typeof value[key] === "string" || typeof value[key] === "number") return value[key];
  }
  return undefined;
}

function isScopedToRoot(value: Record<string, unknown>, rootDir: string) {
  const scope =
    typeof value.requester === "string"
      ? value.requester
      : typeof value.prefix === "string"
        ? value.prefix
        : undefined;
  if (scope === undefined) return true;
  const relative = path.relative(rootDir, path.resolve(scope));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatCountsKey(counts: DependencyInstallProgressCounts) {
  return `${counts.resolved}:${counts.reused}:${counts.downloaded}:${counts.added}`;
}
