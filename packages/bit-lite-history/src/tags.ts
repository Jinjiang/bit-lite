import semver from "semver";
import { readComponentHead } from "./commits.js";
import { ComponentHistoryError } from "./errors.js";
import { createObjectId, formatObjectId, type GitObjectId } from "./object-id.js";
import { componentHeadRef, componentTagRef } from "./refs.js";
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
 * Strict validation: a component tag must be an exact semantic version, so
 * ranges, `v` prefixes, and loose spellings such as `1.0` are all rejected.
 */
export function assertComponentVersion(version: string): string {
  const parsed = semver.parse(version, { loose: false });
  // `parsed.version` drops build metadata, so the canonical spelling is rebuilt
  // before comparing. Requiring an exact round trip is what rejects `v1.2.3`,
  // `1.2`, and anything with surrounding whitespace.
  const canonical =
    parsed === null
      ? undefined
      : parsed.build.length > 0
        ? `${parsed.version}+${parsed.build.join(".")}`
        : parsed.version;

  if (canonical !== version) {
    throw new ComponentHistoryError(
      `"${version}" is not a strict semantic version, for example 1.2.3 or 1.2.3-rc.1`
    );
  }
  return canonical;
}

export async function tagComponent(
  store: ComponentHistoryStore,
  input: { componentId: string; version: string }
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
      `${input.componentId} ${version}`,
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
