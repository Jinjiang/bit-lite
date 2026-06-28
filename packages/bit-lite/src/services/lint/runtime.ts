import path from "node:path";
import { readObjectConfig } from "../../service-config.js";
import { serviceResult } from "../../utils/service-result.js";
import type { ComponentRef, ServiceContext } from "../../types/index.js";
import type { LintResult, LintVendorConfig } from "../../types/services/lint.js";

export function readLintVendorConfig(config: unknown): LintVendorConfig {
  const input = readObjectConfig(config);
  return {
    ...(typeof input.configFile === "string" ? { configFile: input.configFile } : {}),
    ...(Array.isArray(input.args) ? { args: input.args.filter((arg): arg is string => typeof arg === "string") } : {}),
  };
}

export function readLintArgs(args: unknown): string[] | undefined {
  if (!Array.isArray(args)) return undefined;
  return args.filter((arg): arg is string => typeof arg === "string");
}

export function createLintTargets(workspaceRoot: string, components: ComponentRef[]) {
  return components.map((component) => path.relative(workspaceRoot, component.rootDir) || ".");
}

export function createLintResult(options: {
  vendor: string;
  envName?: string | undefined;
  targets: string[];
  exitCode: number;
}): LintResult {
  const ok = options.exitCode === 0;
  const targetText = `${options.targets.length} ${options.targets.length === 1 ? "target" : "targets"}`;
  return {
    ...serviceResult({
      ok,
      toJSON: () => ({
        vendor: options.vendor,
        envName: options.envName,
        targets: options.targets,
        exitCode: options.exitCode,
      }),
      toString: () =>
        ok
          ? `${options.vendor} lint passed for ${options.envName} (${targetText})`
          : `${options.vendor} lint failed for ${options.envName} (${targetText})`,
    }),
    vendor: options.vendor,
    targets: options.targets,
    exitCode: options.exitCode,
  };
}

export function requireWorkspaceRoot(context: ServiceContext | undefined) {
  if (!context?.workspaceRoot) throw new Error("lint requires workspaceRoot in context");
  return context.workspaceRoot;
}
