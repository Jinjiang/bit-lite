import { resolveServiceSpecifier } from "bit-lite-context";
import type { JsonObject, VendorContext } from "bit-lite-vendors";

export type TestVendorConfig = {
  configFile: string;
};

export async function readTestVendorConfig(
  config: JsonObject,
  context: VendorContext
): Promise<TestVendorConfig> {
  const configFile = config.configFile;
  if (typeof configFile !== "string" || configFile.length === 0) {
    throw new Error('test vendor config must define a non-empty "configFile" string');
  }
  return {
    configFile: await resolveServiceSpecifier({
      specifier: configFile,
      source: context.service.source,
      workspaceRoot: context.workspace.rootDir,
      field: "test config.configFile",
      selectedEnv: context.env.packageName,
    }),
  };
}
