import type { ComponentRef, ServiceContext, ServiceInput, ServiceResult, ServiceTask } from "../../types.js";

export type PreviewVendorConfig = {
  configFile?: string;
};

export type PreviewEntry = {
  id: string;
  envName: string;
  rootDir: string;
  previewFile: string;
  docsFile?: string;
  sourceFile?: string;
};

export type PreviewVendorInput = ServiceInput<PreviewVendorConfig, unknown> & {
  entries: PreviewEntry[];
  base: string;
  port: number;
};

export type PreviewResult = ServiceResult & {
  url?: string;
  port?: number;
  base?: string;
  host?: string;
};

export type PreviewVendor = {
  name: string;
  run(input: PreviewVendorInput, context?: ServiceContext): ServiceTask<PreviewResult>;
};

export type PreviewDiscoveryInput = {
  components: ComponentRef[];
  envName: string;
};
