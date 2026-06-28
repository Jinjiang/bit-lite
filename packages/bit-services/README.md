# Bit Services

This package contains reusable service vendor APIs that can power lint, test, and compile flows.

Reusable exports live under `src/`:

- normalized TypeScript result types in `src/types/`
- vendor runners under `src/runners/`
- package exports such as `bit-services/runners/lint/eslint`, `bit-services/runners/test/vitest`, and `bit-services/runners/compile/typescript`

Each runner accepts a shared options object for paths owned by the caller:

```ts
import eslint from "bit-services/runners/lint/eslint";

const result = await eslint({
  cwd: "/path/to/workspace",
  targetFiles: ["src/index.ts"],
  outputDir: "service-results/artifacts"
});
```

Runner imports:

```ts
import biome from "bit-services/runners/lint/biome";
import eslint from "bit-services/runners/lint/eslint";
import oxlint from "bit-services/runners/lint/oxlint";

import cypress from "bit-services/runners/test/cypress";
import jest from "bit-services/runners/test/jest";
import mocha from "bit-services/runners/test/mocha";
import playwright from "bit-services/runners/test/playwright";
import vitest from "bit-services/runners/test/vitest";

import babel from "bit-services/runners/compile/babel";
import esbuild from "bit-services/runners/compile/esbuild";
import oxc from "bit-services/runners/compile/oxc";
import rollup from "bit-services/runners/compile/rollup";
import swc from "bit-services/runners/compile/swc";
import typescript from "bit-services/runners/compile/typescript";
import vite from "bit-services/runners/compile/vite";
import vueSfc from "bit-services/runners/compile/vue-sfc";
import webpack from "bit-services/runners/compile/webpack";
```

The local demo lives under `demo/` and is not part of the public reuse surface:

- small target source files under `demo/targets/`
- local configs under `demo/configs/`
- demo orchestration scripts under `demo/scripts/`

Run everything:

```sh
pnpm run
```

Run one service group:

```sh
pnpm run:lint
pnpm run:test
pnpm run:compile
```

Outputs are printed as JSON and written to `demo/results/*.json`. Generated artifacts are written to `demo/results/artifacts`.

The demo intentionally distinguishes `js-api` and `cli-json`. Some vendors do not expose a stable public execution API, but they can still produce structured JSON without parsing human terminal output.
