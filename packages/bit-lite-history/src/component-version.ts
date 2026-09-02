import { ComponentHistoryError } from "./errors.js";
import { getObjectIdHexLength, type GitObjectAlgorithm, type GitObjectId } from "./object-id.js";

/**
 * What: spells a component snap as a version other tooling can carry.
 *
 * Why the `g` prefix: a prerelease identifier made only of digits is a numeric
 * identifier, and semantic versioning forbids a leading zero on one. An
 * all-digit object ID would therefore produce an invalid version. Borrowing
 * `git describe`'s `g` (as in `v1.2.3-4-g9f2c3ab`) guarantees a letter is
 * always present, and it makes a generated version recognizable on sight.
 *
 * Why the complete object ID: the version resolves itself. `git rev-parse` can
 * locate the commit from the version alone, with no ambiguity that grows as
 * the store grows, and no risk that an identifier already written into a file
 * becomes ambiguous later. Display abbreviates; storage never does.
 *
 * IMPORTANT: snap versions are identifiers, not ordered versions. Semantic
 * version precedence compares prerelease text lexically, so `0.0.0-ga…` sorts
 * above `0.0.0-g9…` with no relationship to history. Sorting these, taking a
 * maximum over them, or deriving a "latest" from them all produce arbitrary
 * answers; ask the store about ancestry instead. That is why this module
 * deliberately exposes no comparison helper.
 *
 * Note the version drops the algorithm qualifier that `formatObjectId` keeps.
 * A store has exactly one object format and synchronization requires matching
 * formats, so the hex is unambiguous wherever a version is used; diagnostics
 * meant for humans should still use the qualified spelling.
 */

const snapVersionPrefix = "0.0.0-g";

/** The reserved shape. A user-supplied version matching it is refused. */
const snapVersionPattern = /^0\.0\.0-g[0-9a-f]+$/;

export function formatSnapVersion(snapId: GitObjectId): string {
  return `${snapVersionPrefix}${snapId.hex}`;
}

/**
 * Reports whether a version occupies the generated-identifier namespace. This
 * is deliberately shape-based rather than length-based, so the namespace stays
 * reserved regardless of which object format produced a given identifier.
 */
export function isSnapVersion(version: string): boolean {
  return snapVersionPattern.test(version);
}

/**
 * Recovers the object ID a snap version names, or `undefined` when the version
 * is not a snap version or its length matches no supported object format.
 */
export function parseSnapVersion(version: string): GitObjectId | undefined {
  if (!isSnapVersion(version)) return undefined;
  const hex = version.slice(snapVersionPrefix.length);
  for (const algorithm of ["sha1", "sha256"] as const satisfies readonly GitObjectAlgorithm[]) {
    if (hex.length === getObjectIdHexLength(algorithm)) return { algorithm, hex };
  }
  return undefined;
}

/** Shortens a snap version for display only; never use the result as a value. */
export function abbreviateComponentVersion(version: string, hexLength = 9): string {
  if (!isSnapVersion(version)) return version;
  return `${snapVersionPrefix}${version.slice(snapVersionPrefix.length, snapVersionPrefix.length + hexLength)}`;
}

/** Refuses a user-supplied version that would collide with a generated one. */
export function assertNotSnapVersion(version: string): void {
  if (isSnapVersion(version)) {
    throw new ComponentHistoryError(
      `"${version}" is reserved for snap identifiers that Bit Lite generates; choose a different version`
    );
  }
}
