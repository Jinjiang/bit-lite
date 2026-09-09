## 1. The declaration table

- [x] 1.1 Define the command declaration type in `packages/bit-lite/src/commands/declarations.ts`: name, summary, description, `selection` (`"components"` | `"workspace"`), `unknownOptions` (`"forward"` | `"reject"`), options keyed by spelling with kind/description/placeholder, and examples
- [x] 1.2 Declare the global options once — `--workspace`/`-w` (value), `--filter` (value, repeatable), `--help`/`-h` (flag) — and define how they merge into each command; the global set holds these three and nothing else
- [x] 1.3 Write a declaration for each of the thirteen commands, taking the option inventory from what each command body actually reads: `compile`/`watch` (`--watch`), `install` (`--compile`), `link`, `sync` (`--remote`), `preview`/`start` (`--host`, `--port`, `--lazy`), `test` (`--watch`), `snap` (`--message`, `--dry-run`, `--json`), `tag` (`--interactive`, `--version`, `--message`, `--dry-run`, `--json`), `status` (`--detail`, `--json`), `log` (`--json`), `diff` (`--from`, `--to`, `--json`)
- [x] 1.4 Set `selection` to `"components"` for compile, watch, test, preview, start, snap, tag, status, log, and diff, and to `"workspace"` for install, link, and sync
- [x] 1.5 Declare `--lazy` on `preview` and `start` only, and remove `lazy` from the global `boolean` list in `packages/bit-lite/src/args.ts`
- [x] 1.6 Set `unknownOptions` to `"forward"` for compile, watch, test, preview, start, and install, and to `"reject"` for snap, tag, status, log, diff, link, and sync
- [x] 1.7 Replace the `commands` record in `cli.ts` with the table, keeping each handler attached to its declaration
- [x] 1.8 Add a completeness test asserting every command has a non-empty summary and description, every declared option has a description, and every option each command body reads is declared, and no option is declared globally unless every command accepts it

## 2. Help rendering

- [x] 2.1 Implement `renderCommandList(declarations)` producing the global list from summaries alone, with no command's options expanded
- [x] 2.2 Implement `renderCommandHelp(declaration)` producing the synopsis, description, the command's options merged with the globals, and the examples
- [x] 2.3 Derive the synopsis from the declaration, including `[component-pattern...]` only for `selection: "components"` commands
- [x] 2.4 Replace `printUsage` in `cli.ts` with these renderers and delete the template literal
- [x] 2.5 Add tests asserting both renderers are pure — they run with no workspace, no store, and no vendor — and covering that `install`'s synopsis offers no positional pattern while `snap`'s does

## 3. Resolving a help request

- [x] 3.1 Replace the boolean `help` field in `packages/bit-lite/src/cli-args-types.ts` with a resolved help request that distinguishes no request, a request for the global list, and a request about a named command
- [x] 3.2 Resolve `<command> -h`, `<command> --help`, and `help <command>` to the same request, and `bit-lite`, `-h`, `--help`, and bare `help` to the global list
- [x] 3.3 Resolve the request in `runCli` before the handler table is consulted, so asking for help never runs the command
- [x] 3.4 Make a help request win over an argument the command would otherwise reject, so `snap --dryrun -h` prints help
- [x] 3.5 Write help to standard output with exit code 0, and an unknown command in `help <command>` to standard error with exit code 1 and the available command names
- [x] 3.6 Add tests for all six resolutions in the design's table, plus one asserting `tag -h` moves no ref and writes no object

## 4. Command-aware parsing

- [x] 4.1 Have `parseArgs` in `packages/bit-lite/src/args.ts` import the declaration table directly — same package, no parameter to thread
- [x] 4.2 Split parsing into two passes: pass one with the global configuration only to read the command name, pass two with the globals plus that command's declared options
- [x] 4.3 Confirm pass one leaves today's behaviour for an argv with no readable command — `bit-lite --json snap` still reports no command and prints the global list
- [x] 4.4 Configure pass two from the declaration so a `flag` option never consumes a following bare word and a `value` option always does
- [x] 4.5 Add tests that construct declarations directly and assert `--json ui/button` yields a set flag and a positional pattern, while `--message hello` yields an option value and no positional

## 5. Per-command flags and boolean values

