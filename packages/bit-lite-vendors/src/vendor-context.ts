import type { Workspace } from "bit-lite-context";
import type { CliArguments } from "bit-lite-utils";
import type { EnvContext, PackageLocation } from "bit-lite-env-resolution";
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
    env: options.env.identity,
    service: {
      name: options.service.name,
      source: options.service.source,
    },
  };
}
