## Why

The CLI has thirteen commands and one page of help. `bit-lite tag -h` prints the same global list as `bit-lite -h`, so the way to learn what `--interactive` does, or that `--version` requires a single component, is to read `cli.ts` or the README. The global usage string is already carrying per-command detail it was not designed to hold — `diff`, `snap`, `status`, and `tag` each spill three or four lines of option text into a list meant to be scannable — and it grows with every option added.

Selecting components is the CLI's most repeated act, and it costs eight characters of ceremony every time. `bit-lite snap --filter ui/button` is the shape of nearly every invocation, and `--filter` carries no information: there is nothing else the bare word could have meant. Bit spells the same thing `bit snap ui/button`, and every command that selects components accepts patterns positionally.

Both are surfaces onto the same missing thing: the CLI has no machine-readable description of its own commands. Help is a hand-written string, and the parser knows only the four options it was configured with, so it cannot tell `--json ui/button` (a flag and a component) from `--message hello` (an option and its value).

## What Changes

- Every command gains `-h` / `--help`, printing that command's own synopsis, options, and examples instead of the global list. `bit-lite help` and `bit-lite help <command>` print the same text.
- Each command declares its options — name, whether it takes a value, one line of description — in one place. The help renderer and the argument parser both read that declaration, so an option is documented and parsed from the same source.
- The ten commands that select components accept component patterns as positional arguments, exactly equivalent to repeating `--filter`. `bit-lite snap ui/** lib/math` means what `bit-lite snap --filter ui/** --filter lib/math` means, and positional patterns union with any explicit `--filter`.
- Positional patterns use the pattern syntax `--filter` already has. `!` exclusion, `$state` filters, and comma-separated lists are **not** in scope; if that syntax ever grows, both spellings grow together because they parse identically.
- `install`, `link`, and `sync` do not select components, so they keep rejecting positional arguments — with a diagnostic that says so, rather than today's generic "use `--filter`" guidance which for these commands names an option they do not have.
- `--lazy` moves out of the global parser configuration and into the declarations of `preview` and `start`, the only two commands that read it. `lazy-preview-server-lifecycle` already requires that scoping; the implementation declared it globally and drifted. The global set is left holding only `--workspace`, `--filter`, and `--help`.
- Flag validation becomes one rule instead of four. Today each command checks its own flags, with three different messages, and the results disagree: `--lazy=true` is accepted while `--json=true` is rejected, purely because `lazy` is the one flag declared boolean. Declaring kinds makes every flag behave the way `lazy` already does — `--json`, `--no-json`, and `--json=false` all work, and `--json=maybe` fails with one consistent message.
- `compile --watch=maybe` currently compiles once without watching and reports success, and `test --watch=maybe` likewise runs once instead of watching: `compile.ts:113` and `test.ts:131` both compare `options.watch === true` directly instead of reading the flag through a validator. Declaring `watch` as a flag makes both fail.
- Commands that invoke vendors stay open to undeclared options, which continue to reach the vendor unchanged. Commands that never reach a vendor reject undeclared options. Today `bit-lite snap --dryrun` — one missing hyphen — silently performs a real recording; after this change it fails.
- An undeclared option keeps taking the following bare word as its value, so `bit-lite test --reporter verbose ui/button` still works. When the word it took turns out to name a registered component, the command fails rather than silently selecting nothing, and names both spellings that would settle it.
- **BREAKING**: bare arguments after a component-selecting command are now a selection instead of an error. Any script relying on that error changes behaviour; nothing that previously succeeded changes meaning.

## Capabilities

### New Capabilities

- `cli-command-surface`: the declared description of every command — its summary, its options and whether each takes a value, whether it selects components, and whether undeclared options are forwarded to a vendor — together with what that declaration produces: per-command help reached through `-h`, `--help`, and the `help` command, and the folding of positional component patterns into the same selection `--filter` produces. Covers the global command list, unknown-command and unknown-option diagnostics, and the ambiguity between an undeclared option and a positional pattern.

### Modified Capabilities

- `lazy-preview-server-lifecycle`: `--lazy` being an option of `preview` and `start` is already required; the requirement gains a scenario making it testable that no other command accepts it, which is what the implementation currently violates.
- `compile-command`: bare arguments after `compile` are component patterns rather than a parse failure. The requirement that vendor arguments carry no positional field is unchanged — positional patterns become component filters and never reach the vendor as positionals.
- `watch-command`: help is per-command as well as global, so the alias documentation requirement is satisfied by `bit-lite watch -h` and `bit-lite help watch` in addition to the global list; and `watch` accepts positional patterns like the command it aliases.

## Impact

- `packages/bit-lite/src/args.ts` — since the package boundary work landed, the parser sits beside the command set. `parseArgs` is configured with four options and rejects every positional. It gains per-command parsing knowledge by reading the declaration table beside it. `lazy` leaves the global `boolean` list, and `validateBooleanOptionValues` stops naming it.
- `packages/bit-lite/src/cli-args-types.ts` — `ParsedCliArgs.help` is a boolean; per-command help needs to know which command was asked about, including for `help <command>`. `CliArguments` in `bit-lite-utils` is untouched, so the vendor transport shape is unchanged by construction rather than by care.
- `packages/bit-lite/src/cli.ts` — the `commands` record maps name to handler and `printUsage` is a template literal. Both become views over one declaration table.
- `packages/bit-lite/src/commands/*.ts` — each command's option reads (`parsed.args.options.json`, `["dry-run"]`, `version`, `from`, `to`, `remote`, `host`, `port`, `lazy`, `compile`, `detail`, `interactive`, `message`, `watch`) are the inventory the declarations must cover. No command's behaviour changes.
- `packages/bit-lite/src/utils/vendor-execution.ts` — `createEffectiveVendorArguments` forwards the whole option bag to vendors. That path must stay open for the vendor-invoking commands.
- `README.md` — the CLI overview table and the common-flags list duplicate what the declarations will state; the README should point at `bit-lite help` rather than restate it.
- No change to the store format, to recorded metadata, to vendor context shape, or to what any command does once its arguments are parsed.
