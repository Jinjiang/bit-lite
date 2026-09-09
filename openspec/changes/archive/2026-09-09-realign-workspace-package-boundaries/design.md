## Context

`bit-lite-context` is 2,752 lines holding four kinds of code with four different audiences:

| Content | Lines | Consumers |
| --- | --- | --- |
| `args.ts` | 131 | `packages/bit-lite/src/cli.ts`, one call site |
| `config.ts`, `workspace.ts`, `component-graph.ts` | ~580 | every command |
| `env-loader.ts`, `env-identity.ts` | 574 | only `compile`, `test`, `preview`, `start`, through `utils/prepare-workspace.ts` and `utils/vendor-execution.ts` |
| `component-files.ts` | 45 | only `packages/demo-vendors/src/testers/files.ts` |

The third row is the one that matters. `workspace-context-model` already requires the base and resolved phases to be distinct, and the whole recording and inspection surface depends on that distinction: `snap` deliberately calls `readWorkspace` rather than `resolveWorkspace`, and `status`, `log`, and `diff` followed it for the same reason. Counting actual usage, eight commands stay in the base phase and five need env resolution.

Nothing structural holds that line. Both phases are exported from one entry point, so the guarantee rests on a convention plus `history-independence.test.ts`. A test catches the mistake after it is written; a package boundary prevents writing it.

`bit-lite-history` shows the alternative working. It grew from 3,888 to 5,498 lines during `component-history-inspection`, gained a whole read-only inspection surface, and still declares only `bit-lite-utils` and `semver`; its new `inspect.ts` contains no workspace references at all. That boundary was never enforced by a test — it holds because the package simply cannot see the other side.

## Goals / Non-Goals

**Goals:**

- Make the base/resolved phase separation a fact about the module graph rather than a convention.
- Leave `bit-lite-context` holding the workspace model it is named for.
- Put argument parsing and the vendor file helper with the code that actually consumes them.
- Parse `.comp.json` once per component per operation instead of twice.
- Change no observable behavior: every existing test passes unmodified.

**Non-Goals:**

- Introducing the versioning package for the projection, recording, and inspection code. That is the companion change, and it should land after this one so its dependency declaration can name the base-phase package alone.
- Touching `bit-lite-history`. It is already clean and this change gives it nothing to do.
- Renaming `bit-lite-context`. Once env resolution leaves, the name is a better fit than it is today; a rename is pure churn and can happen whenever someone wants it.
- Touching `utils/vendor-execution.ts`. At 649 lines it is the largest thing in `utils`, but it is vendor task orchestration — a different domain with a different fix.
- Changing what env resolution does. `env-package-loading` specifies the behavior and none of its requirements move.

## Decisions

### 1. Split along the phase boundary, not along file size

The extraction line is exactly the base/resolved boundary the spec already draws:

```text
stays (base phase)                    moves (resolved phase)
────────────────────                  ──────────────────────
config.ts                             env-loader.ts
workspace.ts  readWorkspace           env-identity.ts
              selectWorkspaceComponents
component-graph.ts                    workspace.ts  resolveWorkspace
component-files.ts → vendor side                    groupWorkspaceComponentsByEnv
args.ts → bit-lite                                  getWorkspaceEnvs
```

`resolveWorkspace` and the two grouping helpers move even though they live in `workspace.ts`, because they operate on a `WorkspaceContext` — they are resolved-phase code that happens to share a file with base-phase code. Splitting a file is the cost of drawing the line where the spec draws it.

The new package depends on `bit-lite-context` and `bit-lite-env`. `bit-lite-env` does not depend on the workspace model, so the graph stays acyclic:

```text
bit-lite-env ──────────┐
                       ├──▶ bit-lite-env-resolution ──▶ bit-lite (execution commands)
bit-lite-context ──────┘
       │
       └──────────────────▶ bit-lite (base-phase commands)
```

