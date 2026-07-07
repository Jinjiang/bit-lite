import type { CliArguments } from "bit-lite-context";
import type { JsonObject } from "bit-lite-vendors";

export type TestServiceResult = {
  service: "test";
  envName: string;
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
