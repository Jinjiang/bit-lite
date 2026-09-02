import { isWorkspaceProtocolSpec } from "bit-lite-context";
import { isRecord } from "bit-lite-utils";
import { readJsonFile } from "bit-lite-utils/node";
import path from "node:path";
import type { PackageRef, WorkspaceComponent } from "bit-lite-context";
import { BitLiteError } from "./errors.js";

/**
 * What: derives the `.comp.json` a component commit records from workspace
 * state, instead of copying the file on disk.
 *
 * Why: `workspace:*` states a fact about the present workspace — this
 * dependency is a sibling component, develop against whatever it is right now.
 * That fact does not expire, so the working file keeps saying it, and it stays
 * the signal every other command uses to tell a local component from an npm
 * package. What a recording needs is different: the specific version the
 * component was built against. Resolving at the moment of recording is what
 * separates the two.
 *
 * The env reference is injected for the same reason. It lives in
 * `bit-lite.json` outside the component root, so a snap would otherwise carry
 * no trace of the env that decides how the component compiles and tests.
 *
 * This is a pure function of workspace state and already-settled versions. It
 * never reads installed packages, so recording stays independent of whether
 * dependencies have been installed.
 */

export const componentConfigFileName = ".comp.json";

/** Resolves a workspace package name to the version it currently carries. */
export type ComponentVersionLookup = (packageName: string) => string | undefined;

export type ProjectComponentInput = {
  component: WorkspaceComponent;
  resolveVersion: ComponentVersionLookup;
};

export type ProjectedComponentConfig = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  env: PackageRef;
  [key: string]: unknown;
};

/** Reads the authored file the projection is derived from. */
export async function readComponentConfigFile(
  component: WorkspaceComponent
): Promise<Record<string, unknown>> {
  const configPath = path.join(component.rootDir, componentConfigFileName);
  const parsed = await readJsonFile(configPath, {
    mapParseError: (error) =>
      new BitLiteError(
        `failed parsing ${componentConfigFileName} for component "${component.id}": ` +
          `${error instanceof Error ? error.message : String(error)}`
      ),
  });
  if (!isRecord(parsed)) {
    throw new BitLiteError(
      `${componentConfigFileName} for component "${component.id}" must be an object`
    );
  }
  return parsed;
}

/**
 * Builds the recorded form. Unknown fields are preserved so a projection never
 * silently drops metadata a later change adds to the authored file.
 */
export function projectComponentConfig(
  authored: Record<string, unknown>,
  input: ProjectComponentInput
): ProjectedComponentConfig {
  const { component, resolveVersion } = input;

  const projected: Record<string, unknown> = { ...authored };
  for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const declared = authored[field];
    if (declared === undefined) continue;
    if (!isRecord(declared)) {
      throw new BitLiteError(
        `${componentConfigFileName} ${field} for component "${component.id}" must be an object`
      );
    }
    projected[field] = resolveDependencyRecord(component, field, declared, resolveVersion);
  }

  projected.env = resolveEnvReference(component, resolveVersion);

  return sortObjectKeys(projected) as ProjectedComponentConfig;
}

/**
 * Serializes deterministically: identical workspace state must produce
 * identical bytes, or an unchanged component would look changed.
 */
export function serializeProjectedComponentConfig(
  projected: ProjectedComponentConfig
): Uint8Array {
  return Buffer.from(`${JSON.stringify(projected, null, 2)}\n`, "utf8");
}

export async function projectComponentConfigBytes(
  input: ProjectComponentInput
): Promise<Uint8Array> {
  const authored = await readComponentConfigFile(input.component);
  return serializeProjectedComponentConfig(projectComponentConfig(authored, input));
}

function resolveDependencyRecord(
  component: WorkspaceComponent,
  field: string,
  declared: Record<string, unknown>,
  resolveVersion: ComponentVersionLookup
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [packageName, version] of Object.entries(declared)) {
    if (typeof version !== "string") {
      throw new BitLiteError(
        `${componentConfigFileName} ${field} dependency "${packageName}" for component ` +
          `"${component.id}" must have a version string`
      );
    }
    resolved[packageName] = isWorkspaceProtocolSpec(version)
      ? requireResolvedVersion(component, packageName, resolveVersion)
      : version;
  }
  return sortObjectKeys(resolved) as Record<string, string>;
}

/**
 * An external env keeps the specifier `bit-lite.json` declares. Recording the
 * installed version instead would require a completed install, which is the
 * coupling this whole path avoids.
 */
function resolveEnvReference(
  component: WorkspaceComponent,
  resolveVersion: ComponentVersionLookup
): PackageRef {
  return {
    packageName: component.env.packageName,
    version: isWorkspaceProtocolSpec(component.env.version)
      ? requireResolvedVersion(component, component.env.packageName, resolveVersion)
      : component.env.version,
  };
}

function requireResolvedVersion(
  component: WorkspaceComponent,
  packageName: string,
  resolveVersion: ComponentVersionLookup
): string {
  const version = resolveVersion(packageName);
  if (version === undefined) {
    // Callers are expected to have refused this already; reaching it means a
    // resolution step was skipped, so fail rather than record a placeholder.
    throw new BitLiteError(
      `component "${component.id}" has no resolved version for workspace dependency "${packageName}"`
    );
  }
  return version;
}

function sortObjectKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  );
}
