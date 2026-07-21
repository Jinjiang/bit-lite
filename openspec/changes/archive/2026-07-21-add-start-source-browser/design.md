## Context

`bit-lite start` resolves one canonical, filtered component selection, then starts preview/test contributions behind one `ProxyServer`. Its root manifest joins service state by component, and the static root shell renders links from that manifest. The selected `WorkspaceComponent` already contains the component ID, absolute `rootDir`, and POSIX-style `mainFileRelative`, but none of those filesystem locations are currently exposed through HTTP.

Source browsing crosses an important trust boundary: component IDs and relative file names arrive from URL query parameters, while the server has access to the developer's filesystem. The implementation must therefore use the canonical selection as an allowlist, never resolve an arbitrary client-provided root, never follow symlinks, and never publish absolute paths. It must also bound content reads because component directories can contain binary or generated files.

## Goals / Non-Goals

**Goals:**

- Give every component rendered by the start homepage a stable source-browser entry.
- Show a hierarchical list of current regular files and render current UTF-8 text content without adding a browser runtime or syntax-highlighting dependency.
- Restrict every read to a selected canonical component and a discoverable file beneath that component's root.
- Return explicit, testable states for unavailable, binary, and oversized content.
- Keep the routes read-only and start-owned so preview vendors and test vendors remain unchanged.

**Non-Goals:**

- Editing, saving, downloading, or executing source files.
- Git history, diffs, search, symbol navigation, syntax highlighting, or IDE integration.
- Browsing arbitrary workspace files, generated dependency trees, or components excluded by `--filter`.
- Adding the source browser to standalone `bit-lite preview` or `bit-lite test --watch`.
- Watching or pushing file changes to the page; a refresh or subsequent request obtains the latest state.

## Decisions

### 1. Use one query-addressed page and two JSON read routes

Start will register these exact GET routes:

- `/source?component=<component-id>` serves the static source-browser shell.
- `/__bit-lite/source-files.json?component=<component-id>` returns the current file index.
- `/__bit-lite/source-file.json?component=<component-id>&path=<relative-posix-path>` returns one bounded file snapshot.

The index response contains `{ componentId, mainFile, files }`, where `files` is sorted by relative POSIX path and each entry contains only `{ path, size }`. The file response is a discriminated shape with common `componentId`, `path`, and `size` fields plus one of:

- `{ kind: "text", encoding: "utf-8", content }`
- `{ kind: "binary" }`
- `{ kind: "too-large", limitBytes: 1048576 }`

The page initially selects `mainFile`, then falls back to the first indexed file if the main file is temporarily absent. The optional `path` query parameter on the page records the selected file, allowing reload and browser back/forward navigation without creating a separate server route for every nested path.

Query addressing matches the existing `/tests?component=...` convention and avoids ambiguity from component IDs that contain `/`. A dynamic `/components/:id/source/*` route was considered, but it would require multiple layers of segment encoding and would be more likely to collide with future proxy paths. A single JSON response containing the whole tree and selected content was also considered; separating index and content prevents every file click from retransmitting the tree and keeps large-content handling explicit.

### 2. Build a start-owned source catalog from the resolved selection

Immediately after `prepareResolvedCommandSelection`, start will build a source catalog keyed by component ID from `selection.components`. The catalog retains the canonical component's `rootDir` and `mainFileRelative` only on the server. Route handlers resolve the requested component exclusively through this catalog; they do not accept a root path and do not fall back to `selection.context.workspace.components`.

`createStartManifest` will add `source: { route }` to every `StartManifestComponent`, using `URLSearchParams`/`encodeURIComponent` to construct `/source?component=...`. The start shell will render a `source` link for every component before optional overview/docs/composition/test links. The manifest exposes neither `rootDir` nor absolute file names.

This catalog is start-owned rather than a new preview/test contribution because it has no task lifecycle or cleanup and is independent of env services. Reusing preview aliases was rejected because preview preparation can fail or be absent while source browsing should still be available for every component on a running start page.

### 3. Enumerate a constrained current filesystem view

Each index request walks the selected component root at request time. It includes regular files, including dotfiles such as `.comp.json`, but prunes `.git`, `.bit-lite`, `node_modules`, `dist`, `build`, and `coverage` directories at every depth. Directory entries are sorted to make the response deterministic. Symbolic-link files and directories are never listed or traversed.

