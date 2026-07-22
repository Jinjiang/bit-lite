## 1. CLI and vendor context

- [x] 1.1 Remove positional arguments from parsed CLI and `VendorContext` types while preserving raw, named-option, and passthrough inputs
- [x] 1.2 Reject unsupported bare command arguments with `--filter`/`--` guidance and update CLI/context tests and fixtures

## 2. Compiled environment artifacts

- [x] 2.1 Add source and versioned compiled environment definition types, strict validators, and flattening with inheritance/service-origin provenance
- [x] 2.2 Load compiled env JSON directly, reconstruct declaring service origins through dependency paths, and reject uncompiled generated-local definitions
- [x] 2.3 Cover compiled inheritance, identity/version validation, origin reconstruction, and generated-local failure behavior

## 3. Unified one-shot compilation

- [x] 3.1 Define and validate the compiler vendor module/input/output contract around the standard default vendor entry and vendor context
- [x] 3.2 Implement configured-service compiler planning for ordinary and env components with local env/runtime prerequisite layers and no kind-based compiler selection
- [x] 3.3 Execute one-shot compile layers with independent failure reporting and dependent blocking
- [x] 3.4 Route `install --compile` and workspace env preparation through the same one-shot compiler plan instead of fixed env materialization
- [x] 3.5 Add the bootstrap env assignment and maintained env compiler vendor in `demo-vendors`, including flattened `dist/index.json` and support-module output
- [x] 3.6 Update generated package manifests and demo workspace declarations to export/use configured compiled env artifacts

## 4. Vendor-owned compiler watch

- [x] 4.1 Extend compiler vendor conformance so its default entry supports generic long-running execution with watch enabled and validated task results
- [x] 4.2 Implement caller-owned compile watch contributions with prerequisite-layer startup, initial env readiness, idempotent disposal, and no terminal/signal ownership
- [x] 4.3 Make standalone `compile --watch` supervise the contribution once with optional interactive `ManagedTerminal` and non-interactive support
- [x] 4.4 Add a vendor-local watcher dependency/helper in `demo-vendors` with serialized rebuilds, recoverable errors, and deterministic cleanup
- [x] 4.5 Implement and test vendor-owned watch mode for the maintained TypeScript compiler
- [x] 4.6 Implement and test vendor-owned watch mode for the maintained environment compiler
- [x] 4.7 Cover contribution composition boundaries, layered startup failures, centralized shutdown, and absence of a core filesystem watcher

## 5. Documentation and verification

- [x] 5.1 Update CLI, compiler vendor, env artifact, and extension author documentation for universal configured compilation and vendor-owned watch mode
- [x] 5.2 Run focused package tests and type checks, then validate the complete workspace and OpenSpec change
- [x] 5.3 Move compile-specific contracts from `bit-lite-vendors` into a dedicated `bit-lite-compiler` package and verify dependency boundaries
- [x] 5.4 Unify compiler vendors on `meta` plus default `CompilerVendorStart`, dispatch one-shot compilation through the generic inline runner, and verify both flag-selected lifecycles
