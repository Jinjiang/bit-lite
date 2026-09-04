import { isRecord } from "bit-lite-utils";
import { readTreeFile, type ComponentHistoryStore, type GitObjectId } from "bit-lite-history";
import type { PackageRef } from "bit-lite-context";
import { BitLiteError } from "./errors.js";
import { componentConfigFileName } from "./component-projection.js";
import type { FileChange } from "bit-lite-history";

/**
 * What: reads a snap's recorded `.comp.json` and expresses the difference
 * between two of them as dependency and env changes.
 *
 * Why not a text diff: the recorded file is a projection, not a file anyone
 * can open. Its shape differs from the working file, its keys are sorted, and
 * its `workspace:*` specifiers have been replaced by concrete versions. A
 * textual difference over it would be unreadable and would report key ordering
 * or formatting as a version change, which is exactly the misattribution this
 * module exists to prevent — every answer here comes from parsed values.
 */

const dependencyFields = ["dependencies", "devDependencies", "peerDependencies"] as const;

export type DependencyField = (typeof dependencyFields)[number];

export type DependencyChange = {
  field: DependencyField;
  packageName: string;
  /** Absent on the side where the dependency does not exist. */
  before: string | undefined;
  after: string | undefined;
  status: "added" | "removed" | "changed";
};

export type EnvChange = {
  before: PackageRef | undefined;
  after: PackageRef | undefined;
};

export type MetadataComparison = {
  dependencies: readonly DependencyChange[];
  /** Absent when the env reference is identical on both sides. */
  env: EnvChange | undefined;
  /**
   * Some other part of the recorded metadata differs. Surfaced rather than
   * described, so an unexpected metadata change can never vanish from output
   * just because this module does not know how to name it.
   */
  otherChanged: boolean;
};

export type RecordedComponentConfig = Record<string, unknown>;

/**
 * Reads the `.comp.json` a snap recorded. Returns `undefined` when the tree has
 * no such file, which a snap taken before the projection existed could show.
 */
export async function readRecordedComponentConfig(
  store: ComponentHistoryStore,
  componentId: string,
  treeId: GitObjectId
): Promise<RecordedComponentConfig | undefined> {
  const bytes = await readTreeFile(store, treeId, componentConfigFileName);
  if (bytes === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new BitLiteError(
      `component "${componentId}" recorded an unparsable ${componentConfigFileName}: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!isRecord(parsed)) {
    throw new BitLiteError(
      `component "${componentId}" recorded a ${componentConfigFileName} that is not an object`
    );
  }
  return parsed;
}

export function compareComponentMetadata(
  before: RecordedComponentConfig | undefined,
  after: RecordedComponentConfig | undefined
): MetadataComparison {
  return {
    dependencies: compareDependencies(before, after),
    env: compareEnv(before, after),
    otherChanged: hasOtherDifference(before, after),
  };
}

export function hasMetadataChange(comparison: MetadataComparison): boolean {
  return (
    comparison.dependencies.length > 0 || comparison.env !== undefined || comparison.otherChanged
  );
}

function compareDependencies(
  before: RecordedComponentConfig | undefined,
  after: RecordedComponentConfig | undefined
): DependencyChange[] {
  const changes: DependencyChange[] = [];

  for (const field of dependencyFields) {
    const beforeEntries = readDependencyRecord(before, field);
    const afterEntries = readDependencyRecord(after, field);
    const packageNames = new Set([...beforeEntries.keys(), ...afterEntries.keys()]);

    for (const packageName of [...packageNames].sort()) {
      const beforeVersion = beforeEntries.get(packageName);
      const afterVersion = afterEntries.get(packageName);
      if (beforeVersion === afterVersion) continue;

      changes.push({
        field,
        packageName,
        before: beforeVersion,
        after: afterVersion,
        status:
          beforeVersion === undefined
            ? "added"
            : afterVersion === undefined
              ? "removed"
              : "changed",
      });
    }
  }

  return changes;
}

function readDependencyRecord(
  config: RecordedComponentConfig | undefined,
  field: DependencyField
): Map<string, string> {
  const declared = config?.[field];
  if (!isRecord(declared)) return new Map();
  return new Map(
    Object.entries(declared).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

function compareEnv(
  before: RecordedComponentConfig | undefined,
  after: RecordedComponentConfig | undefined
): EnvChange | undefined {
  const beforeEnv = readEnvReference(before);
  const afterEnv = readEnvReference(after);

  if (
    beforeEnv?.packageName === afterEnv?.packageName &&
    beforeEnv?.version === afterEnv?.version
  ) {
    return undefined;
  }
  return { before: beforeEnv, after: afterEnv };
}

function readEnvReference(config: RecordedComponentConfig | undefined): PackageRef | undefined {
  const env = config?.env;
  if (!isRecord(env)) return undefined;
  const { packageName, version } = env;
  if (typeof packageName !== "string" || typeof version !== "string") return undefined;
  return { packageName, version };
}

/**
 * Everything the two dedicated comparisons do not cover. Compared as
 * canonically serialized values so key ordering can never register as a
 * difference, matching how the projection itself is written.
 */
function hasOtherDifference(
  before: RecordedComponentConfig | undefined,
  after: RecordedComponentConfig | undefined
): boolean {
  return canonicalizeRest(before) !== canonicalizeRest(after);
}

function canonicalizeRest(config: RecordedComponentConfig | undefined): string {
  if (config === undefined) return "";
  const rest: Record<string, unknown> = { ...config };
  for (const field of dependencyFields) delete rest[field];
  delete rest.env;
  return canonicalize(rest);
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Why a version exists, relative to the snap before it. */
export type ChangeSource = "source" | "deps" | "env";

export type SnapAttribution = {
  /** True for a component's first snap, which is not attributed to a change. */
  initial: boolean;
  sources: readonly ChangeSource[];
  /** Set when metadata differs in a way that is neither a dependency nor an env change. */
  otherMetadataChanged: boolean;
};

/**
 * Classifies one snap against its parent. `fileChanges` must already exclude
 * `.comp.json`, since metadata is described by the comparison rather than as a
 * changed file.
 */
export function attributeSnapChange(input: {
  hasParent: boolean;
  fileChanges: readonly FileChange[];
  metadata: MetadataComparison;
}): SnapAttribution {
  if (!input.hasParent) {
    return { initial: true, sources: [], otherMetadataChanged: false };
  }

  const sources: ChangeSource[] = [];
  if (input.fileChanges.length > 0) sources.push("source");
  if (input.metadata.dependencies.length > 0) sources.push("deps");
  if (input.metadata.env !== undefined) sources.push("env");

  return {
    initial: false,
    sources,
    otherMetadataChanged: input.metadata.otherChanged,
  };
}
