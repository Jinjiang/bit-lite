import type { BitLiteService, ServiceContext, ServiceInput, ServiceResult, ServiceTask } from "../index.js";

export type TypecheckArgs = {
  watch?: boolean;
};

export type TypecheckDiagnostic = {
  file?: string;
  line?: number;
  column?: number;
  code?: number;
  message: string;
  severity: "error" | "warning";
};

export type TypecheckResultJson = {
  checker: string;
  runner: "process" | "api";
  envName?: string | undefined;
  files?: number;
  errors?: number;
  warnings?: number;
  diagnostics: TypecheckDiagnostic[];
};

export type TypecheckResult = ServiceResult<TypecheckResultJson>;

export type TypecheckVendorInput = ServiceInput<unknown, TypecheckArgs | string[] | undefined>;

export type TypecheckVendor = {
  name: string;
  run(input: TypecheckVendorInput, context?: ServiceContext): ServiceTask<TypecheckResult>;
};

export type TypecheckService = BitLiteService<unknown, TypecheckArgs | string[] | undefined, TypecheckResult>;
