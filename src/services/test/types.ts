import type { BitLiteService, ServiceContext, ServiceInput, ServiceResult, ServiceTask } from "../../types.js";

export type TestArgs = {
  watch?: boolean;
};

export type TestResult = ServiceResult & {
  files?: number;
  tests?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
};

export type TestVendorInput = ServiceInput<unknown, TestArgs>;

export type TestVendor = {
  name: string;
  run(input: TestVendorInput, context?: ServiceContext): ServiceTask<TestResult>;
};

export type TestService = BitLiteService<unknown, TestArgs | string[] | undefined, TestResult>;