Alternatives considered: keeping one package and enforcing the boundary with a lint rule or a subpath export. Rejected because a subpath still ships from one package — the dependency declaration would still say "this command depends on env resolution", which is the false statement the change exists to remove — and a lint rule is the same class of thing as the test that guards it today.

### 2. Move argument parsing to the CLI it belongs to

`parseArgs` returns `ParsedCliArgs`, a CLI concept, and has exactly one caller. It sits in the workspace package because `ParsedCliArgs` carries a `workspaceRoot`, which is backwards: resolving a workspace root from an argument is something the CLI does, not something the workspace model needs to know about.

`CliOptionValue` and its siblings are referenced by several commands for their own option readers, so the type surface moves with the parser and those imports become local.

### 3. Move file discovery to the vendor contract

`component-files.ts` has one consumer, and it is a vendor package. A helper whose only audience is vendors is part of the vendor-facing contract, not part of workspace modelling. Leaving it in `bit-lite-context` is what makes that package look like it has no boundary at all.

### 4. Carry the parsed component record instead of reading it twice

`.comp.json` is parsed in two places with two different validators: the workspace reader checks component kind and the three dependency maps, while the recording projection reads the raw record so it can preserve fields it does not recognize. Both run for every component of every recording operation.

The workspace reader will carry the parsed record forward on the component it produces, and the projection will consume that instead of opening the file. The projection then becomes a pure in-memory transformation, which is what its own tests already treat it as.

This is the one change here that touches a shared data shape rather than only moving files, so it is worth doing now while the packages are already in motion — after the versioning package exists it would mean changing two packages instead of one.

### 5. Assert the boundary structurally

The change adds an assertion that the base-phase package cannot reach env resolution. Without it the new arrangement is only as durable as the old convention: someone adds a dependency, the packages merge back together in practice, and nothing says so.

The assertion checks the dependency declarations rather than sampling imports, because that is where the claim lives — a package that does not declare env resolution as a dependency cannot import it regardless of what any individual file does.

## Risks / Trade-offs

- **[A pure move produces a large, hard-to-review diff]** → Keep it a move: no renames, no signature changes, no behavior edits in the same commits. Anything that is not relocation should be visible as its own change to the file.
- **[Splitting `workspace.ts` separates code that reads as one unit]** → It reads as one unit only because the file is where the two phases happen to meet. After the split each half sits with the phase it belongs to, which is the point.
- **[The new package name outlives its usefulness if env resolution later merges into `bit-lite-env`]** → Possible, and it would be a further simplification rather than a problem. The name describes what the package does today.
- **[Carrying the parsed record makes `WorkspaceComponent` larger]** → It is already the canonical JSON-safe description of a component and it already carries the three dependency maps derived from that record; carrying the record itself is not a new kind of content.
- **[The structural assertion could be satisfied while the spirit is violated]** → A package could re-export env resolution through a third package. Nothing prevents that, and nothing cheap would; the assertion raises the cost of the mistake from zero to deliberate.

## Migration Plan

1. Create the env-resolution package with its manifest, TypeScript configuration, and an empty export surface, wired into the workspace build.
2. Move `env-loader.ts` and `env-identity.ts` into it unchanged, and move the three resolved-phase helpers out of `workspace.ts`.
3. Repoint the execution commands and the two preparation utilities at the new package.
4. Move argument parsing into `packages/bit-lite` and repoint `cli.ts` and every command that reads CLI option types.
5. Move file discovery to the vendor side and repoint `demo-vendors`.
6. Carry the parsed component record on the workspace component and delete the projection's own file read.
7. Add the structural assertion, then run the full build, typecheck, and every package's tests, confirming the results match the pre-move run exactly.

Rollback is a revert: nothing about the data on disk or in the component store changes, so there is no state to migrate in either direction.

## Open Questions

- Whether the env-resolution package should eventually absorb `bit-lite-env`, leaving one package for everything env-related. That would be a simplification, but it changes what `bit-lite-env` means to the demo env packages that depend on its compiled output, so it is a separate question from this move.
