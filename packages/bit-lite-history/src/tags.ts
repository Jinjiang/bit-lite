import semver from "semver";
import { readComponentHead } from "./commits.js";
import { assertNotSnapVersion } from "./component-version.js";
import { ComponentHistoryError } from "./errors.js";
import { createObjectId, formatObjectId, type GitObjectId } from "./object-id.js";
import {
  componentHeadRef,
  componentTagRef,
  componentTagRefPrefix,
  encodeComponentKey,
  parseComponentTagRef,
} from "./refs.js";
import type { ComponentHistoryStore } from "./store.js";

/**
 * What: assigns an immutable semantic version to an existing component snap.
 *
 * Why: annotated tags are used rather than lightweight ones because they are
 * real Git objects carrying a tagger, timestamp, message, and an explicitly
 * typed target, which makes a published version auditable. V1 exposes no force,
 * move, or delete path: a version that already points somewhere else is a
 * conflict, not something to overwrite.
 */

export type ComponentTagStatus = "created" | "unchanged";

export type ComponentTagResult = {
  componentId: string;
  version: string;
  status: ComponentTagStatus;
  ref: string;
  /** Algorithm-qualified ID of the snap the tag points at. */
  snapId: string;
};

/**
 * Strict validation: an assigned component version is exactly three numbers.
 * Ranges, `v` prefixes, loose spellings such as `1.0`, prereleases, and build
 * metadata are all rejected.
 *
 * Excluding prereleases also excludes the generated snap identifier shape,
 * which is one — so a manually assigned version can never collide with an
 * identifier Bit Lite generates for a different snap. It keeps derived
 * increments total as well: there is no question of how `1.2.3-rc.1` should
 * order against the release it precedes, because it cannot be assigned.
 */
export function assertComponentVersion(version: string): string {
  // Checked first so pasting a generated identifier explains what it is rather
  // than only that prereleases are refused.
  assertNotSnapVersion(version);

  const parsed = semver.parse(version, { loose: false });
  // Requiring an exact round trip against `parsed.version` rejects `v1.2.3`,
  // `1.2`, surrounding whitespace, and anything carrying build metadata, since
  // `parsed.version` drops it. The explicit prerelease check then rejects the
  // rest.
  if (parsed === null || parsed.version !== version || parsed.prerelease.length > 0) {
    throw new ComponentHistoryError(
      `"${version}" is not an assignable component version; use exactly major.minor.patch, for example 1.2.3`
    );
  }
  return parsed.version;
}

/**
 * Lists the versions already assigned to one component, ordered lowest first.
 *
 * Ordering these is meaningful in a way that ordering snap identifiers is not:
 * assigned versions are real three-part semantic versions, so precedence
 * between them is total and reflects intent.
 */
export async function listComponentVersions(
  store: ComponentHistoryStore,
  componentId: string
): Promise<string[]> {
  const refs = await listComponentVersionRefs(store, componentId);
  return refs.map((ref) => ref.version).sort(semver.compare);
}

/** One assigned version together with the commit it resolves to. */
export type ComponentVersionRef = {
  version: string;
  /** Hex of the commit the tag peels to. */
  targetHex: string;
};

/**
 * Lists a component's assigned versions with their targets in one Git call, so
 * a caller can ask which version names a particular snap without walking tags
 * one at a time.
 */
export async function listComponentVersionRefs(
  store: ComponentHistoryStore,
  componentId: string
): Promise<ComponentVersionRef[]> {
  const prefix = `${componentTagRefPrefix}${encodeComponentKey(componentId)}/`;
  const result = await store.run({
    // `*objectname` is the peeled target of an annotated tag; `objectname` is
    // the fallback for a ref that is not a tag object.
    args: ["for-each-ref", "--format=%(refname)%09%(objectname)%09%(*objectname)", `${prefix}*`],
  });

  const refs: ComponentVersionRef[] = [];
  for (const line of result.stdout.toString("utf8").split("\n")) {
    if (line.length === 0) continue;
    const [ref, objectName, peeled] = line.split("\t");
    if (ref === undefined) continue;
    const parsed = parseComponentTagRef(ref);
    // A ref outside this component's namespace cannot appear under its own
    // prefix, but the parse also rejects a malformed version segment.
    if (parsed === undefined || parsed.componentId !== componentId) continue;
    if (semver.valid(parsed.version) === null) continue;
    const targetHex = peeled !== undefined && peeled.length > 0 ? peeled : objectName;
    if (targetHex === undefined || targetHex.length === 0) continue;
    refs.push({ version: parsed.version, targetHex });
  }
  return refs;
}

/**
 * The highest version assigned to one specific snap, or `undefined` when that
 * snap carries none.
 *
 * Asking about a specific snap rather than about the component as a whole is
 * what keeps the answer unambiguous: a component may carry many versions across
 * its history, but only the ones on the snap being referenced describe it.
 */
export async function readVersionAtSnap(
  store: ComponentHistoryStore,
  componentId: string,
  snapHex: string
): Promise<string | undefined> {
  const versions = (await listComponentVersionRefs(store, componentId))
    .filter((ref) => ref.targetHex === snapHex)
    .map((ref) => ref.version)
    .sort(semver.compare);
  return versions.at(-1);
}

