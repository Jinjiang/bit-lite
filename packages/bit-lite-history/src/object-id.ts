import { ComponentHistoryError } from "./errors.js";

/**
 * Git object hash algorithms Bit Lite understands. The store reports its own
 * format through `rev-parse --show-object-format`; nothing here assumes SHA-1.
 */
export type GitObjectAlgorithm = "sha1" | "sha256";

const hexLengthByAlgorithm: Record<GitObjectAlgorithm, number> = {
  sha1: 40,
  sha256: 64,
};

const algorithmByHexLength = new Map<number, GitObjectAlgorithm>([
  [40, "sha1"],
  [64, "sha256"],
]);

/** A Git object ID together with the algorithm that produced it. */
export type GitObjectId = {
  algorithm: GitObjectAlgorithm;
  hex: string;
};

export function isGitObjectAlgorithm(value: string): value is GitObjectAlgorithm {
  return value === "sha1" || value === "sha256";
}

export function getObjectIdHexLength(algorithm: GitObjectAlgorithm): number {
  return hexLengthByAlgorithm[algorithm];
}

/**
 * Parses raw Git output, which never carries the algorithm, using the object
 * format the store reported.
 */
export function createObjectId(hex: string, algorithm: GitObjectAlgorithm): GitObjectId {
  const normalized = hex.trim().toLowerCase();
  assertHex(normalized, algorithm, normalized);
  return { algorithm, hex: normalized };
}

/**
 * Parses the algorithm-qualified form Bit Lite reports to users and stores in
 * structured results, such as `sha1:1a2b...`.
 */
export function parseObjectId(value: string): GitObjectId {
  const separator = value.indexOf(":");
  if (separator === -1) {
    const bare = value.trim().toLowerCase();
    const inferred = algorithmByHexLength.get(bare.length);
    if (inferred === undefined) {
      throw new ComponentHistoryError(
        `object id "${value}" is not algorithm-qualified and its length matches no known Git object format`
      );
    }
    assertHex(bare, inferred, value);
    return { algorithm: inferred, hex: bare };
  }

  const algorithm = value.slice(0, separator);
  const hex = value.slice(separator + 1).toLowerCase();
  if (!isGitObjectAlgorithm(algorithm)) {
    throw new ComponentHistoryError(
      `object id "${value}" uses unsupported object format "${algorithm}"`
    );
  }
  assertHex(hex, algorithm, value);
  return { algorithm, hex };
}

/** Renders the algorithm-qualified form used in every external report. */
export function formatObjectId(objectId: GitObjectId): string {
  return `${objectId.algorithm}:${objectId.hex}`;
}

export function objectIdsEqual(left: GitObjectId, right: GitObjectId): boolean {
  return left.algorithm === right.algorithm && left.hex === right.hex;
}

/**
 * The all-zero object ID, used as the expected old value when a ref must not
 * already exist in an `update-ref` transaction.
 */
export function nullObjectId(algorithm: GitObjectAlgorithm): GitObjectId {
  return { algorithm, hex: "0".repeat(hexLengthByAlgorithm[algorithm]) };
}

export function isNullObjectId(objectId: GitObjectId): boolean {
  return /^0+$/.test(objectId.hex);
}

function assertHex(hex: string, algorithm: GitObjectAlgorithm, original: string): void {
  const expected = hexLengthByAlgorithm[algorithm];
  if (hex.length !== expected) {
    throw new ComponentHistoryError(
      `object id "${original}" must have ${expected} hex characters for ${algorithm}, found ${hex.length}`
    );
  }
  if (!/^[0-9a-f]+$/.test(hex)) {
    throw new ComponentHistoryError(`object id "${original}" contains non-hex characters`);
  }
}
