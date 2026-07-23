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
bit-lite compile --filter 'ui/*'
bit-lite compile --watch
```

`watch` is an alias for `compile --watch`.

### `test`

Groups components that share a resolved test service and invokes the service vendor.

```bash
bit-lite test --filter ui/button
bit-lite test --filter ui/button -- --coverage
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

## Global options

| Option | Meaning |
| --- | --- |
| `--workspace <dir>`, `-w <dir>` | Workspace root; defaults to the current directory |
| `--filter <pattern>` | Component ID or path pattern; may be repeated |
| `--help`, `-h` | Print usage |
| `--` | Start the vendor-specific argument list |

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
