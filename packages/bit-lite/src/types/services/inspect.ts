import type { BitLiteService, ServiceContext, ServiceInput, ServiceResult, ServiceTask } from "../index.js";

export type InspectVendorInput = ServiceInput;

export type InspectVendor = {
  name: string;
  run(input: InspectVendorInput, context?: ServiceContext): ServiceTask<ServiceResult>;
};

export type InspectService = BitLiteService;
