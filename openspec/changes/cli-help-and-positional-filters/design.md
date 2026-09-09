## Context

The package boundary work has landed. `args.ts` is now `packages/bit-lite/src/args.ts`, `ParsedCliArgs` is `packages/bit-lite/src/cli-args-types.ts`, and the vendor transport types — `CliArguments`, `CliOptionScalar`, `CliOptionValue` — belong to `bit-lite-utils`. Line references below are against `0dce7fa`.

`parseArgs` in `packages/bit-lite/src/args.ts` is configured once, globally, with four options: `help` (boolean, aliased `-h`), `lazy` (boolean), `workspace` (string, aliased `-w`), and `filter` (string). Everything else the CLI accepts — `--json`, `--dry-run`, `--message`, `--version`, `--from`, `--to`, `--remote`, `--host`, `--port`, `--compile`, `--detail`, `--interactive`, `--watch` — is undeclared, and reaches its command through `yargs-parser`'s default handling of unknown flags. `readCommandOptions` then strips the globals and hands the rest to the command, and for the vendor-invoking commands `createEffectiveVendorArguments` forwards that whole bag to the vendor. **Undeclared options are load-bearing**: they are how a vendor's own options reach it without the CLI knowing them.

`lazy` is the exception that proves the pattern, and it survived the package move unchanged. It is declared boolean in the global parser configuration, but it is **not** in `globalOptionNames`, so it is stripped from nothing and forwarded to every command as a command option. `validateBooleanOptionValues` then hard-codes a `--lazy=` check that runs for every invocation of every command. Only `preview` and `start` read it — `preview.ts:117` and `start.ts:99`, both through `readPreviewLazy`. The `lazy-preview-server-lifecycle` capability already requires that scoping: "The `preview` and `start` commands SHALL accept a boolean `--lazy` option." The implementation is what drifted, by declaring globally the one thing it had a per-command need to declare.

Five properties of the current code shape this design:

- **The parser now sits beside the command set, and has not yet noticed.** `args.ts` and `cli.ts` are in the same package after the boundary move, but `parseArgs` is still written as though it could not see the commands: it rejects every positional argument because, without knowing which command is running, it cannot tell a component pattern from a mistake. That constraint was structural before the move and is now merely historical.
- **`yargs-parser` needs option kinds up front.** Whether `ui/button` in `--json ui/button` is a value or a positional is decided by whether `json` was declared boolean. Today no command's options are declared, so no command could accept positionals correctly even if the rejection were lifted.
- **Nothing validates option names.** `readCommandOptions` copies whatever arrived, and `globalOptionNames` strips only the three it knows. `readFlagOption(parsed.args.options["dry-run"])` returns `false` for a `--dryrun` typo, so `snap --dryrun` performs a real recording and reports success.
- **Help is a template literal.** `printUsage` is 30 lines of hand-maintained text in `cli.ts`, already stretched past a scannable list by the four commands whose options it tries to summarize. `parsed.help` is a boolean, so `tag -h` and `-h` are indistinguishable by the time dispatch sees them.
- **Flag validation is spread across five places and disagrees with itself.** `validateBooleanOptionValues` scans argv for the literal string `--lazy=`; `readFlagOption` throws "does not take a value"; `readCompileOption` throws "does not accept a value"; `readPreviewLazy` throws "requires a boolean value"; and `compile.ts:113` and `test.ts:131` both compare `options.watch === true` with no validator at all. Because only `lazy` is declared boolean, `--lazy=true` parses to a boolean and works while `--json=true` arrives as the string `"true"` and is rejected.

The `env-service-execution` capability requires that `VendorContext.args` carry raw, options, and passthrough forms **without a positional field**. That constraint is a boundary condition for this change, not an obstacle: positional patterns are consumed into `componentFilters` during parsing and never appear in the argument record a vendor sees.

## Goals / Non-Goals

**Goals:**

- Give every command its own help, reachable three ways (`<command> -h`, `<command> --help`, `help <command>`), describing that command's options and nothing else.
- Let the ten component-selecting commands take patterns positionally, exactly equivalent to repeating `--filter`.
- Make one declaration per command the single source for both, so an option cannot be parsed one way and documented another.
- Keep undeclared options flowing to vendors on the commands that invoke vendors.
- Leave the global option set containing only options that are genuinely global, moving `--lazy` to the two commands that read it and generalizing the boolean-value check that currently names it.
- Turn a mistyped option on a command that reaches no vendor into a failure rather than a silent default.
- Keep every command's behaviour, output, and JSON shape identical once its arguments are parsed.

