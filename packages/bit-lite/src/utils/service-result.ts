import type { ServiceResult } from "../types/index.js";

export type ServiceResultOptions<JsonValue> = {
  ok: boolean;
  toJSON(): JsonValue;
  toString(): string;
  toTerminalString?(): string;
};

export function serviceResult<JsonValue>(options: ServiceResultOptions<JsonValue>): ServiceResult<JsonValue> {
  const toJSON = memoize(options.toJSON);
  const toString = memoize(options.toString);
  const result: ServiceResult<JsonValue> = {
    ok: options.ok,
    toJSON,
    toString,
  };
  const toTerminalString = options.toTerminalString;
  if (toTerminalString) {
    result.toTerminalString = memoize(toTerminalString);
  }
  return result;
}

function memoize<ReturnValue>(create: () => ReturnValue) {
  let cache: { value: ReturnValue } | undefined;
  return () => {
    cache ??= { value: create() };
    return cache.value;
  };
}
