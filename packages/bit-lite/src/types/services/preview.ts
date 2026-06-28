import type { ComponentRef, ServiceContext, ServiceInput, ServiceResult, ServiceTask } from "../index.js";

export type PreviewVendorConfig = {
  configFile?: string;
};

export type PreviewEntry = {
  id: string;
  envName: string;
  rootDir: string;
  previewFile: string;
  docsFile?: string;
};

export type PreviewVendorInput = ServiceInput<PreviewVendorConfig, unknown> & {
  entries: PreviewEntry[];
  base: string;
  port: number;
};

export type PreviewResultJson = {
  vendor: string;
  envName?: string | undefined;
  url?: string;
  port?: number;
  base?: string;
  host?: string;
  entries: PreviewEntry[];
};

export type PreviewResult = ServiceResult<PreviewResultJson> & {
  url?: string;
  port?: number;
  base?: string;
  host?: string;
  vendor?: string;
  entries?: PreviewEntry[];
};

export type PreviewArgs = {
  base?: string;
  port?: number;
};

export type PreviewVendor = {
  name: string;
  run(input: PreviewVendorInput, context?: ServiceContext): ServiceTask<PreviewResult>;
};

export type PreviewDiscoveryInput = {
  components: ComponentRef[];
  envName: string;
};
