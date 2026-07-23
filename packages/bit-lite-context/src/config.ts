import { readFile } from "node:fs/promises";
import path from "node:path";
import { isRecord, readPackageName } from "bit-lite-utils";
import { isNodeErrorCode } from "bit-lite-utils/node";
import { BitLiteError } from "./utils/errors.js";
import type { PackageRef, WorkspaceComponentConfig, WorkspaceConfig } from "./types/index.js";

export const CONFIG_FILE = "bit-lite.json";
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export async function loadConfig(workspaceRoot: string): Promise<WorkspaceConfig> {
  const configPath = path.join(workspaceRoot, CONFIG_FILE);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      throw new BitLiteError(`could not find ${CONFIG_FILE} in ${workspaceRoot}`);
    }
    throw error;
  }

  try {
    return validateConfig(JSON.parse(raw) as unknown);
  } catch (error) {
    if (error instanceof BitLiteError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new BitLiteError(`failed parsing ${CONFIG_FILE}: ${message}`);
  }
}

export function validateConfig(value: unknown): WorkspaceConfig {
  if (!isRecord(value)) throw new BitLiteError("config must be an object");
  rejectLegacyFields(value);
  if (!Array.isArray(value.components)) {
    if (isRecord(value.components)) {
      throw new BitLiteError(
        'config field "components" must be an array; pattern-to-env component mappings are no longer supported'
      );
    }
    throw new BitLiteError('config field "components" must be an array');
  }
  if (value.components.length === 0) throw new BitLiteError('config field "components" must not be empty');

  const defaultScope = value.defaultScope === undefined
    ? undefined
    : readRequiredString(value.defaultScope, 'config field "defaultScope"');
  if (defaultScope !== undefined) assertPackageScope(defaultScope);

  const paths = new Set<string>();
  const ids = new Set<string>();
  const packageNames = new Set<string>();
  const envVersions = new Map<string, { version: string; componentId: string }>();
  const components = value.components.map((entry, index) => {
    if (!isRecord(entry)) throw new BitLiteError(`component entry at index ${index} must be an object`);
    if ("envName" in entry) {
      throw new BitLiteError(`component entry at index ${index} field "envName" is no longer supported; use "env"`);
    }
    const component: WorkspaceComponentConfig = {
      path: readRequiredString(entry.path, `component entry at index ${index} field "path"`),
      id: readRequiredString(entry.id, `component entry at index ${index} field "id"`),
      packageName: readConfigPackageName(
        entry.packageName,
        `component entry at index ${index} field "packageName"`
      ),
      env: readPackageRef(entry.env, `component entry at index ${index} env`),
    };
    assertComponentId(component.id);
    if (paths.has(component.path)) throw new BitLiteError(`component path "${component.path}" is duplicated`);
    if (ids.has(component.id)) throw new BitLiteError(`component id "${component.id}" is duplicated`);
    if (packageNames.has(component.packageName)) {
      throw new BitLiteError(`component package name "${component.packageName}" is duplicated`);
    }
    const previousEnv = envVersions.get(component.env.packageName);
    if (previousEnv && previousEnv.version !== component.env.version) {
      throw new BitLiteError(
        `env package "${component.env.packageName}" has conflicting versions "${previousEnv.version}" ` +
        `(component "${previousEnv.componentId}") and "${component.env.version}" (component "${component.id}")`
      );
    }
    paths.add(component.path);
    ids.add(component.id);
    packageNames.add(component.packageName);
    envVersions.set(component.env.packageName, { version: component.env.version, componentId: component.id });
    return component;
  });

  return {
    ...(defaultScope ? { defaultScope } : {}),
    components: components.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function readPackageRef(value: unknown, label: string): PackageRef {
  if (!isRecord(value)) throw new BitLiteError(`${label} must be an object`);
  const packageName = readConfigPackageName(
    value.packageName,
    `${label}.packageName`
  );
  const version = readRequiredString(value.version, `${label}.version`);
  if (/\s/.test(version)) throw new BitLiteError(`${label}.version must be a supported package version specifier`);
  return { packageName, version };
}

export function assertPackageName(name: string) {
  if (!packageNamePattern.test(name) || name.length > 214) {
    throw new BitLiteError(`invalid npm package name "${name}"`);
  }
}

export function isWorkspaceProtocolSpec(version: string) {
  return version.startsWith("workspace:");
}

function rejectLegacyFields(value: Record<string, unknown>) {
  const migrations: Record<string, string> = {
    envs: 'top-level "envs" is no longer supported; assign an env package on every component',
    defaultEnv: '"defaultEnv" is no longer supported; assign an env package on every component',
    envOverrides: 'workspace env overrides are no longer supported',
    env: 'workspace env overrides are no longer supported',
  };
  for (const [field, message] of Object.entries(migrations)) {
    if (field in value) throw new BitLiteError(message);
  }
}

function readConfigPackageName(value: unknown, label: string) {
  return readPackageName(value, {
    invalidTypeReason: "required-string",
    pattern: packageNamePattern,
    createError: (reason) =>
      new BitLiteError(
        reason === "required-string"
          ? `${label} must be a non-empty string`
          : `${label} must be a valid npm package name`
      ),
  });
}

function assertPackageScope(scope: string) {
  const normalized = scope.startsWith("@") ? scope.slice(1) : scope;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new BitLiteError(`invalid npm package scope "${scope}"`);
  }
}

function assertComponentId(id: string) {
  if (id.startsWith("/") || id.endsWith("/") || id.includes("//")) {
    throw new BitLiteError(`invalid component id "${id}"`);
  }
}

function readRequiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new BitLiteError(`${label} must be a non-empty string`);
  }
  return value;
}
