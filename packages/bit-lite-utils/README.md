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

- JSON-compatible value validation;
- record parsing and deterministic key ordering;
- error aggregation and formatting;
- host, port, package-name, and default-export readers;
- HTML escaping and safe file names;
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

## Package development

```bash
pnpm --filter bit-lite-utils build
pnpm --filter bit-lite-utils typecheck
pnpm --filter bit-lite-utils test
```
