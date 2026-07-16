import type { PackageRef, SelectedEnvIdentity } from "./types/index.js";

export function getSelectedEnvKey(
  env: Pick<SelectedEnvIdentity, "packageName" | "requestedVersion">
) {
  return JSON.stringify([env.packageName, env.requestedVersion]);
}

export function getPackageRefEnvKey(env: PackageRef) {
  return getSelectedEnvKey({
    packageName: env.packageName,
    requestedVersion: env.version,
  });
}

export function isSelectedEnvIdentity(value: unknown): value is SelectedEnvIdentity {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 3 &&
    keys.every((key) => key === "packageName" || key === "requestedVersion" || key === "installedVersion") &&
    isNonEmptyString(value.packageName) &&
    isNonEmptyString(value.requestedVersion) &&
    isNonEmptyString(value.installedVersion);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
