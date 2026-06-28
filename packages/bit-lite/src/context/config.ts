import { readFile } from "node:fs/promises";
import path from "node:path";
import { BitLiteError } from "../utils/errors.js";
import type { BitLiteConfig, EnvConfig, ResolvedEnvConfig } from "../types/index.js";

const CONFIG_FILE = "bit-lite.json";

export async function loadConfig(workspaceRoot: string): Promise<BitLiteConfig> {
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

export function validateConfig(value: unknown): BitLiteConfig {
  if (!isObject(value)) throw new BitLiteError("config must be an object");
  const defaultEnv = value.defaultEnv;
  const envs = value.envs;
  const components = value.components;
  if (typeof defaultEnv !== "string" || !defaultEnv) {
    throw new BitLiteError('config field "defaultEnv" must be a non-empty string');
  }
  if (!isObject(envs)) {
    throw new BitLiteError('config field "envs" must be an object');
  }
  if (!isObject(envs[defaultEnv])) {
    throw new BitLiteError(`defaultEnv "${defaultEnv}" is not defined in envs`);
  }
  if (components !== undefined && !isStringMap(components)) {
    throw new BitLiteError('config field "components" must be an object of pattern -> env name');
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

  for (const [pattern, envName] of Object.entries(components ?? {})) {
    if (!validatedEnvs[envName]) {
      throw new BitLiteError(`component pattern "${pattern}" references unknown env "${envName}"`);
    }
  }

  return {
    defaultEnv,
    envs: validatedEnvs,
    components: components ? { ...components } : {},
  };
}

export function resolveEnvs(config: BitLiteConfig): Record<string, ResolvedEnvConfig> {
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