**Non-Goals:**

- Extending pattern syntax. `!` exclusion, `$state` filters, comma-separated lists, and bit's `pattern@version` form stay out; `--filter` and positional patterns parse identically, so if that syntax grows later it grows for both at once.
- Making `--filter` accept several values (`--filter a b c`). That requires declaring `filter` as an array, which makes it greedy and puts it in competition with positional patterns for the same bare words — a second ambiguity bought for a spelling that positional patterns already provide.
- Giving `install`, `link`, or `sync` component selection. They operate on the whole workspace; that is a behaviour change, not a spelling change.
- Replacing `yargs-parser`, or introducing a CLI framework. The declarations feed the existing parser.
- Validating option *values* in the parser. `readFlagOption` and `readTextOption` already do that per command and keep doing it; the declarations settle only whether an option takes a value at all.
- Colour, pagination, or terminal-width reflow in help output. It is plain text on stdout.

## Decisions

### 1. One declaration per command, read by both the parser and the help renderer

The two requested features are the same missing thing seen from two sides. Per-command help needs a description of each command's options; correct positional parsing needs to know which of those options take values. A single table serves both, and the coupling is the point — an option that is documented is by construction an option the parser knows.

```ts
type CommandOption = {
  kind: "flag" | "value";   // does a following bare word belong to it?
  describe: string;         // one line, rendered in help
  placeholder?: string;     // "<x.y.z>", rendered in help and in the synopsis
};

type CommandDeclaration = {
  name: string;
  summary: string;                        // one line, global command list
  description: string;                    // a paragraph, command help only
  selection: "components" | "workspace";  // does it take positional patterns?
  unknownOptions: "forward" | "reject";
  options: Record<string, CommandOption>;
  examples: string[];
  run: CommandHandler;
};
```

The `commands` record in `cli.ts` becomes this table; `printUsage` becomes a function of it. `--workspace`, `--filter`, and `--help` are declared once as globals and merged into every command.

Alternatives considered:

- **Write per-command help as static strings and keep a separate boolean-option list for the parser.** Rejected: two lists describing the same options, each able to drift, and the drift is invisible — a boolean missing from the parser list silently eats the next word, which is exactly the failure mode this change exists to prevent.
- **Adopt a CLI framework (commander, yargs full) that owns both.** Rejected: it would rewrite `CliArguments`, the thin JSON-safe transport shape `bit-lite-utils` owns and the vendor context depends on.
- **Derive declarations from the command modules by convention.** Rejected: the option reads are scattered inside command bodies (`parsed.args.options["dry-run"]` at `snap.ts:52`), and there is nothing to derive a description from.

### 2. The parser reads the declarations directly, in two passes

Before the boundary move this decision was a layering problem: `parseArgs` lived in `bit-lite-context`, which must not learn the command set, so the declarations would have had to arrive as a parameter. That merge removed the problem. `args.ts`, `cli.ts`, and the declaration table are all in `packages/bit-lite`, so the parser imports the table the way any module imports its neighbour, and no indirection is bought.

What survives is the reason for two passes, which is `yargs-parser`'s and not the package graph's: option kinds must be known before parsing can decide whether a bare word is a value or a positional, and which kinds apply depends on which command is running.

```text
pass 1   global config only  →  positional[0] is the command name
pass 2   global + that command's declared options  →  final result
```

Pass 1 can misread an undeclared option's value as the command name (`bit-lite --json snap` reads `snap` as `--json`'s value and finds no command). That is exactly today's behaviour and today's message — the command comes first, and nothing about this change alters that.

The boundary the move established is worth keeping in view while doing this. `CliArguments` — the shape that travels to vendors — belongs to `bit-lite-utils`; `ParsedCliArgs` — the shape that exists only between the parser and the command it dispatches to — belongs to `bit-lite`. Positional patterns are a CLI-side concept and are consumed on the CLI side, so they change `ParsedCliArgs.componentFilters` and never touch the transport type in the other package. Decision 4's guarantee is enforced by that split rather than by remembering it.

