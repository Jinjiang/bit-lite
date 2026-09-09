# bit-lite

The `bit-lite` package contains the executable CLI and the top-level orchestration for a Bit Lite workspace.

It is the package most users interact with. The other `bit-lite-*` packages provide focused services such as workspace resolution, vendor execution, dependency installation, and preview routing.

## Install and invoke

Within this repository:

```bash
pnpm install
pnpm build
node packages/bit-lite/dist/bin.js --help
```

The package also declares a `bit-lite` binary, so an installed copy can be invoked as:

```bash
pnpm exec bit-lite --help
```

## Required workspace files

The CLI expects a `bit-lite.json` at the workspace root.

```json
{
  "components": [
    {
      "path": "components/button",
      "id": "ui/button",
      "packageName": "@example/ui.button",
      "env": {
        "packageName": "@example/react-env",
        "version": "^1.0.0"
      }
    }
  ]
}
```

The current prototype also expects a materialized `.comp.json` record in every component directory:

```json
{
  "dependencies": {},
  "devDependencies": {},
  "peerDependencies": {
    "react": "^19.0.0"
  }
}
```

This record makes the component kind and dependency state easy to inspect, much like the information surfaced by `bit show` or `bit deps debug`. The repository's fixtures provide it directly because higher-level metadata generation is not implemented yet. Treat it as read-only state: commands should eventually generate it, and its format or location may change.

Regular components use an `index.*` entry file. Environment component records contain `"kind": "env"` and use `index.json`.

## Commands

### `install`

Builds generated dependency manifests under `.bit-lite/deps`, asks pnpm to install them, and links the generated component packages into the workspace. Add `--compile` to compile every component after installation.

```bash
bit-lite install --workspace ./my-workspace --compile
```

### `compile`

Runs the compile service selected by each component's environment. Local prerequisites are included and components are processed in dependency order.

```bash
bit-lite compile 'ui/*'
bit-lite compile --watch
```

`watch` is an alias for `compile --watch`.

### `test`

Groups components that share a resolved test service and invokes the service vendor.

```bash
bit-lite test ui/button
bit-lite test ui/button -- --coverage
```

Arguments after `--` are preserved for the vendor.

### `preview`

Discovers component docs and compositions, starts the configured preview vendors, and exposes them through a common proxy.

```bash
bit-lite preview --host 127.0.0.1 --port 4000
bit-lite preview --lazy
```

### `start`

Creates one development session containing source routes, compile watch tasks, test watch tasks, and previews. It links components and compiles any local environment packages needed before service resolution.

```bash
bit-lite start --workspace ./my-workspace
```

Run `install` first when the component dependencies have not been installed.

### `link`

Regenerates package manifests and symlinks without installing external dependencies.

### `snap`

Records the selected components in the workspace's component history store at `.bit-lite-store.git`, creating it on first use. With no pattern it records every registered component.

```bash
bit-lite snap --workspace ./my-workspace "ui/**"
```

A snap captures every regular file under each component root, including docs, demos, tests, assets, and dotfiles. `.comp.json` is the one exception to "exactly the bytes on disk": what a snap records is a **projection** of it, with `workspace:*` dependency specifiers resolved to the versions those components currently carry and the env reference from `bit-lite.json` injected. The working file is never modified.

Components are recorded in dependency order, so a component's dependencies and env already carry versions when the component naming them is recorded. A component whose captured content has not changed is reported as unchanged and creates no commit — but note that a dependency moving changes the projection, so a component can be recorded again with none of its own files touched.

Several components are published in one transaction, so a failure leaves every component ref where it was. Each recorded component's version is written back to its `bit-lite.json` entry.

Requires Git. See the [`bit-lite-history` documentation](../bit-lite-history/README.md) for the capture boundary, exclusions, and store lifecycle.

### `tag`

Assigns immutable semantic versions to the selected components' snaps, deriving each component's version independently by incrementing the patch of the highest it already carries. With no pattern it tags every registered component.

```bash
bit-lite tag "ui/**"
bit-lite tag ui/button --version 1.2.3
```

`--version` overrides the derived version and requires the selection to resolve to exactly one component, since one version cannot describe several. A component with nothing new — unchanged content whose snap already carries a version — is skipped and keeps the version it has, so repeating the command changes nothing.

Reapplying the same version to the same snap is a no-op. Pointing an existing version at a different snap is an error; there is no force, move, or delete.

### `sync`

Exchanges component histories and tags with a remote configured inside the history store. The first run needs `--remote`; later runs reuse the stored URL.

```bash
bit-lite sync --remote git@example.com:components.git
bit-lite sync
```

Reconciliation is fast-forward only. Divergent histories and conflicting tag targets are reported together and fail the command without changing or publishing any ref.

### `status`

Reports where each selected component stands against its recorded history. With no pattern it reports every registered component.

```bash
bit-lite status
bit-lite status "ui/**" --json
```

Five conditions are reported independently, because a component can be in several at once:

| Condition | Meaning |
| --- | --- |
| never recorded | the component has no history yet |
| modified | its content differs from its head, or one of its workspace prerequisites is modified |
| never released | it has a snap, nothing is modified, but no semantic version is assigned to that snap |
| behind | its `bit-lite.json` version anchor names an ancestor of its head, which is what `sync` leaves behind |
| dependency updates available | a dependency or env carries a version different from the one its head recorded |

`behind` is worth reading carefully: recording from that state records content based on the older version. There is no `checkout`, so the only recovery is to re-apply or discard the work by hand.

