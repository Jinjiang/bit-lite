import type { BitLiteService, ServiceContext, ServiceInput, ServiceResult, ServiceTask } from "../index.js";

export type LintArgs = string[] | undefined;

export type LintVendorConfig = {
  configFile?: string;
  args?: string[];
};

export type LintResultJson = {
  vendor: string;
  envName?: string | undefined;
  targets: string[];
  exitCode: number;
};

export type LintResult = ServiceResult<LintResultJson> & {
  vendor: string;
  targets: string[];
  exitCode: number;
};

export type LintVendorInput = ServiceInput<unknown, LintArgs>;

export type LintVendor = {
  name: string;
  run(input: LintVendorInput, context?: ServiceContext): ServiceTask<LintResult>;
};

export type LintService = BitLiteService<unknown, LintArgs, LintResult>;