Alternatives considered:

- **Pass the declarations into `parseArgs` as a parameter anyway.** Rejected now that the packages agree: it is a seam with nothing on the other side of it. It was the right answer before the boundary move and is dead weight after.
- **Single pass with the union of every command's options.** Rejected: `--version` means one thing to `tag` and nothing to `compile`, and a union makes every command's help wrong about what it accepts.
- **Move the declarations back down beside a shared parser.** Rejected: it re-creates the coupling the boundary work just removed, in the package that most recently got rid of it.

### 3. `lazy` stops being global and becomes an option of the two commands that read it

`lazy` is declared in the global parser configuration and consumed by `preview` and `start` alone. That is not a global option; it is a per-command option that had nowhere else to be declared, because until now there was no per-command place. The declaration table is that place, so `lazy` moves into `preview`'s and `start`'s declarations and leaves the global configuration in `args.ts`, which then contains exactly the three options that genuinely apply everywhere: `--workspace`, `--filter`, `--help`.

This is not a new policy. `lazy-preview-server-lifecycle` already requires `--lazy` to be an option of `preview` and `start`; the code declared it globally as an implementation convenience, and the requirement stayed satisfied only because nobody else read it. The change brings the code to the requirement rather than the other way round.

`validateBooleanOptionValues` follows. It currently scans argv for the literal `--lazy=`, which is why `lazy` had to be global in the first place: the check is written against a name, so the name had to be in scope everywhere. Once options are declared by kind, the check generalizes — **any option declared `kind: "flag"` for the command being run parses `--x`, `--no-x`, and `--x=true|false`, and rejects any other `=value`** — and `lazy` no longer needs to be global for it to work.

Most flags are already validated today, but by each command separately and inconsistently. The declarations do not add validation so much as unify four spellings of it, and in doing so fix the two places where the current answers are wrong:

```text
preview --lazy / --no-lazy / --lazy=false   unchanged, now declared by preview
preview --lazy=sometimes                    unchanged error, now raised by kind
snap --lazy                                 was silently ignored; now rejected (decision 5)
snap --json=maybe                           already rejected, by readFlagOption, with a
                                            different message; now one message for every flag
snap --json=true                            wrongly rejected today — arrives as the string
                                            "true" because json is undeclared; now accepted,
                                            matching what --lazy=true already does
compile --watch=maybe                       today compiles once without watching and reports
test --watch=maybe                          success; test likewise runs once instead of
                                            watching. compile.ts:113 and test.ts:131 both
                                            compare `=== true` with no validator; now rejected
compile --lazy                              was a boolean forwarded to the vendor; now an
                                            undeclared option, still forwarded, but greedy —
                                            `compile --lazy ui/button` gives the vendor
                                            lazy="ui/button"
```

The `--json=true` and the two `--watch=maybe` lines are the only behaviour the declarations change on their own; the last line is the one worth pausing on. A vendor defining its own `--lazy` used to receive it as a boolean and now receives it as a greedy option, which is the general rule for anything the CLI has not declared. No vendor in this repository defines one, and decision 6's guard catches the case where the swallowed word names a component.

Alternatives considered:

- **Leave `lazy` in the global configuration.** Rejected: it keeps `bit-lite snap --lazy` legal and meaningless forever, it contradicts a requirement already in `openspec/specs`, and it is exactly the class of half-declared option the table exists to eliminate. Building the table and leaving the one known instance outside it would be strange.
- **Declare `lazy` globally but hide it from every help page except `preview` and `start`.** Rejected: it keeps the parse and the documentation disagreeing, which is the drift decision 1 is built to prevent.
- **Keep the hard-coded `--lazy=` check alongside the general one.** Rejected: two checks for one rule, and the general one subsumes it.

### 4. Positional patterns become component filters during parsing, and nothing downstream can tell

For a `selection: "components"` command, `parseArgs` folds positionals into `componentFilters` alongside any explicit `--filter`:

```text
snap ui/** --filter lib/math   →   componentFilters: ["lib/math", "ui/**"]
snap --filter ui/** lib/math   →   componentFilters: ["ui/**", "lib/math"]
```

