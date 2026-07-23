import type {
  CliArguments,
  EnvContext,
  PackageLocation,
  Workspace,
} from "bit-lite-context";
import type { VendorContext } from "./types/index.js";

/**
 * Projects parent-only resolved state into the stable, JSON-safe vendor boundary.
 * Only the selected env identity and declaring service origin are retained;
 * the full EnvContext and ResolvedService contain resolution state and service
 * definitions that must not cross the vendor transport boundary.
 */
export function createVendorContext(options: {
  workspace: Workspace;
  args: CliArguments;
  env: EnvContext;
  service: {
    name: string;
    source: PackageLocation;
  };
}): VendorContext {
  return {
    version: 1,
    workspace: options.workspace,
    args: options.args,
    env: options.env.env,
    service: {
      name: options.service.name,
      source: options.service.source,
    },
  };
}
