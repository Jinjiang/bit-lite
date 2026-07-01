/**
 * What: marks an error as coming from bit-lite domain logic instead of a raw
 * system or JavaScript failure.
 *
 * Where: throw this from config loading, workspace discovery, CLI parsing, and
 * future command orchestration when the message should be shown directly to a
 * user.
 *
 * Examples:
 * - `throw new BitLiteError("config must be an object")`
 * - `throw new BitLiteError("--workspace requires a path")`
 * - `error instanceof BitLiteError` can separate expected user-facing failures
 *   from unexpected bugs.
 */
export class BitLiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BitLiteError";
  }
}
