# bit-lite-history

Git-backed component version history. This package owns the durable store, the
snapshot boundary, ref layout, and every Git invocation; the CLI owns argument
parsing, component selection, and human-readable output.

It backs the `snap`, `tag`, and `sync` commands. No other Bit Lite command loads
it, so `install`, `link`, `compile`, `test`, `preview`, `start`, and `watch`
never require Git and never open the store.

## The store

Component history lives in a bare Git repository at `<workspace>/.bit-lite-store.git`.

It is created lazily by the first versioning command and is **not** part of the
disposable `.bit-lite` cache. Cleanup routines that delete `.bit-lite` must leave
`.bit-lite-store.git` alone.

> **Back it up.** Until `bit-lite sync` replicates it to a remote,
> `.bit-lite-store.git` is the only copy of your component history. Deleting the
> directory deletes every snap and tag it holds.

> **Do not edit it by hand.** Bit Lite validates ref names, object types,
> history shape, and tag reachability at every operation boundary, and it
> reports a malformed store rather than repairing or overwriting it. A manual
> `git` write inside the store can make snap, tag, or sync refuse to run.

Every Git invocation passes `--git-dir` explicitly and uses an argument array
with no shell, so the workspace's own repository is never discovered or touched.

## What a snap captures

A snap records **every regular file under the component root**: implementation,
documentation, demos, tests, assets, dotfiles, and `.comp.json`. Paths in the
commit tree mirror component-relative paths — there is no wrapper directory and
no generated manifest.

These directory names are pruned at any depth:

```text
.git  .bit  .bit-lite  .bit-lite-store.git  node_modules  dist  build  coverage
```

Pruning happens by name before anything else, so a linked `node_modules` and
anything beneath a pruned directory are skipped rather than inspected.

Other boundaries:

- **Symbolic links are rejected.** A link anywhere in the traversed tree fails
  the whole operation and names the component-relative path. V1 does not follow
  links, even when the target stays inside the component, so that traversal
  confinement and cross-platform reconstruction stay unambiguous.
- **File bytes and executable mode are preserved.** Blobs are written with
  `--no-filters`, so a snap never depends on the machine's Git clean/smudge
  configuration.
- **Empty directories disappear**, following normal Git tree semantics.
- **Nothing outside the component directory is captured.** Workspace
  configuration, inferred dependencies, resolved env state, package-manager
  state, and build output are all outside the v1 boundary. Changing only
  `bit-lite.json` leaves every component `unchanged`.

Because dotfiles are included, a snap can capture a file you did not intend to
version. Snap output lists the components it recorded; review it if a component
directory may hold secrets.

## Two identities: commit and tree

| Identity | What it answers |
| --- | --- |
| Commit ID (the **snap ID**) | Where this state sits in the component's history |
| Tree ID | What the component's files are |

A snap ID is the commit object ID. Before creating a commit, Bit Lite compares
the newly captured tree with the tree at the component's current snap; equal
trees create no commit and move no ref, and the component is reported as
`unchanged`.

Two independent histories holding identical files therefore share a tree ID but
not a snap ID, because commits also carry parents and author metadata.

All reported IDs are algorithm-qualified — `sha1:<hex>` or `sha256:<hex>`. The
store's object format is read from Git rather than assumed.

## Refs

```text
refs/heads/components/<component-key>
refs/tags/components/<component-key>/<semver>
refs/bit-lite/remotes/origin/components/<component-key>
refs/bit-lite/remotes/origin/tags/<component-key>/<semver>
```

`<component-key>` is the canonical component ID encoded as unpadded base64url.
The encoding is reversible and collision-free, and its alphabet cannot express a
ref separator, so a component ID containing `/`, `..`, or spaces can never
escape its namespace.

Each component has one linear history: every snap commit has the component's
previous snap as its sole parent, or no parent for the first snap. There is no
workspace-wide commit and no cross-component parent, so
`git log refs/heads/components/<key>` is exactly that component's history.

When one command records several components, all their refs are published in a
single `update-ref` transaction, each carrying the value Bit Lite read during
preparation as its expected old value. A component that fails preparation stops
the whole publication, and a ref that moved concurrently fails the transaction
instead of being overwritten. Objects written before a failure are simply
unreachable and are left to ordinary Git garbage collection.

## Tags are immutable

`tag` assigns a strict semantic version to a component's **current** snap. It
never creates a snap.

- Versions must be exact semver (`1.2.3`, `1.2.3-rc.1`). Ranges, `v` prefixes,
  and `1.2` are rejected.
- Tags are annotated Git tag objects, so tagger, timestamp, and message are
  recorded.
- Reapplying the same version to the same snap is idempotent and keeps the
  original tag object.
- Pointing an existing version at a different snap is an error. V1 has no force,
  move, or delete path.
- A tag is valid only if its target is reachable from the matching component's
  head, which prevents a version from naming another component's snap.

## Synchronization

`sync` talks to a remote configured as `origin` **inside the store**. The
workspace's own remotes are never read or written.

The first `--remote <url>` configures it; later runs reuse it. A different URL is
rejected rather than applied, so component history cannot be silently redirected.

One sync runs five ordered phases:

1. **Fetch** remote component heads and tags through explicit refspecs into
   private tracking refs under `refs/bit-lite/remotes/origin/`. Canonical refs
   are never a fetch target. Tracking refs are observations of the remote, not
   accepted state, so they may advance even when reconciliation later fails.
2. **Validate** every local and fetched ref: name, object type, linear history,
   decoded component ownership, annotated tag structure, and tag reachability.
3. **Reconcile** using commit ancestry, never timestamps.
4. **Apply** all local updates in one expected-old-value ref transaction.
5. **Publish** with non-forced explicit refspecs.

### Head outcomes

| Situation | Outcome |
| --- | --- |
| Heads equal | `unchanged` |
| Remote only | `imported` |
| Local only | `published` |
| Local is a strict ancestor of remote | `fast-forwarded` |
| Remote is a strict ancestor of local | `published` |
| Neither is an ancestor of the other | `conflicted` |

### Tag outcomes

Tags reconcile by name and peeled snap target. Present on one side only means
`imported` or `published`; the same target on both sides is `unchanged`; the
same version peeling to different snaps is `conflicted`.

### Conflicts and atomicity

If any component diverges, any tag conflicts, or any ref is malformed, sync
reports **every** problem it found and stops — no canonical ref changes, no push.
V1 never merges, rebases, or force-updates; resolve the divergence and run sync
again.

Publishing more than one ref requires `git push --atomic`, so a partial transfer
is never observable. A remote that does not support atomic push fails with an
actionable message and is **not** retried as separate pushes. A remote that moved
after the fetch produces a non-fast-forward rejection, and the fix is to run
sync again so the new state is fetched and reconciled.

## API sketch

```ts
const store = await openComponentHistoryStore({ workspaceRoot });

await snapComponents(store, [{ componentId: "ui/button", rootDir }]);
await tagComponent(store, { componentId: "ui/button", version: "1.0.0" });
await syncComponentHistory(store, { requestedUrl: "git@example.com:components.git" });
```

## Package development

```bash
pnpm --filter bit-lite-history run test
```

Unit tests cover encoding, validation, and reconciliation logic. Integration
tests exercise real bare repositories and use a local bare repository as a
deterministic remote.
