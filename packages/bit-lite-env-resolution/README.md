# bit-lite-env-resolution

`bit-lite-env-resolution` is the resolved phase of workspace preparation. It
loads a component's env package, resolves its inheritance chain and effective
services, and derives the views that need those facts.

It is separate from `bit-lite-context` because the two phases have different
prerequisites. The base workspace model reads `bit-lite.json` and component
metadata from disk and needs nothing installed; resolving an env requires
installation, linking, and env materialization to have happened first.
`workspace-context-model` requires that separation, and keeping the packages
apart is what enforces it: a command that must not depend on installed
packages cannot reach this one, because it does not depend on it.

## Resolving a workspace

`resolveWorkspace` loads installed env packages, follows their inheritance, and records the source package for every selected service.

```ts
import { groupWorkspaceComponentsByEnv, resolveWorkspace } from "bit-lite-env-resolution";

const context = await resolveWorkspace(workspace);
const groups = groupWorkspaceComponentsByEnv(context, selected);
```

For commands that resolve environments one component at a time, use `loadEnvForComponent`.

## Other public helpers

- `resolveServiceSpecifier` and `resolveVendorSpecifier`: resolve configuration and vendor modules relative to their declaring package, from the serializable service origin alone.
- `getSelectedEnvKey`, `getPackageRefEnvKey`, and `isSelectedEnvIdentity`: identity helpers for a selected env.
- `getWorkspaceEnvs`: the unique env contexts a resolved workspace uses.

## Package development

```bash
pnpm --filter bit-lite-env-resolution build
pnpm --filter bit-lite-env-resolution typecheck
pnpm --filter bit-lite-env-resolution test
```

