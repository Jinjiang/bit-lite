import type { CliArguments, SelectedEnvIdentity } from "bit-lite-context";
import type { JsonObject } from "bit-lite-vendors";

export type TestServiceResult = {
  service: "test";
  env: SelectedEnvIdentity;
  vendor: string;
  mode: "run" | "watch";
  run: number;
  componentIds: string[];
  args: CliArguments;
  config: JsonObject;
  total: number;
  passed: number;
  failed: number;
  summary: string;
};
