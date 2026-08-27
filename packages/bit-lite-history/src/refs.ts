import { ComponentHistoryError } from "./errors.js";

/**
 * What: translates canonical component IDs into ref path segments and back.
 *
 * Why: component IDs are user-controlled and may contain `/`, `..`, spaces, or
 * other punctuation that Git either rejects or interprets as ref structure.
 * Unpadded base64url is reversible, collision-free, and its alphabet
 * (`A-Z a-z 0-9 - _`) cannot express any ref separator, so a decoded ID can
 * never escape the namespace it was encoded into.
 */

export const componentHeadRefPrefix = "refs/heads/components/";
export const componentTagRefPrefix = "refs/tags/components/";
export const remoteTrackingRefPrefix = "refs/bit-lite/remotes/";

const base64urlPattern = /^[A-Za-z0-9_-]+$/;

/** Ref path segments are restricted to what `git check-ref-format` accepts. */
const versionSegmentPattern = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

const remoteNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function encodeComponentKey(componentId: string): string {
  assertComponentId(componentId);
  return Buffer.from(componentId, "utf8").toString("base64url");
}

export function decodeComponentKey(componentKey: string): string {
  if (!base64urlPattern.test(componentKey)) {
    throw new ComponentHistoryError(
      `component key "${componentKey}" is not unpadded base64url`
    );
  }
  const decoded = Buffer.from(componentKey, "base64url").toString("utf8");
  // base64url decoding accepts inputs that do not round-trip, so verify the
  // encoding is canonical before trusting the decoded component ID.
  if (Buffer.from(decoded, "utf8").toString("base64url") !== componentKey) {
    throw new ComponentHistoryError(
      `component key "${componentKey}" is not a canonical encoding of a component id`
    );
  }
  assertComponentId(decoded);
  return decoded;
}

export function componentHeadRef(componentId: string): string {
  return `${componentHeadRefPrefix}${encodeComponentKey(componentId)}`;
}

export function componentTagRef(componentId: string, version: string): string {
  assertVersionSegment(version);
  return `${componentTagRefPrefix}${encodeComponentKey(componentId)}/${version}`;
}

export function remoteComponentHeadRef(remote: string, componentId: string): string {
  assertRemoteName(remote);
  return `${remoteTrackingRefPrefix}${remote}/components/${encodeComponentKey(componentId)}`;
}

export function remoteComponentTagRef(
  remote: string,
  componentId: string,
  version: string
): string {
  assertRemoteName(remote);
  assertVersionSegment(version);
  return `${remoteTrackingRefPrefix}${remote}/tags/${encodeComponentKey(componentId)}/${version}`;
}

/** Fetch refspec mapping remote component heads into private tracking refs. */
export function componentHeadFetchRefspec(remote: string): string {
  assertRemoteName(remote);
  return `+${componentHeadRefPrefix}*:${remoteTrackingRefPrefix}${remote}/components/*`;
}

/** Fetch refspec mapping remote component tags into private tracking refs. */
export function componentTagFetchRefspec(remote: string): string {
  assertRemoteName(remote);
  return `+${componentTagRefPrefix}*:${remoteTrackingRefPrefix}${remote}/tags/*`;
}

export type ParsedComponentHeadRef = {
  ref: string;
  componentId: string;
};

export type ParsedComponentTagRef = ParsedComponentHeadRef & {
  version: string;
};

/** Returns `undefined` for refs outside the namespace; throws for malformed ones inside it. */
export function parseComponentHeadRef(ref: string): ParsedComponentHeadRef | undefined {
  if (!ref.startsWith(componentHeadRefPrefix)) return undefined;
  const componentKey = ref.slice(componentHeadRefPrefix.length);
  if (componentKey.includes("/")) {
    throw new ComponentHistoryError(
      `component head ref "${ref}" must have exactly one path segment after ${componentHeadRefPrefix}`
    );
  }
  return { ref, componentId: decodeComponentKey(componentKey) };
}

/** Returns `undefined` for refs outside the namespace; throws for malformed ones inside it. */
export function parseComponentTagRef(ref: string): ParsedComponentTagRef | undefined {
  if (!ref.startsWith(componentTagRefPrefix)) return undefined;
  const remainder = ref.slice(componentTagRefPrefix.length);
  const separator = remainder.indexOf("/");
  if (separator === -1) {
    throw new ComponentHistoryError(
      `component tag ref "${ref}" must be ${componentTagRefPrefix}<component-key>/<version>`
    );
  }
  const componentKey = remainder.slice(0, separator);
  const version = remainder.slice(separator + 1);
  if (version.includes("/")) {
    throw new ComponentHistoryError(
      `component tag ref "${ref}" must have exactly one version segment`
    );
  }
  assertVersionSegment(version);
  return { ref, componentId: decodeComponentKey(componentKey), version };
}

/**
 * Uses code points rather than a character-class range so the guard stays
 * readable and cannot be broken by an unprintable literal in the source.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint < 0x20 || codePoint === 0x7f) return true;
  }
  return false;
}

/** Returns `undefined` outside the namespace; throws for malformed refs inside it. */
export function parseRemoteComponentHeadRef(
  remote: string,
  ref: string
): ParsedComponentHeadRef | undefined {
  assertRemoteName(remote);
  const prefix = `${remoteTrackingRefPrefix}${remote}/components/`;
  if (!ref.startsWith(prefix)) return undefined;
  const componentKey = ref.slice(prefix.length);
  if (componentKey.includes("/")) {
    throw new ComponentHistoryError(
      `tracking ref "${ref}" must have exactly one path segment after ${prefix}`
    );
  }
  return { ref, componentId: decodeComponentKey(componentKey) };
}

/** Returns `undefined` outside the namespace; throws for malformed refs inside it. */
export function parseRemoteComponentTagRef(
  remote: string,
  ref: string
): ParsedComponentTagRef | undefined {
  assertRemoteName(remote);
  const prefix = `${remoteTrackingRefPrefix}${remote}/tags/`;
  if (!ref.startsWith(prefix)) return undefined;
  const remainder = ref.slice(prefix.length);
  const separator = remainder.indexOf("/");
  if (separator === -1) {
    throw new ComponentHistoryError(
      `tracking ref "${ref}" must be ${prefix}<component-key>/<version>`
    );
  }
  const componentKey = remainder.slice(0, separator);
  const version = remainder.slice(separator + 1);
  if (version.includes("/")) {
    throw new ComponentHistoryError(`tracking ref "${ref}" must have exactly one version segment`);
  }
  assertVersionSegment(version);
  return { ref, componentId: decodeComponentKey(componentKey), version };
}

function assertComponentId(componentId: string): void {
  if (componentId.length === 0) {
    throw new ComponentHistoryError("component id must not be empty");
  }
  // Control characters cannot appear in a canonical workspace component ID and
  // would survive base64url round-tripping into diagnostics and Git messages.
  if (hasControlCharacter(componentId)) {
    throw new ComponentHistoryError(
      `component id "${componentId}" must not contain control characters`
    );
  }
}

function assertVersionSegment(version: string): void {
  if (!versionSegmentPattern.test(version) || version.endsWith(".lock")) {
    throw new ComponentHistoryError(
      `version "${version}" is not usable as a Git ref path segment`
    );
  }
}

function assertRemoteName(remote: string): void {
  if (!remoteNamePattern.test(remote) || remote.endsWith(".lock")) {
    throw new ComponentHistoryError(`remote name "${remote}" is not a valid Git remote name`);
  }
}
