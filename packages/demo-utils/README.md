# demo-utils

Reusable demo-development utilities. `mdxOptions` contains the shared MDX
compiler behavior as ordinary JavaScript, including plugin functions.

Import it from each maintained dev-server config:

```ts
import { mdxOptions, createMdxOptions } from "demo-utils";
```

Use `createMdxOptions({ remarkPlugins: [...] })` to append env-local behavior.
These options are compile-time config and are never serialized into preview
vendor runtime data. Runtime document layout remains the responsibility of the
optional `docsTemplate` config.

```sh
pnpm --filter demo-utils test
pnpm --filter demo-utils typecheck
pnpm --filter demo-utils build
```
