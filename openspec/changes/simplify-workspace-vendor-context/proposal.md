## Why

Workspace and vendor execution currently expose several overlapping representations of the same facts. Basic config, component package metadata, loaded env state, selected groups, worker data, vendor results, result storage, and preview state repeatedly copy or reshape workspace, env, argument, and service information, making small protocol changes spread across the repository.

Bit-lite owns every layer of this stack, so it can replace those accidental conversions with two explicit workspace levels and one stable vendor context. Vendors should retain broad access to normalized workspace facts and original command arguments for future capabilities, while vendor outputs should stop echoing metadata that the parent task already owns.

## What Changes

- **BREAKING** Replace the overlapping `WorkspaceConfig` / `ComponentPackageRegistry` / `WorkspaceRuntime` public flow with a lightweight JSON-safe `Workspace` snapshot and a heavier parent-only `WorkspaceContext` that resolves installed env packages, inheritance, service origins, and execution lookups without duplicating base workspace data.
- Keep one canonical workspace component object per component. Selection and env grouping return references to those objects instead of projecting repeated `ComponentRef` variants, while maps and other indexes remain private derived implementation details.
- Introduce a versioned, JSON-safe `VendorContext` containing the base `Workspace`, full parsed command arguments, selected env identity, service name, and the declaring package origin of the effective service.
- **BREAKING** Move common env and argument facts under `VendorData.context`, retain selected components, effective service config, and optional command-specific runtime as the simple active input, and use the same context contract for test, preview, and compile vendors.
- Preserve unknown command options, raw arguments, and passthrough arguments so vendor-specific capabilities such as coverage can evolve without a matching main-program option adapter unless they affect parent-owned orchestration.
- Keep parent-side origin-aware resolution for the vendor and command-owned module fields, while exposing a serializable service origin that lets vendors resolve future vendor-specific config fields relative to the declaring env package.
- **BREAKING** Stop test, preview, and compile vendors from echoing service, vendor, env, arguments, config, component identity, or output paths already owned by the parent task. Vendor outputs contain only newly produced service data; parent task/result wrappers attach execution context and vendor identity once.
- Make result validation, watch storage, preview state, and formatted output consume the parent-owned task context plus the vendor output without reconstructing or revalidating echoed input metadata.
- Retain existing env package JSON, `extends`, local/external env identity, fixed env-component compilation, per-component ordinary compile selection, preview preparation ownership, and vendor-owned file discovery semantics.

## Capabilities

### New Capabilities

- `workspace-context-model`: Defines the lightweight canonical `Workspace`, the resolved parent-only `WorkspaceContext`, canonical component identity, private derived indexes/views, and the lifecycle between reading, preparing, and resolving a workspace.

### Modified Capabilities

- `env-service-execution`: Changes vendor input to use a stable extensible context, aligns test/preview/compile execution around it, preserves raw argument extensibility, and removes redundant vendor result echoes in favor of parent-owned task metadata.

## Impact

- Affects public types and loaders in `bit-lite-context`, including workspace/component/env runtime assembly, selection, grouping, and service-origin representation.
- Affects `bit-lite-vendors` task options, worker data, runtime generics, task/result wrappers, vendor loading boundaries, and its runtime dependency on context resolution code.
- Affects test, preview, compile, install/link preparation, result storage, preview proxy state, maintained demo vendors, fixtures, validators, documentation, and end-to-end expectations.
- Changes vendor and result contracts across the repository; maintained vendors and consumers must migrate together.
- Does not add commands, change env JSON fields, move file discovery into envs, or change the existing dependency/install/materialization semantics.
