import type { ComponentRef, ServiceContext, ServiceInput, ServiceResult, ServiceTask } from "../../types.js";

export type PreviewFramework = "html" | "react" | "vue";

export type PreviewVendorConfig = {
  framework?: PreviewFramework;
  host?: string;
  strictPort?: boolean;
};

export type PreviewEntry = {
  id: string;
  envName: string;
  framework: PreviewFramework;
  rootDir: string;
  previewFile: string;
  docsFile?: string;
  sourceFile?: string;
};

export type PreviewVendorInput = ServiceInput<PreviewVendorConfig, unknown> & {
  entries: PreviewEntry[];
  base: string;
  port: number;
  host: string;
};

export type PreviewResult = ServiceResult & {
  url?: string;
  port?: number;
  base?: string;
};

export type PreviewVendor = {
  name: string;
  run(input: PreviewVendorInput, context?: ServiceContext): ServiceTask<PreviewResult>;
};

export type PreviewDiscoveryInput = {
  components: ComponentRef[];
  envName: string;
  framework: PreviewFramework;
};
