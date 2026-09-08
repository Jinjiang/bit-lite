# bit-lite-context

`bit-lite-context` turns workspace files into the normalized component data consumed by Bit Lite commands.

It is deliberately the *base* phase of workspace preparation: everything here is readable before anything is installed. Resolving a component's env needs installation, linking, and materialization to have happened first, so it lives in `bit-lite-env-resolution` instead. Keeping the two in separate packages is what makes the separation `workspace-context-model` requires structural rather than conventional — a command that must stay independent of installed packages cannot reach env resolution, because this package does not depend on it.

## Reading a workspace

`readWorkspace` validates `bit-lite.json`, reads each materialized `.comp.json` record, locates entry files, and records internal dependency edges.

```ts
import { readWorkspace } from "bit-lite-context";

const workspace = await readWorkspace(parsed.workspaceRoot);
```

This stage does not import environment packages. The returned `Workspace` is safe to serialize.

In the current prototype, fixtures provide `.comp.json` directly because the higher-level command that should generate component metadata is not implemented. The record is intended to be inspectable, read-only state rather than a long-term user-authored configuration file.

## Other public helpers

- `selectWorkspaceComponents`: apply component ID/path filters.
- `orderComponentsByPrerequisites` and `layerComponentsByPrerequisites`: order components so every component follows the workspace dependencies and env it needs.
- `writeComponentVersions`: write recorded version anchors back to `bit-lite.json`.
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
