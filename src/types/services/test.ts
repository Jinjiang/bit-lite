import type { BitLiteService, ServiceContext, ServiceInput, ServiceResult, ServiceTask } from "../index.js";

export type TestArgs = {
  watch?: boolean;
};

export type TestResultJson = {
  vendor: string;
  envName?: string | undefined;
  files?: number;
  tests?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  durationMs?: number;
  suites?: TestSuiteResultJson[];
  error?: string;
};

export type TestSuiteResultJson = {
  file: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  tests: TestCaseResultJson[];
  failureMessage?: string;
};

export type TestCaseResultJson = {
  title: string;
  fullName: string;
  status: string;
  durationMs?: number;
  failureMessages?: string[];
};

export type TestResult = ServiceResult<TestResultJson> & {
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
