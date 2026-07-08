import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type TestVendorConfig = {
  configFile: string;
};

export function readTestVendorConfig(config: Record<string, unknown>, workspaceRoot: string): TestVendorConfig {
  const configFile = config.configFile;
  if (typeof configFile !== "string" || configFile.length === 0) {
    throw new Error('test vendor config must define a non-empty "configFile" string');
  }

  return {
    configFile: resolveImportSpecifier(configFile, workspaceRoot),
  };
}

function resolveImportSpecifier(specifier: string, workspaceRoot: string) {
  if (isFileUrl(specifier)) return fileURLToPath(specifier);
  if (isAbsoluteUrl(specifier)) return specifier;

  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    return path.isAbsolute(specifier) ? specifier : path.resolve(workspaceRoot, specifier);
  }

  for (const root of [workspaceRoot, process.cwd()]) {
    try {
      const requireFromRoot = createRequire(path.join(root, "package.json"));
      return requireFromRoot.resolve(specifier);
    } catch {
      // Try the next resolution root.
    }
  }

  return pathToFileURL(specifier).href;
}

function isFileUrl(value: string) {
  try {
    return new URL(value).protocol === "file:";
  } catch {
    return false;
  }
}

function isAbsoluteUrl(value: string) {
  try {
    return new URL(value).protocol.length > 0;
  } catch {
    return false;
  }
}
