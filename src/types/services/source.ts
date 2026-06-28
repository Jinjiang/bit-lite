import type { BitLiteService, ComponentRef, ServiceContext, ServiceInput, ServiceResult, ServiceTask } from "../index.js";

export type SourceTreeFile = {
  type: "file";
  name: string;
  path: string;
  size: number;
};

export type SourceTreeDirectory = {
  type: "directory";
  name: string;
  path: string;
  children: SourceTreeNode[];
};

export type SourceTreeNode = SourceTreeDirectory | SourceTreeFile;

export type SourceComponent = ComponentRef & {
  envName?: string | undefined;
  tree: SourceTreeDirectory;
};

export type SourceResultJson = {
  envName?: string | undefined;
  components: SourceComponent[];
};

export type SourceResult = ServiceResult<SourceResultJson> & {
  components: SourceComponent[];
};

export type SourceVendorInput = ServiceInput;

export type SourceService = BitLiteService<unknown, unknown, SourceResult>;

export type SourceReader = {
  name: string;
  run(input: SourceVendorInput, context?: ServiceContext): ServiceTask<SourceResult>;
};