Unlike `snap` and `tag`, `status` never refuses. A prerequisite that has never been recorded or has uncommitted changes is reported rather than rejected.

`status` is the authority on what recording will act on: a component reported **modified** is one the next `snap` will record, and a component reported clean is one it will not.

#### `--detail`

Expands each modified component into the changes behind it — the component-owned files that differ, and the dependency, env, and other metadata changes.

```bash
bit-lite status --detail ui/button
```

Detail always compares working content against the recorded head; comparing two recorded versions against each other is what `log` reports for every snap. It reports the same components and the same conditions as the summary view, adding detail rather than changing the answer, and a component that is not modified gains no expansion.

`.comp.json` never appears as a file here. Its differences are reported as added, removed, and changed dependency entries and as env changes, with the versions on each side — the recorded file is a projection whose keys are sorted and whose `workspace:*` specifiers have been substituted, so reading it as text would report reformatting as a version change.

### `log`

Lists one component's snaps from its head backwards, and says why each version exists.

```bash
bit-lite log ui/button
```

Each entry carries the snap identifier, its authored timestamp, any semantic versions assigned to it, and its change source — `source`, `deps`, `env`, or a combination. An entry whose version came only from a dependency or env moving says that no component-owned source file changed and names the versions on both sides.

### `diff`

Emits a line-by-line unified diff of the selected components' content.

```bash
bit-lite diff
bit-lite diff ui/button > changes.diff
bit-lite diff ui/button --from 0.0.1 --to 0.0.2
```

With no `--from` or `--to`, it compares each selected component's working content against its recorded head and follows the same selection conventions as `status`, so a bare `bit-lite diff` covers the whole workspace. Each option accepts a snap identifier or an assigned semantic version; a version that is not one of that component's snaps fails naming both. Naming a version requires a selection resolving to one component, because a version identifier is local to one component's history.

Standard output carries the patch and nothing else, so redirecting it produces a usable `*.diff` file. There is no colorization, and any advisory goes to standard error.

#### The patch format

```diff
# ui/button  0.0.0-ga17d5e0 -> working
# ============================================================

diff --git a/ui/button::src/button.tsx b/ui/button::src/button.tsx
index a1b2c3d..e4f5a6b 100644
--- a/ui/button::src/button.tsx
+++ b/ui/button::src/button.tsx
@@ -10,7 +10,7 @@
-  const cls = "btn";
+  const cls = clsx("btn", variant);
```

Paths are addressed in the workspace's own vocabulary as `a/<component-id>::<path>`. Both a component identifier and a file path contain slashes, so `::` marks the boundary between them; it also keeps two components that each own a file of the same name from colliding on one path, which is what lets a single patch carry several components. **These paths do not name files in a checkout, so the patch is not meant to be applied.**

Each component's files are preceded by a banner naming it and both states, stating the version transition once. Banner lines begin with `#`, which unified diff gives no meaning to, so no banner line can be read as a file marker or a deleted line.

The `index` line carries real blob identifiers on both sides — the working side's blobs are hashed without being written, so the identifier is correct even though the object is not in the store. Added and deleted files are emitted against `/dev/null` with their modes, a file whose mode changed but whose content did not is emitted with no hunk, and content that is not valid UTF-8 is reported as differing binary rather than rendered.

Unlike in `status --detail` and `log`, `.comp.json` appears here as an ordinary file patch. `diff` reproduces content rather than reporting on it, and a patch that omitted a file the snap records would be an incomplete account of the difference. It is often the most informative hunk in the output, because it shows the dependency version substitution that produced a new version.

#### An empty patch does not mean nothing will happen

A component whose own files are untouched but whose workspace prerequisite has uncommitted changes has no content difference of its own: inspection resolves that prerequisite to the version at its own head, which is the version the component already recorded. Both sides are byte-identical and the patch is empty — yet recording both would advance the component.

`diff` writes an advisory naming the prerequisite to standard error when this happens. For what recording will act on, read `status`, not the size of a patch.

## Global options

| Option | Meaning |
| --- | --- |
| `--workspace <dir>`, `-w <dir>` | Workspace root; defaults to the current directory |
| `--filter <pattern>` | Component ID or path pattern; may be repeated. Only on the commands that select components |
| `--help`, `-h` | Print help for the command, or for the CLI when no command is named |
| `--` | Start the vendor-specific argument list |

A component pattern may be written positionally instead of with `--filter`, and the two are
equivalent: `bit-lite snap ui/button` and `bit-lite snap --filter ui/button` select the same thing,
and both spellings may be used together. Quote patterns containing `*` so the shell does not expand
them. `install`, `link`, and `sync` take no component patterns.

These four spellings are reserved, so a vendor option spelled the same way goes after `--`. Any
other option a command does not define is forwarded to its vendor, on the commands that run one;
`snap`, `tag`, `status`, `log`, `diff`, `link`, and `sync` reach no vendor and report an option they
do not define instead of ignoring it.

Run `bit-lite help <command>` for each command's own options and examples.

## JavaScript API

The package exports `runCli`, which accepts an argument array without the Node.js executable or script path:

```ts
import { runCli } from "bit-lite";

const exitCode = await runCli([
  "test",
  "--workspace",
  "/workspaces/example",
]);

process.exitCode = exitCode;
```

## Package development

```bash
pnpm --filter bit-lite build
pnpm --filter bit-lite typecheck
pnpm --filter bit-lite test
```

`postbuild` copies the HTML used by `start` from `src/assets` to `dist/assets`.

The bundled end-to-end fixture is documented in [`demo-workspace`](../demo-workspace/README.md).
