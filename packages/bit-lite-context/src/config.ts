import { readFile } from "node:fs/promises";
import path from "node:path";
import { BitLiteError } from "./utils/errors.js";
import type {
  EnvConfig,
  ResolvedEnvConfig,
  WorkspaceComponentConfig,
  WorkspaceComponentsConfig,
  WorkspaceConfig,
} from "./types/index.js";

const CONFIG_FILE = "bit-lite.json";

export async function loadConfig(workspaceRoot: string): Promise<WorkspaceConfig> {
  const configPath = path.join(workspaceRoot, CONFIG_FILE);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new BitLiteError(`could not find ${CONFIG_FILE} in ${workspaceRoot}`);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BitLiteError(`failed parsing ${CONFIG_FILE}: ${message}`);
  }

  return validateConfig(parsed);
}

export function validateConfig(value: unknown): WorkspaceConfig {
  if (!isObject(value)) throw new BitLiteError("config must be an object");
  const envs = value.envs;
  const components = value.components;
  if (!isObject(envs)) {
    throw new BitLiteError('config field "envs" must be an object');
  }
  if (Object.keys(envs).length === 0) {
    throw new BitLiteError('config field "envs" must define at least one env');
  }
  const validatedEnvs: Record<string, EnvConfig> = {};
  for (const [name, env] of Object.entries(envs)) {
    if (!isObject(env)) throw new BitLiteError(`env "${name}" must be an object`);
    const parent = env.extends;
    const services = env.services;
    if (parent !== undefined && typeof parent !== "string") {
      throw new BitLiteError(`env "${name}" field "extends" must be a string`);
    }
    if (services !== undefined && !isObject(services)) {
      throw new BitLiteError(`env "${name}" field "services" must be an object`);
    }
    validatedEnvs[name] = {
      ...(parent ? { extends: parent } : {}),
      services: services ? { ...services } : {},
    };
  }

  const validatedComponents = validateComponents(components, validatedEnvs);

  return {
    envs: validatedEnvs,
    components: validatedComponents,
  };
}

export function resolveEnvs(config: WorkspaceConfig): Record<string, ResolvedEnvConfig> {
  const resolved: Record<string, ResolvedEnvConfig> = {};
  const resolving = new Set<string>();

  const resolveOne = (name: string): ResolvedEnvConfig => {
    const existing = resolved[name];
    if (existing) return existing;
    const env = config.envs[name];
    if (!env) throw new BitLiteError(`env "${name}" is not defined`);
    if (resolving.has(name)) {
      throw new BitLiteError(`env "${name}" has a circular extends chain`);
    }

    resolving.add(name);
    const parent = env.extends ? resolveOne(env.extends) : undefined;
    resolving.delete(name);

    const result: ResolvedEnvConfig = {
      name,
      services: {
        ...(parent?.services ?? {}),
        ...(env.services ?? {}),
      },
    };
    resolved[name] = result;
    return result;
  };

  Object.keys(config.envs).forEach(resolveOne);
  return resolved;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (!isObject(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

function validateComponents(
  value: unknown,
  envs: Record<string, EnvConfig>
): WorkspaceComponentsConfig {
  if (value === undefined) return {};
  if (isStringMap(value)) {
    for (const [pattern, envName] of Object.entries(value)) {
      if (!envs[envName]) {
        throw new BitLiteError(`component pattern "${pattern}" references unknown env "${envName}"`);
      }
    }
    return { ...value };
  }
  if (!Array.isArray(value)) {
    throw new BitLiteError(
      'config field "components" must be an array of component records or an object of pattern -> env name'
    );
  }

  const paths = new Set<string>();
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!isObject(entry)) throw new BitLiteError(`component entry at index ${index} must be an object`);
    const component = {
      path: readRequiredString(entry.path, `component entry at index ${index} field "path"`),
      id: readRequiredString(entry.id, `component entry at index ${index} field "id"`),
      envName: readRequiredString(entry.envName, `component entry at index ${index} field "envName"`),
    } satisfies WorkspaceComponentConfig;
    if (!envs[component.envName]) {
      throw new BitLiteError(`component "${component.id}" references unknown env "${component.envName}"`);
    }
    if (paths.has(component.path)) throw new BitLiteError(`component path "${component.path}" is duplicated`);
    if (ids.has(component.id)) throw new BitLiteError(`component id "${component.id}" is duplicated`);
    paths.add(component.path);
    ids.add(component.id);
    return component;
  });
}

function readRequiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) throw new BitLiteError(`${label} must be a non-empty string`);
  return value;
}
