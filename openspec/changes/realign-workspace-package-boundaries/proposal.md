## Why

`workspace-context-model` already requires a base phase and a resolved phase: install, link, and dependency-project generation consume the base `Workspace`, while commands needing effective env services resolve a `WorkspaceContext` afterwards. The requirement is real and load-bearing — but nothing in the module structure enforces it. Both phases are exported from one `bit-lite-context` entry point, so a base-phase command can import `loadEnvForComponent` and nothing stops it. What stands between that mistake and a broken guarantee today is a convention plus one test.

That boundary now carries far more weight than when it was written. Counting how each command actually reads the workspace:

```
base phase only, zero env resolution   snap tag sync link install status log diff
needs env resolution                   compile preview start start-source test watch
```

Eight commands versus five: the base phase is now the majority path, not the exception the requirement's wording implies. `status`, `log`, and `diff` arrived with `component-history-inspection` specifically because they could stay independent of installed packages.

`bit-lite-context` has meanwhile accumulated four kinds of code serving four different audiences — CLI argument parsing used by exactly one call site, the workspace model used by everything, env resolution used only by execution commands, and a file-discovery helper whose only consumer is a vendor package. The name is broad enough to absorb anything, which is how it got that way.

`bit-lite-history` is the counter-example worth copying: it grew from 3,888 to 5,498 lines during `component-history-inspection` and still depends on nothing but `bit-lite-utils` and `semver`. Its new `inspect.ts` contains zero workspace references. A boundary that holds under 1,600 lines of new code is a real seam, and the base/resolved split is the same kind of seam.

## What Changes

- Extract the resolved phase into its own package: `env-loader`, `env-identity`, and the `resolveWorkspace`, `groupWorkspaceComponentsByEnv`, and `getWorkspaceEnvs` helpers. It depends on `bit-lite-context` and `bit-lite-env`; since `bit-lite-env` does not depend on the workspace model, the graph stays acyclic. **BREAKING** for internal imports: execution commands import env resolution from the new package.
- Move CLI argument parsing to `packages/bit-lite`. `ParsedCliArgs` and `CliArguments` are CLI concepts with a single call site; they sit in the workspace package only because one of their fields happens to be a workspace root.
- Move the component file-discovery helper to the vendor side. Its only consumer is a vendor package, which means it is part of the vendor contract rather than workspace modelling.
- Read `.comp.json` once instead of twice. The same file is parsed by the workspace reader and again by the recording projection, with two different validators. The workspace reader will carry the parsed record forward so the projection consumes it instead of re-reading, which also makes the projection a pure in-memory transformation.
- Nothing observable changes. Every existing test must pass unmodified.

## Capabilities

### New Capabilities

None. Env resolution behavior is already specified by `env-package-loading`, and moving it between packages adds no requirement.

### Modified Capabilities

- `workspace-context-model`: the base/resolved phase requirement gains structural enforcement — the base phase lives in a package that cannot reach env resolution — and its list of base-phase consumers expands to include the recording and inspection commands.

## Impact

- Adds one workspace package for env resolution and moves roughly 574 lines into it, leaving `bit-lite-context` as the workspace model it is named for.
- `packages/bit-lite`: execution commands (`compile`, `test`, `preview`, `start`) and the two utilities that prepare them change where they import env resolution from; `cli.ts` imports argument parsing locally.
- `packages/demo-vendors`: updates one import for the file-discovery helper.
- `packages/bit-lite-context`: exposes the parsed component record so the projection stops re-reading it.
- Package manifests, TypeScript project references, and export surfaces change across the affected packages; no runtime behavior does.
- Adds a structural assertion that the base-phase package cannot reach env resolution, so the guarantee stops depending on reviewers remembering it.
