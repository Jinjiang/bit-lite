## 1. Source catalog and read model

- [x] 1.1 Add a start-owned source catalog keyed by the canonical selected component IDs and implement deterministic regular-file enumeration with the specified ignored directories, POSIX relative paths, sizes, and no symlink traversal.
- [x] 1.2 Implement strict relative-path validation, fresh-index membership checks, real-root containment revalidation, and a 1 MiB-plus-sentinel bounded file read that returns `text`, `binary`, or `too-large` snapshots.
- [x] 1.3 Add focused read-model tests for sorting, dotfiles, ignored directories, symlink files/directories, traversal and absolute-path rejection, invalid UTF-8/NUL detection, oversized files, removals, and edits observed by later reads.

## 2. Start manifest and HTTP routes

- [x] 2.1 Extend `StartManifestComponent` and manifest construction with an encoded `/source?component=...` descriptor for every selected component while keeping all absolute filesystem data private.
- [x] 2.2 Add the `/source`, `/__bit-lite/source-files.json`, and `/__bit-lite/source-file.json` GET routes, including explicit 400/404/405 responses and `Allow: GET`, and register them before preview/test contribution routes using the resolved selection.
- [x] 2.3 Extend start route tests to cover manifest encoding, components without preview/test availability, filtered or unknown component rejection, live index/content responses, no-store JSON, stable error payloads, and non-GET methods.

## 3. Source browser and homepage UI

- [x] 3.1 Add the copied `start-source.html` asset with a responsive hierarchical file tree, main-file fallback, text viewer, binary/too-large/unavailable states, refresh action, and `path` query plus `popstate` navigation.
- [x] 3.2 Update `start-shell.html` to render each component's `source` link before its conditional preview and test links.
- [x] 3.3 Add asset-level tests proving both shells use DOM `textContent` for untrusted values, contain no source editing/execution control, and reference only the specified read routes.

## 4. End-to-end verification and documentation

- [x] 4.1 Extend the start end-to-end fixture to fetch the source page, index, and main-file content, verify homepage navigation, and prove an on-disk edit is visible on a subsequent request without restarting start.
- [x] 4.2 Document the source page/data routes, selected-component boundary, ignored directories, UTF-8 behavior, and 1 MiB read limit in the bit-lite command README.
- [x] 4.3 Run the bit-lite package tests, typecheck, and build with pnpm and fix any regressions in existing preview/test/start behavior.
