## 1. Baseline

- [x] 1.1 Record the pre-move results of `pnpm build`, `pnpm typecheck`, and every package's test suite, so the post-move run can be compared against a known-good baseline rather than against expectations
- [x] 1.2 Note which suites are already flaky, so a pre-existing failure is not mistaken for a regression introduced by the move

## 2. Create the env-resolution package

- [x] 2.1 Add the package directory with its manifest declaring `bit-lite-context` and `bit-lite-env` as dependencies, matching the conventions of the existing workspace packages
- [x] 2.2 Add its TypeScript configuration and build script, and wire it into the workspace build and typecheck runs
- [x] 2.3 Add its vitest configuration so the tests moving into it keep running

## 3. Move the resolved phase

- [x] 3.1 Move `env-loader.ts` and `env-identity.ts` into the new package unchanged, along with their tests
- [x] 3.2 Move `resolveWorkspace`, `groupWorkspaceComponentsByEnv`, and `getWorkspaceEnvs` out of `bit-lite-context`'s `workspace.ts` into the new package, leaving `readWorkspace` and `selectWorkspaceComponents` behind
- [x] 3.3 Move the resolved-phase types (`WorkspaceContext`, `ComponentContext`, `EnvContext`, `WorkspaceEnvGroup`, `ResolvedService`, `ResolvedServices`, `SelectedEnvIdentity`, and the package identity and location types they need) to whichever package owns them after the split, keeping base-phase types in `bit-lite-context`
- [x] 3.4 Update both packages' export surfaces so each exports only what it owns
- [x] 3.5 Repoint `packages/bit-lite`'s execution commands and the `utils/prepare-workspace.ts` and `utils/vendor-execution.ts` helpers at the new package
- [x] 3.6 Move any workspace test that exercises resolution rather than the base model, and confirm the remaining `bit-lite-context` tests construct no env fixtures

## 4. Move argument parsing to the CLI

- [x] 4.1 Move `args.ts` and its tests into `packages/bit-lite`
- [x] 4.2 Move `CliArguments`, `CliOptionScalar`, `CliOptionValue`, and `ParsedCliArgs` with it, and repoint every command and utility that imports those types
- [x] 4.3 Repoint `cli.ts` at the local parser and drop the export from `bit-lite-context`

## 5. Move file discovery to the vendor side

- [x] 5.1 Move `component-files.ts` and its tests to the vendor-facing package, keeping the exported names so the contract is unchanged
- [x] 5.2 Repoint `packages/demo-vendors/src/testers/files.ts` and drop the export from `bit-lite-context`

## 6. Read `.comp.json` once

- [x] 6.1 Carry the parsed component record on `WorkspaceComponent`, produced by the single read `readComponentPackageConfig` already performs
- [x] 6.2 Consume that record in the recording projection and delete its own file read, so the projection becomes a pure in-memory transformation
- [x] 6.3 Keep the projection's existing validation of dependency records, since the workspace reader's validation and the projection's serve different purposes
- [x] 6.4 Add or adjust unit tests so the projection is exercised without touching the filesystem

## 7. Assert the boundary structurally

- [x] 7.1 Add an assertion that the base workspace model package declares no dependency on the env-resolution package, and that env resolution declares the base model
- [x] 7.2 Make the assertion read the package manifests rather than sampling imports, so it states the claim where the claim lives
- [x] 7.3 Confirm `history-independence.test.ts` still passes, and consider whether the structural assertion now makes part of it redundant rather than deleting it silently

## 8. Verification

- [x] 8.1 Run the full `pnpm build` and `pnpm typecheck` and confirm both are clean
- [x] 8.2 Run every package's test suite and confirm the results match the section 1 baseline exactly, with no test edited to accommodate the move
- [x] 8.3 Confirm the recording and inspection commands still run against the demo workspace with nothing installed
- [x] 8.4 Exercise the demo workspace end to end — install, link, compile, snap, tag, status, log, diff — and confirm behavior is unchanged
- [x] 8.5 Update the README's package table and any documentation naming `bit-lite-context` as the home of env resolution or argument parsing
