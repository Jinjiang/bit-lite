# bit-lite-utils

`bit-lite-utils` is the shared utility layer for the monorepo. Its exports are deliberately split by runtime.

## Platform-neutral entry

Import from `bit-lite-utils` for functions that can run without Node.js:

```ts
import {
  escapeHtml,
  formatError,
  isJsonObject,
  readPort,
  sanitizeFileName,
} from "bit-lite-utils";
```

The root entry covers:

- the JSON value types every JSON-safe boundary in the repository shares, and
  their validators;
- record parsing and deterministic key ordering;
- error aggregation and formatting;
- host, port, package-name, and default-export readers;
- HTML escaping, safe file names, and noun pluralization;
- exit-code formatting;
- mapping discovered component files to results.

## Node.js entry

Import from `bit-lite-utils/node` for filesystem, HTTP, terminal, and Node.js error helpers:

```ts
import {
  collectFiles,
  isNodeErrorCode,
  readJsonFile,
  toPosixPath,
} from "bit-lite-utils/node";
```

The Node.js entry also exports path normalization, extension replacement, file checks, an HTTP `listen` Promise wrapper, `sendHtml`, and interactive-terminal detection.

## Contribution rule

Keep a new helper in the root entry unless it imports a `node:*` module or depends on a Node.js-only global. This keeps the root safe for browser-adjacent packages.

Utilities should remain stateless and independent from Bit Lite workspace policy.

## Shared error type

`BitLiteError` marks an error as Bit Lite domain logic rather than a raw system
failure, so a command shows its message instead of a stack trace. It lives here
because every package raises it and none should depend on another to name the
type. A layer that wants its own failures recognizable extends it — component
history does, as `ComponentHistoryError` — rather than declaring a parallel one.

## Contribution rule for options

A helper here takes what it needs and nothing more. Adding a policy flag or a
callback so that two call sites can share one function is how these utilities
grow a surface larger than their bodies; prefer two well-named functions, or
leave the second call site with its own three lines.

## Patch formatting

`formatPatch` serializes the difference between two component file sets as a
unified diff. It has no dependencies of its own: it takes file sets and returns
text.

## Package development

```bash
pnpm --filter bit-lite-utils build
pnpm --filter bit-lite-utils typecheck
pnpm --filter bit-lite-utils test
```
