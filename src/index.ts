#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runCli } from "./cli.js";

export type {
  BitLiteConfig,
  BitLiteService,
  ComponentRef,
  EnvConfig,
  ServiceContext,
  ServiceFactory,
  ServiceResult,
} from "./types.js";
export { loadConfig, resolveEnvs, validateConfig } from "./config.js";
export { runService } from "./runtime.js";
export { loadWorkspace } from "./workspace.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli();
}
