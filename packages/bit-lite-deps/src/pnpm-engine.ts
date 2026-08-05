import { createRequire } from "node:module";
import type { InstallOptions, InstallResult, LogListener } from "@pnpm/napi";

/**
 * `@pnpm/napi` is a CommonJS native addon. Node's named-export detection only
 * finds `install` on it, so the module has to be loaded through `createRequire`
 * to get the full surface. Types still come from the package itself.
 */
type PnpmEngine = {
  install(options: InstallOptions, onLog?: LogListener): Promise<InstallResult>;
  engineVersion(): string;
};

const require = createRequire(import.meta.url);

let engine: PnpmEngine | undefined;

function loadEngine(): PnpmEngine {
  engine ??= require("@pnpm/napi") as PnpmEngine;
  return engine;
}

/** Version of the Rust engine backing the installs, for diagnostics. */
export function getPnpmEngineVersion() {
  return loadEngine().engineVersion();
}

export async function installWithPnpmEngine(options: InstallOptions, onLog?: LogListener) {
  return await loadEngine().install(options, onLog);
}

export type { InstallOptions, InstallResult, LogListener };
