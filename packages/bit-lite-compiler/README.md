# bit-lite-compiler

`bit-lite-compiler` is a contract package for compile vendors. It gives the CLI and vendor implementations a common set of input, runtime, and result types.

The package performs no compilation itself.

## Contract

A compiler vendor receives one component together with the standard vendor context and a compile-specific runtime:

```ts
type CompileVendorRuntime = {
  mainFileRelative: string;
  distDir: string;
};
```

Single-run vendors return:

```ts
type CompileRunResult = {
  output: JsonObject | null;
};
```

Watch vendors publish results with a positive run counter:

```ts
type CompileWatchResult = {
  run: number;
  output: JsonObject | null;
};
```

## Writing a compiler vendor

```ts
import type { CompilerVendorStart } from "bit-lite-compiler";
import type { VendorDefinition } from "bit-lite-vendors";

export const meta: VendorDefinition = {
  id: "example-compiler",
  label: "Example Compiler",
  hint: "Compile an example component",
  moduleUrl: import.meta.url,
};

const start: CompilerVendorStart = async (runtime) => {
  const component = runtime.data.components[0];
  const compileRuntime = runtime.data.runtime;

  if (!component || !compileRuntime) {
    throw new Error("Expected one component and a compile runtime");
  }

  // Write output to compileRuntime.distDir.
  return { data: { output: { compiled: component.id } } };
};

export default start;
```

For watch mode, the vendor sends `ready`, `status`, `result`, and `error` messages through `runtime.postMessage` and returns a `stop` callback when cleanup is required.

## Runtime checks

The following guards are available at module boundaries:

- `isCompilerVendorModule`
- `isCompileRunResult`
- `isCompileWatchResult`

## Package development

```bash
pnpm --filter bit-lite-compiler build
pnpm --filter bit-lite-compiler typecheck
pnpm --filter bit-lite-compiler test
```

Reference implementations are available at `demo-vendors/compilers/typescript` and `demo-vendors/compilers/env`.
