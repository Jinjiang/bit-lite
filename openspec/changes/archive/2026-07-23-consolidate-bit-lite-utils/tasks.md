## 1. Scaffold the shared package

- [x] 1.1 Integrate `codex/simplify-watch-shutdown-lifecycle` commit `c84c6a3` into the implementation worktree before changing utility consumers
- [x] 1.2 Create `packages/bit-lite-utils` with the repository-standard private ESM package manifest, TypeScript configuration, build/typecheck/test scripts, and `.` plus `./node` exports
- [x] 1.3 Create browser-safe root and Node-specific source entry points with no workspace runtime dependencies
- [x] 1.4 Add Vitest coverage and an import-boundary assertion proving the root entry does not import Node built-ins
- [x] 1.5 Add `bit-lite-utils: workspace:*` to each production consumer manifest and update `pnpm-lock.yaml` with pnpm

## 2. Implement browser-safe utilities

- [x] 2.1 Implement and test `isRecord`, `readStringRecord`, and `sortStringRecord`
- [x] 2.2 Implement and test recursive `isJsonValue` and `isJsonObject` with explicit finite-number and non-finite-number policies
- [x] 2.3 Implement and test `sanitizeFileName`, `escapeHtml`, and `isFileUrl`
- [x] 2.4 Implement and test generic `createComponentFileMap`, `formatExitCode`, and `throwCombinedErrors` with retain-duplicates and deduplicate policies
- [x] 2.5 Implement and test `formatError` policies for message-only, stack-preferred, and object-message-aware output
- [x] 2.6 Implement and test canonical `readHost` and `readPort` options for fallbacks, accepted input kinds, range validation, labels, and caller-provided error construction
- [x] 2.7 Implement and test code-only and recursive `isPortUnavailableError` policies
- [x] 2.8 Implement and test `readDefaultExport` package-condition resolution and consumer-controlled missing-export handling
- [x] 2.9 Implement and test `readPackageName` with explicit validation and error-construction policies

## 3. Implement Node-specific utilities

- [x] 3.1 Implement and test `isInteractiveTerminal` and `isNodeErrorCode`
- [x] 3.2 Implement and test `normalizeFilePath`, `replaceExtension`, and `toPosixPath`
- [x] 3.3 Implement and test `isFile`
- [x] 3.4 Implement and test generic `listen` event cleanup and resolution/rejection behavior
- [x] 3.5 Implement and test `sendHtml` status, content-type, and response completion behavior
- [x] 3.6 Implement and test configurable `collectFiles` policies covering all three existing traversal variants
- [x] 3.7 Implement and test `readJsonFile` with consumer-specific read-error and parse-error mapping

## 4. Establish the vendor-domain predicate

- [x] 4.1 Add one canonical `isVendorDefinition` implementation to `bit-lite-vendors` and export it from the package
- [x] 4.2 Migrate the vendor task loader to the canonical predicate and remove its local implementation
- [x] 4.3 Migrate `bit-lite-compiler` vendor module validation to the exported predicate and add regression coverage for valid and invalid metadata

## 5. Migrate foundational consumers

- [x] 5.1 Migrate `bit-lite-env` selected record and package-name helpers while preserving `BitLiteEnvConfigError` messages
- [x] 5.2 Migrate `bit-lite-context` selected record, Node error, JSON-file, string-record, file, file-URL, path, file-collection, package-name, and sorting helpers
- [x] 5.3 Migrate `bit-lite-deps` selected record and Node error helpers
- [x] 5.4 Migrate `bit-lite-compiler` selected JSON record/value/object helpers in addition to the canonical vendor predicate
- [x] 5.5 Migrate `bit-lite-proxy` selected listen, HTML response, and error-formatting helpers

## 6. Migrate preview, vendor, and CLI consumers

- [x] 6.1 Migrate `bit-lite-preview` Node preparation/runtime/proxy helpers, preserving file discovery, HTML escaping, port validation, and error messages
- [x] 6.2 Migrate the `bit-lite-preview/browser` error formatter through the browser-safe root entry and verify browser bundling remains Node-free
- [x] 6.3 Migrate `bit-lite-vendors` selected record, exit-code, error-formatting, interactive-terminal, and combined-error helpers without changing its private worker shutdown predicate
- [x] 6.4 Migrate `bit-lite` link and start-source command helpers
- [x] 6.5 Migrate `bit-lite` preview and start host/port readers to the canonical utilities while retaining `readPreviewHost` and `readPreviewPort` as compatibility delegates
- [x] 6.6 Migrate the remaining selected `bit-lite` preview, start, test command, and vendor-execution JSON, error, combined-error, terminal, and response helpers

## 7. Migrate demo production consumers

- [x] 7.1 Migrate `demo-config` record helpers
- [x] 7.2 Migrate `demo-vendors` compiler helpers for file collection, extension replacement, path conversion, records, string records, default exports, and error formatting
- [x] 7.3 Migrate `demo-vendors` previewer helpers for port errors, listening, HTML responses, filename sanitization, records, paths, and error formatting
- [x] 7.4 Migrate `demo-vendors` tester and sample production helpers for component file maps, normalized paths, JSON values, errors, terminal detection, POSIX paths, and records

## 8. Remove duplicates and verify the migration

- [x] 8.1 Remove selected local production implementations after each consumer imports its canonical implementation
- [x] 8.2 Run a repository source scan confirming no selected production duplicate remains outside `bit-lite-utils`, canonical `bit-lite-vendors`, or preview compatibility delegates
- [x] 8.3 Confirm test-only helpers, `compileOnce`, the private `isWorkerRunnerShutdownMessage` predicate, and other out-of-scope differently named duplicate groups remain unchanged
- [x] 8.4 Run `bit-lite-utils` tests, typecheck, and build with pnpm
- [x] 8.5 Run affected package tests and typechecks with pnpm
- [x] 8.6 Run workspace typecheck and build with pnpm and resolve all dependency, declaration, and lockfile issues
