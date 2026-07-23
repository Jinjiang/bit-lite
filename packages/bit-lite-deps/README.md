# bit-lite-deps

`bit-lite-deps` adapts pnpm's programmatic installation APIs for Bit Lite's generated component projects.

It is an internal package. Applications should normally reach it through `bit-lite install`.

## Installation API

```ts
import { installDependencyProjects } from "bit-lite-deps";

await installDependencyProjects({
  rootDir: "/workspace/.bit-lite/deps",
  projects: [
    {
      rootDir: "/workspace/.bit-lite/deps/components/example",
      manifest: {
        name: "@example/component",
        version: "0.0.0",
        dependencies: {
          react: "^19.0.0",
        },
      },
    },
  ],
  onProgress(event) {
    // Render or record a stable Bit Lite progress event.
  },
});
```

The installer uses an isolated node linker, ignores lifecycle scripts, installs development and optional dependencies, and leaves peer dependency resolution to the generated manifests.

## Local workspace discovery

`discoverPnpmWorkspacePackages(startDir)` searches parent directories for `pnpm-workspace.yaml`. When found, its packages can be supplied as local installation candidates.

This is a development convenience for this monorepo, not a requirement of the Bit Lite workspace format. A Bit Lite workspace may be completely independent from pnpm workspaces.

## Progress events

`DependencyInstallProgressEvent` provides stable events for:

- dependency resolution and importing stages;
- resolved, reused, downloaded, and added counts;
- added/removed statistics;
- pnpm warnings;
- optional dependencies skipped for the current platform;
- network retries.

`observeDependencyInstallProgress` installs a listener and returns a function that removes it.

## Maintenance note

This package imports versioned pnpm internals. Treat pnpm dependency upgrades as integration changes and run both this package's tests and the CLI install tests.

```bash
pnpm --filter bit-lite-deps build
pnpm --filter bit-lite-deps typecheck
pnpm --filter bit-lite-deps test
```
