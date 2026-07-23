import type { ParsedCliArgs } from "bit-lite-context";
import { BitLiteError } from "../utils/errors.js";
import { runCompileCommand } from "./compile.js";

export function createWatchCommandArgs(parsed: ParsedCliArgs): ParsedCliArgs {
  if (parsed.args.options.watch === false) {
    throw new BitLiteError("bit-lite watch conflicts with --no-watch");
  }
  return {
    ...parsed,
    args: {
      raw: [...parsed.args.raw],
      options: { ...parsed.args.options, watch: true },
      passthrough: [...parsed.args.passthrough],
    },
    componentFilters: [...parsed.componentFilters],
  };
}

export function runWatchCommand(parsed: ParsedCliArgs) {
  return runCompileCommand(createWatchCommandArgs(parsed));
}
