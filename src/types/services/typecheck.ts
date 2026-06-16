import type { BitLiteService, ServiceContext, ServiceInput, ServiceResult, ServiceTask } from "../index.js";

export type TypecheckArgs = {
  watch?: boolean;
};

export type TypecheckResult = ServiceResult & {
  diagnostics?: Array<{
    file?: string;
    line?: number;
    column?: number;
    message: string;
    severity: "error" | "warning";
  }>;
};

export type TypecheckVendorInput = ServiceInput<unknown, TypecheckArgs | string[] | undefined>;

export type TypecheckVendor = {
  name: string;
  run(input: TypecheckVendorInput, context?: ServiceContext): ServiceTask<TypecheckResult>;
};

export type TypecheckService = BitLiteService<unknown, TypecheckArgs | string[] | undefined, TypecheckResult>;
