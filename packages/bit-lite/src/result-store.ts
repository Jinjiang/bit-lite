import type { SelectedEnvIdentity } from "bit-lite-context";

export type ResultStoreEntry<Result> = {
  observedAt: string;
  taskId: string;
  env: SelectedEnvIdentity;
  vendor: string;
  json: Result;
  text: string;
};

export type ResultStoreAddEntry<Result> = Omit<ResultStoreEntry<Result>, "observedAt"> & {
  observedAt?: string | Date;
};

export type ResultStore<Result> = {
  add(entry: ResultStoreAddEntry<Result>): ResultStoreEntry<Result>;
  entries(vendor?: string): ResultStoreEntry<Result>[];
  json(vendor?: string): Result[];
  text(vendor?: string): string;
};

export function createResultStore<Result>(): ResultStore<Result> {
  const entries: ResultStoreEntry<Result>[] = [];

  return {
    add(entry) {
      const storedEntry: ResultStoreEntry<Result> = {
        observedAt: formatObservedAt(entry.observedAt),
        taskId: entry.taskId,
        env: entry.env,
        vendor: entry.vendor,
        json: entry.json,
        text: entry.text,
      };

      entries.push(storedEntry);
      return storedEntry;
    },
    entries(vendor) {
      return filterEntries(entries, vendor);
    },
    json(vendor) {
      return filterEntries(entries, vendor).map((entry) => entry.json);
    },
    text(vendor) {
      return filterEntries(entries, vendor)
        .map((entry) => entry.text)
        .join("\n---\n");
    },
  };
}

function filterEntries<Result>(entries: ResultStoreEntry<Result>[], vendor: string | undefined) {
  if (vendor === undefined) return [...entries];
  return entries.filter((entry) => entry.vendor === vendor);
}

function formatObservedAt(value: string | Date | undefined) {
  if (value === undefined) return new Date().toISOString();
  if (typeof value === "string") return value;
  return value.toISOString();
}
