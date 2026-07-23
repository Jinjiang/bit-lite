# bit-lite-context

`bit-lite-context` turns files and CLI arguments into the normalized workspace data consumed by Bit Lite commands.

## Processing stages

### 1. Parse arguments

`parseArgs` separates global options, command options, component filters, and arguments after `--`.

```ts
import { parseArgs } from "bit-lite-context";

const parsed = parseArgs([
  "test",
  "--workspace",
  "./workspace",
  "--filter",
  "ui/*",
  "--",
  "--coverage",
]);
```

### 2. Read the workspace

`readWorkspace` validates `bit-lite.json`, reads each materialized `.comp.json` record, locates entry files, and records internal dependency edges.

```ts
import { readWorkspace } from "bit-lite-context";

const workspace = await readWorkspace(parsed.workspaceRoot);
```

This stage does not import environment packages. The returned `Workspace` is safe to serialize.

In the current prototype, fixtures provide `.comp.json` directly because the higher-level command that should generate component metadata is not implemented. The record is intended to be inspectable, read-only state rather than a long-term user-authored configuration file.

### 3. Resolve environments

`resolveWorkspace` loads installed env packages, follows their inheritance, and records the source package for every selected service.

```ts
import {
  groupWorkspaceComponentsByEnv,
  resolveWorkspace,
} from "bit-lite-context";

const context = await resolveWorkspace(workspace);
const groups = groupWorkspaceComponentsByEnv(context);
```

For commands that resolve environments one component at a time, use `loadEnvForComponent`.

## Other public helpers

- `selectWorkspaceComponents`: apply component ID/path filters.
- `orderWorkspaceComponents`: topologically order local component dependencies.
- `findComponentFiles` and `findComponentFileTargets`: discover files for a service.
- `resolveEnvModuleSpecifier`: locate an env package.
- `resolveServiceSpecifier` and `resolveVendorSpecifier`: resolve configuration and vendor modules relative to their declaring package.
- `matchPattern`: match the workspace's simple component patterns.
- `validateConfig`: validate a parsed `bit-lite.json` value.

## File conventions

Regular entries are searched in this order:

```text
index.ts
index.tsx
index.js
index.jsx
index.mjs
index.cjs
index.esm.js
index.vue
```

Environment components use `index.json`. A `workspace:*` version in the current `.comp.json` record or in `bit-lite.json` must point to another component in the same workspace.

## Package development

```bash
pnpm --filter bit-lite-context build
pnpm --filter bit-lite-context typecheck
pnpm --filter bit-lite-context test
```
