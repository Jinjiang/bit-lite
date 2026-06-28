#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCli } from "./cli.js";

export type {
  BitLiteConfig,
  BitLiteService,
  ComponentRef,
  EnvConfig,
  ServiceContext,
  ServiceInput,
  ServiceResult,
  ServiceTask,
} from "./types/index.js";
export type {
  LintArgs,
  LintResult,
  LintResultJson,
  LintService,
  LintVendor,
  LintVendorConfig,
  LintVendorInput,
} from "./types/services/lint.js";
export type {
  SourceComponent,
  SourceResult,
  SourceResultJson,
  SourceTreeDirectory,
  SourceTreeFile,
  SourceTreeNode,
} from "./types/services/source.js";
export { loadConfig, resolveEnvs, validateConfig } from "./context/config.js";
export { fileHasKind, findFilesByKind, findFirstFileByKind } from "./utils/file-matcher.js";
export { runService } from "./runtime.js";
export { loadWorkspace } from "./context/workspace.js";

if (isCliEntryPoint()) {
  process.exitCode = await runCli();
}

function isCliEntryPoint() {
  const entryPath = process.argv[1];
  if (!entryPath) return false;

  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(entryPath).href;
  }
}