Every public file path is computed relative to the component root and converted to POSIX separators. Enumeration failures for an individual disappearing entry are treated as a concurrent-change condition; the entry is omitted. Failure to read the component root itself returns a controlled unavailable response without including the absolute root in the message.

Reusing the existing preview docs/demo discovery was rejected because that discovery intentionally selects only preview-specific extensions. The source catalog needs all regular component-owned files and stricter content/security metadata.

### 4. Revalidate every requested file before a bounded read

The content route does not concatenate and read the supplied path directly. It first validates a non-empty relative POSIX path (no absolute form, backslash form, NUL, `.`/`..` segment, or traversal), rebuilds the current safe file index, and requires an exact match in that index. It then opens that indexed file, verifies it is still a regular non-symlink file whose real path remains inside the real component root, and performs a read capped at 1 MiB plus one sentinel byte.

Content above 1 MiB returns `kind: "too-large"` without returning a prefix. Content at or below the limit is decoded with a fatal UTF-8 decoder; NUL-containing or invalid UTF-8 content returns `kind: "binary"`. This keeps the response bounded and prevents corrupt binary data from being rendered as source. A guessed, removed, excluded, symlinked, or escaping path returns a controlled 404.

Relying only on `path.resolve` prefix checks was rejected because a symlink nested below the component root can still resolve outside it. Relying only on the previously returned index was rejected because files can change between requests.

### 5. Keep the browser shell dependency-free and injection-safe

A new copied asset, `start-source.html`, will render:

- a header with the component ID, a link back to `/`, and a read-only refresh action;
- a left-hand hierarchical file tree derived from index paths;
- a right-hand `<pre><code>` viewer for text, plus explicit empty/binary/too-large/unavailable states.

All component IDs, file paths, content, and errors are assigned through `textContent`; no response value is inserted with `innerHTML`. File selection updates the page `path` query parameter and supports `popstate`. The refresh action re-fetches the index and selected content. JSON responses use the existing `sendJson` no-store behavior, so edits are visible on the next content request without restarting `bit-lite start`.

Bundling a syntax highlighter was rejected because it adds dependency and payload cost unrelated to the core inspection workflow. The file extension can still be displayed as lightweight context without claiming language-aware parsing.

### 6. Use explicit HTTP failure semantics

All three source routes accept GET only and return `405` with `Allow: GET` otherwise. Missing required query parameters return `400`; an unknown/unselected component or unavailable requested file returns `404`; successful binary and oversized inspections return `200` with their discriminated non-text states. Error JSON uses stable public messages and does not echo absolute filesystem paths or raw filesystem exceptions.

Exact source routes are registered before contributed preview/test routes. Their fixed `/source` and `/__bit-lite/...` paths do not overlap the preview env base paths and remain centrally owned by start.

## Risks / Trade-offs

- [Walking a large component on each index or content request can be slower than caching] → Keep traversal scoped to one selected component, prune known heavy directories, sort once per request, and favor correctness under live edits; add caching only if profiling demonstrates a need.
- [A file can change between indexing, validation, and reading] → Revalidate the opened file and return a controlled unavailable/changed result; the UI can refresh rather than presenting stale content as current.
- [The ignored-directory list may hide a directory a project considers source] → Keep the list small and limited to dependency, VCS, bit-lite state, build, and coverage outputs; document that this first version is not configurable.
- [The 1 MiB limit can reject legitimate generated source] → List the file with its size and show the explicit limit instead of freezing the UI or returning partial content.
- [The start manifest shape is additive but consumers may use exact-shape assertions] → Update repository tests and document `source` as an additive component field; no existing field changes meaning.

## Migration Plan

1. Add the source catalog/read model and its focused path, symlink, encoding, size-limit, and live-read tests.
2. Register source routes from `runStartCommand` using the existing resolved selection and extend the manifest model.
3. Add the source-browser asset and homepage link, then cover the integrated routes with start route and end-to-end tests.
4. Update the command README with the three route contracts and read-only limits.

There is no persisted data migration. Rollback removes the new routes, asset, and additive manifest field without changing workspace or env configuration.

## Open Questions

None for the initial implementation. Configurable ignore patterns, syntax highlighting, search, and automatic refresh are intentionally deferred until there is concrete demand.