Order between the two spellings is unspecified and unobservable: selection is a union, and `selectWorkspaceComponents` returns components in canonical workspace order regardless of the order patterns arrived in. Mixing the two spellings is allowed; there is no reason to forbid a union from being written two ways.

`args.raw` keeps the original argv, so `--` handling and vendor passthrough are untouched, and no `positional` field is ever added to `CliArguments` — the `env-service-execution` requirement holds without a special case.

For a `selection: "workspace"` command, a positional is an error naming the actual situation: `install` does not select components, so telling the user to write `--filter` (today's message) points at an option `install` does not have.

### 5. Undeclared options are forwarded or rejected per command, decided by whether a vendor can see them

```text
forward   compile  watch  test  preview  start  install
reject    snap  tag  status  log  diff  link  sync
```

The split is not a preference; it is where undeclared options can still mean something. The forward set reaches `createEffectiveVendorArguments`, which hands the option bag to a vendor that may define options the CLI has never heard of. The reject set never reaches a vendor, so an option nobody declared is a typo with no other possible reading.

`install` is in the forward set because `--compile` runs the compile vendors.

The reject set is where this pays for itself. `snap --dryrun` today performs a real recording and prints success; `tag --dry-run --versoin 1.2.0` today tags at the derived version. After this change both fail before anything is written, and the message lists the command's declared options — the help text, at the moment it is needed.

Alternatives considered:

- **Reject everywhere.** Rejected: it closes vendor option passthrough, which `vendor-command-execution` and `env-service-execution` both specify as open.
- **Forward everywhere (today's behaviour).** Rejected: it keeps a silent-write failure mode on precisely the commands that write.
- **Warn instead of reject.** Rejected: a warning on stdout corrupts `--json` output, and a warning on stderr is not read by the script that just silently skipped its `--dry-run`.

### 6. An undeclared option takes the following bare word, and the guard against that being a component runs after the workspace is known

On a forward command, `test --reporter ui/button` is genuinely undecidable in the parser: whether `ui/button` is `--reporter`'s value or a component depends on a vendor option the CLI cannot see. The rule is the one already in force — **an undeclared option takes the next bare word as its value** — because that is what makes the natural spelling work:

```text
test ui/button --reporter verbose      ui/button positional, reporter="verbose"     ✓
test --reporter verbose ui/button      reporter="verbose", ui/button positional     ✓
test --verbose ui/button               verbose="ui/button", no component selected   ✗ silent
```

Only the third line is wrong, and it is wrong silently. Rejecting every bare word after an undeclared option would break the second line, which is the common one, so the rule cannot be tightened in the parser.

It can be checked later, where more is known. `parseArgs` records each `{ option, value }` pair where an **undeclared** option consumed a bare word. After the workspace is loaded, the selection helper tests those values against the registered component ids; an exact match means the user almost certainly meant a component, and the command fails naming both spellings that would settle it:

```text
--verbose consumed "ui/button", which is a registered component.
Write --verbose=<value> if it is that option's value, or move ui/button
before --verbose if it is a component.
```

The check is exact-id only. A glob (`ui/**`) consumed by an undeclared option stays undetected, and that is the accepted residual: the check should never fire on a legitimate vendor value, and an id that is also a component is as strong a signal as the parser will ever get.

Alternatives considered:

- **Require `--option=value` for all undeclared options.** Rejected: breaks every existing vendor invocation.
- **Require vendor options after `--`.** Rejected: `createEffectiveVendorArguments` deliberately forwards `options` as well as `passthrough`; this would deprecate half of a specified transport.
- **Stop collecting positionals at the first undeclared option.** Rejected: it makes `test --reporter verbose ui/button` fail with no way to express it short of `--filter`, reintroducing the ceremony this change removes.

### 7. A help request is resolved before dispatch, and the three spellings produce the same text

`ParsedCliArgs.help` becomes a resolved help request rather than a boolean:

```text
bit-lite            no command, no -h   →  global list
bit-lite -h         --help              →  global list
bit-lite help                           →  global list
bit-lite tag -h     tag --help          →  tag's help
bit-lite help tag                       →  tag's help
bit-lite help nope                      →  unknown command, exit 1
```

`help` is a declared command so it appears in its own list, but the request is resolved in `runCli` before the handler table is consulted: asking for help never runs the command being asked about. `-h` wins over everything else on the line, including options the command would reject — `snap --dryrun -h` prints `snap`'s help rather than complaining about `--dryrun`, because help is what resolves the complaint.

Help goes to stdout with exit code 0; it was asked for. An unknown command goes to stderr with exit code 1 and lists the available commands.

`-h` is global, so a vendor's own `-h` cannot reach it through a forward command. That is already true today and is documented rather than changed: vendor options that collide with `-h`, `-w`, `--help`, `--workspace`, or `--filter` go after `--`.

### 8. Rendering is a pure function, so help is testable without running a command

`renderCommandHelp(declaration)` and `renderCommandList(declarations)` take declarations and return strings. Their tests assert on text, need no workspace, no store, and no vendor, and a new command that forgets a summary fails a completeness test over the table rather than being noticed in review.

The synopsis line is derived, not written:

```text
Usage: bit-lite tag [component-pattern...] [options]

  Assign immutable versions to the selected components' snaps, incrementing
  each component's patch by default.

Options:
  --interactive          choose each component's version before anything is written
  --version <x.y.z>      assign an explicit version; requires a single component
  --message <text>       replace the generated message
  --dry-run              report what would happen without writing anything
  --json                 emit structured output
  --workspace, -w <dir>  directory containing bit-lite.json (default: cwd)
  --filter <pattern>     component ID or path pattern; repeatable
  --help, -h             print this help

Examples:
  bit-lite tag
  bit-lite tag ui/** --interactive
  bit-lite tag ui/button --version 1.2.0
```

`[component-pattern...]` appears only for `selection: "components"` commands, so `install -h` does not offer a selection it will reject.

### 9. The README stops restating the option surface

The CLI overview table and the common-flags list in `README.md` are a third copy of what the declarations describe. The command table stays — it is prose about what the commands are *for*, which help does not replace — but the per-option detail is removed in favour of pointing at `bit-lite help <command>`. Prose that explains relationships between commands (the store, dependency order, projections) is untouched: it is not help text.

## Risks / Trade-offs

- **A previously-erroring invocation now succeeds.** `bit-lite compile ui/button` fails today and selects a component after this change. → Nothing that succeeded changes meaning, and the failing form has no documented use; the `compile-command` scenario asserting the failure is replaced rather than kept.
- **The reject set turns previously-ignored options into failures.** A script passing a stray `--verbose` to `status` breaks. → That is the intent, and the same mechanism removes the far worse `snap --dryrun` silent write. The forward set is unaffected, so no vendor invocation breaks.
- **A component whose id begins with `-` is unwritable positionally.** → It is unwritable today too, and `--filter` remains available for it; component ids are paths, so this is theoretical.
- **Shell glob expansion.** `snap ui/*` may be expanded by the shell before `bit-lite` sees it, matching directories rather than component ids. → The same hazard bit documents; help examples quote patterns containing wildcards, and `--filter` behaves identically, so this is not new.
- **Declarations can drift from what a command reads.** An option read in a command body but not declared keeps working on a forward command and starts failing on a reject command. → On the reject set the existing per-command tests catch it immediately. On the forward set it degrades to today's behaviour, which is the deliberate open door.
- **Two parser passes over the same argv.** → The input is tens of tokens; the cost is not measurable, and the alternative is a single union configuration that makes every command's help wrong about what it accepts.

## Migration Plan

The declarations can be introduced without changing behaviour: build the table, render help from it, and keep the positional rejection. Positional selection and the unknown-option policy then land per command, each a small independent step, with `compile` first because it is the command whose spec asserts the old rejection. No data, store, or config migration is involved, and rollback is per step.

## Open Questions

- **Should `-h` be reserved globally, or should commands be allowed to rebind it?** Reserved is assumed above and matches today. No command currently wants `-h`, so this only matters if a future one does.
- **Does `bit-lite help` alone deserve more than the command list** — a short orientation on the store, dependency order, and `--`? It is the first thing a new user sees, and the README says those things at length. Assumed: list only, with a pointer.
- **Should the exact-id ambiguity guard (decision 6) also fire on a value that looks like a pattern** — contains `/` or `*` but matches no component? It would catch a mistyped component id at the cost of firing on a vendor value that happens to be a path.