- [x] 5.1 Replace `validateBooleanOptionValues`'s hard-coded `--lazy=` scan with a check driven by the declared option kind for the command being run, naming the option it actually saw
- [x] 5.2 Confirm `preview --lazy`, `preview --no-lazy`, and `preview --lazy=false` still parse to the same booleans they do today, and `preview --lazy=sometimes` still fails with the same meaning
- [x] 5.3 Fold the per-command flag checks into the declared-kind rule, retiring the separate wordings in `readFlagOption`, `readCompileOption`, and `readPreviewLazy`
- [x] 5.4 Add a test asserting `snap --json=true` now sets the flag, matching `--lazy=true`, instead of being rejected because the value arrives as the string "true"
- [x] 5.5 Add tests asserting `compile --watch=maybe` and `test --watch=maybe` fail, replacing today's silent one-shot runs at `compile.ts:113` and `test.ts:131`, and change both lines to read the flag through the shared reader
- [x] 5.6 Add tests asserting a non-boolean value on `--dry-run`, `--interactive`, `--detail`, and `--compile` fails with one diagnostic shape rather than four wordings
- [x] 5.7 Add a test asserting `snap --lazy` fails as unrecognized rather than being parsed and ignored
- [x] 5.8 Update the `parses lazy as a command boolean` case in `packages/bit-lite/src/args.test.ts`, which currently asserts the global declaration this step removes
- [x] 5.9 Confirm both `readPreviewLazy` call sites (`preview.ts:117`, `start.ts:99`) still resolve the same activation mode — the option's meaning does not change, only where it is declared and where it is validated

## 6. Positional component patterns

- [x] 6.1 For a `selection: "components"` command, fold positional patterns into `componentFilters` alongside any explicit `--filter`, as a union
- [x] 6.2 Keep `args.raw` as the original argv and change only `ParsedCliArgs.componentFilters`, leaving `CliArguments` in `bit-lite-utils` untouched, so the vendor context shape required by `env-service-execution` is unchanged
- [x] 6.3 For a `selection: "workspace"` command, reject positionals with a diagnostic saying the command operates on the whole workspace, and remove the `--filter` suggestion from that path
- [x] 6.4 Replace the `Unsupported positional argument is supplied` scenario in `compile-command` with positional selection, and update the case in `packages/bit-lite/src/args.test.ts` that asserts the rejection
- [x] 6.5 Add tests covering a single positional pattern, several positional patterns, a positional pattern mixed with `--filter`, and equivalence of `snap ui/button` with `snap --filter ui/button`
- [x] 6.6 Add a test asserting `compile ui/button -- --vendor-option` selects the component, passes `--vendor-option` through, and puts nothing positional in the vendor's arguments
- [x] 6.7 Add a test asserting `watch ui/button` derives the same selection as `compile --watch --filter ui/button` and leaves the original parsed values unmutated

## 7. Unknown option policy

- [x] 7.1 Reject undeclared options on a `"reject"` command before any work, with a diagnostic naming the option and listing that command's declared options
- [x] 7.2 Leave undeclared options untouched on a `"forward"` command, and confirm `createEffectiveVendorArguments` still hands them to the vendor unchanged
- [x] 7.3 Add a test asserting `snap --dryrun` fails with no object written and no ref moved, replacing today's silent real recording
- [x] 7.4 Add a test asserting `status --detials` fails rather than reporting with the detail flag unset
- [x] 7.5 Add a test asserting `test --reporter verbose` still reaches the test vendor unchanged

## 8. The swallowed-component guard

- [x] 8.1 Have `parseArgs` record each `{ option, value }` pair where an undeclared option consumed a bare word
- [x] 8.2 In `src/utils/command-selection.ts`, once the workspace is loaded, fail if any recorded value exactly matches a registered component ID
- [x] 8.3 Write the diagnostic to name the option, the consumed value, and both resolving spellings — `--option=<value>` to keep the value, or moving the pattern ahead of the option to select the component
- [x] 8.4 Add tests covering `test --verbose ui/button` failing when `ui/button` is registered, `test --reporter verbose ui/button` succeeding with both meanings intact, and a consumed value matching no component being left alone

## 9. Documentation

- [x] 9.1 Remove the per-option detail from the CLI overview and common-flags sections of `README.md`, pointing at `bit-lite help <command>` instead
- [x] 9.2 Keep the command table and the prose about the store, dependency order, and projections, which help does not replace
- [x] 9.3 Show positional selection in the README examples and state that it is equivalent to `--filter`, including quoting patterns that contain wildcards so the shell does not expand them
- [x] 9.4 Correct any README text implying `--lazy` is a common flag; it belongs with `preview` and `start`
- [x] 9.5 State that `-h`, `-w`, `--help`, `--workspace`, and `--filter` are reserved by the CLI and that a vendor option with those spellings goes after `--`
- [x] 9.6 Update `packages/bit-lite/README.md` if it restates any of the same option surface

## 10. Verification

- [x] 10.1 Run the full test suite and confirm every command's existing behaviour, output, and JSON shape is unchanged once arguments are parsed
- [x] 10.2 Run `pnpm typecheck` across the workspace, since `ParsedCliArgs.help` changed shape
- [x] 10.3 Confirm the lazy preview end-to-end tests still pass unchanged, since `--lazy` moved where it is declared but not what it means
- [x] 10.4 Exercise each command's `-h` against the demo workspace and confirm none of them performs work
