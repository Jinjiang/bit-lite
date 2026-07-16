import type { JsonObject, JsonValue } from "bit-lite-vendors";

export type TestServiceResult = JsonObject & {
  mode: "run" | "watch";
  run: number;
  stats: JsonObject & {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    summary: string;
  };
  componentResults: Array<JsonObject & {
    componentId: string;
    files: string[];
    stats: JsonObject & {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      summary: string;
    };
    durationMs: number;
    errors: string[];
  }>;
  coverage?: JsonValue;
};