/**
 * The next version for a component: one patch past the highest it already
 * carries, or `0.0.1` for its first.
 *
 * Patch is the default because it is the only increment that can be chosen
 * without knowing what changed. Choosing minor or major is a decision about
 * intent, which belongs to the user rather than to a derivation.
 */
export function deriveNextComponentVersion(assignedVersions: readonly string[]): string {
  const highest = assignedVersions.reduce<string | undefined>(
    (best, version) => (best === undefined || semver.gt(version, best) ? version : best),
    undefined
  );
  if (highest === undefined) return "0.0.1";

  const next = semver.inc(highest, "patch");
  if (next === null) {
    throw new ComponentHistoryError(`cannot derive a version after "${highest}"`);
  }
  return next;
}

export async function tagComponent(
  store: ComponentHistoryStore,
  input: { componentId: string; version: string; message?: string }
): Promise<ComponentTagResult> {
  const version = assertComponentVersion(input.version);
  const ref = componentTagRef(input.componentId, version);

  // Tagging never creates a snap; it names one that already exists.
  const head = await readComponentHead(store, input.componentId);
  if (head === undefined) {
    throw new ComponentHistoryError(
      `component "${input.componentId}" has no snap to tag; run "bit-lite snap" first`
    );
  }

  const existing = await readTagTarget(store, ref);
  if (existing !== undefined) {
    if (existing.hex === head.hex) {
      // Repeating the same assignment is idempotent and keeps the original tag
      // object, so the recorded tagger and timestamp stay accurate.
      return {
        componentId: input.componentId,
        version,
        status: "unchanged",
        ref,
        snapId: formatObjectId(existing),
      };
    }
    throw new ComponentHistoryError(
      `component "${input.componentId}" version ${version} already points at ${formatObjectId(existing)}; component versions are immutable`
    );
  }

  await store.run({
    args: [
      "tag",
      "--annotate",
      "--message",
      input.message ?? `${input.componentId} ${version}`,
      ref.slice("refs/tags/".length),
      head.hex,
    ],
  });

  return {
    componentId: input.componentId,
    version,
    status: "created",
    ref,
    snapId: formatObjectId(head),
  };
}

/**
 * Resolves a tag ref to the commit it names, peeling the annotated tag object.
 * Returns `undefined` when the tag does not exist.
 */
export async function readTagTarget(
  store: ComponentHistoryStore,
  ref: string
): Promise<GitObjectId | undefined> {
  const result = await store.run({
    args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    throwOnFailure: false,
  });
  if (result.exitCode !== 0) return undefined;
  return createObjectId(result.stdout.toString("utf8"), store.objectFormat);
}

/**
 * Checks that a ref found in the store really is an annotated tag naming a
 * commit. This is what catches manual edits such as a lightweight tag or a tag
 * placed on a blob.
 */
export async function assertAnnotatedTag(
  store: ComponentHistoryStore,
  ref: string
): Promise<GitObjectId> {
  const objectType = await store.run({
    args: ["cat-file", "-t", ref],
    throwOnFailure: false,
  });
  if (objectType.exitCode !== 0) {
    throw new ComponentHistoryError(`tag ${ref} does not exist`);
  }
  if (objectType.stdout.toString("utf8").trim() !== "tag") {
    throw new ComponentHistoryError(
      `tag ${ref} is not an annotated tag; component versions must be annotated tags`
    );
  }

  const target = await readTagTarget(store, ref);
  if (target === undefined) {
    throw new ComponentHistoryError(`tag ${ref} does not point at a commit`);
  }
  return target;
}

/**
 * Checks that a tag names a snap of the component it claims. Reachability from
 * that component's head is what prevents a tag from naming another component's
 * snap, whether the head is the local canonical one or a fetched remote one.
 */
export async function assertTagTargetsComponent(
  store: ComponentHistoryStore,
  input: {
    ref: string;
    target: GitObjectId;
    componentId: string;
    head: GitObjectId | undefined;
    headRef: string;
  }
): Promise<void> {
  if (input.head === undefined) {
    throw new ComponentHistoryError(
      `tag ${input.ref} names component "${input.componentId}", which has no history at ${input.headRef}`
    );
  }
  const reachable = await store.run({
    args: ["merge-base", "--is-ancestor", input.target.hex, input.head.hex],
    throwOnFailure: false,
  });
  if (reachable.exitCode !== 0) {
    throw new ComponentHistoryError(
      `tag ${input.ref} points at ${formatObjectId(input.target)}, which is not reachable from ${input.headRef}`
    );
  }
}

/**
 * Validates a tag found in the local store against that component's canonical
 * head.
 */
export async function assertValidComponentTag(
  store: ComponentHistoryStore,
  input: { componentId: string; version: string; ref: string }
): Promise<GitObjectId> {
  const target = await assertAnnotatedTag(store, input.ref);
  await assertTagTargetsComponent(store, {
    ref: input.ref,
    target,
    componentId: input.componentId,
    head: await readComponentHead(store, input.componentId),
    headRef: componentHeadRef(input.componentId),
  });
  return target;
}
