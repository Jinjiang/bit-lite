## 1. Store lifecycle

- [x] 1.1 Initialize local history stores explicitly with reftable and report the compatible-Git requirement together with the original initialization failure.
- [x] 1.2 Verify the existing local store's ref format on mutable and read-only opens, rejecting unsupported formats without modifying the store and retaining useful Git errors.

## 2. Regression coverage

- [x] 2.1 Cover reftable initialization despite a `files` default, unsupported Git diagnostics, and unchanged existing `files` stores after rejected opens.
- [x] 2.2 Cover independent sequential and batch snaps for component keys that differ only in letter case.
- [x] 2.3 Cover case-distinct heads, tags, and private tracking refs during sync, plus publishing and importing through both remote ref backends.

## 3. Documentation and validation

- [x] 3.1 Document Git 2.45+ with reftable support, the local-store contract, unchanged base64url keys, and remote backend interoperability.
- [x] 3.2 Run the history tests, affected workspace checks, and OpenSpec validation; review the final diff for consistency with the reftable-only contract.

Validation: history (175 tests), versioning (32 tests), focused history CLI coverage (233 tests), history/dependency build, workspace typecheck, and strict OpenSpec validation passed. The full CLI suite completed 455 of 458 tests with an unexpected worker exit; isolated preview (2 tests) and start (3 tests) E2E runs passed. The PR records this full-suite limitation.
