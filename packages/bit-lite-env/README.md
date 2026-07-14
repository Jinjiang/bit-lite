# bit-lite-env

`bit-lite-env` defines the shape of a Bit-lite env package.

This package defines JSON-safe env service configuration independently from
runtime vendor implementations.

## Supported Services

- `test`
- `preview`

Each env service definition uses a vendor-backed shape:

```ts
import { defineEnv } from "bit-lite-env";

export default defineEnv({
  name: "@acme/bit-env-react",
  services: {
    test: {
      vendor: "@bit-vendors/vitest",
      config: {
        configFile: "./configs/vitest",
        coverage: true
      }
    }
  }
});
```

The test config type adds a small set of known fields while still allowing vendor-specific JSON fields.

Preview keeps compile-time dev-server configuration separate from browser
runtime rendering:

```ts
services: {
  preview: {
    vendor: "demo-vendors/previewers/vite",
    config: {
      configFile: "demo-config/previewers/vite-static",
      mounter: "demo-config/previewers/static-mounter",
      docsTemplate: "demo-config/previewers/docs-template"
    }
  }
}
```

`configFile` is required and points to the Vite or Webpack dev-server config.
`mounter` and `docsTemplate` remain optional structural inputs. The preview
command resolves all three modules before vendor startup; it requires a mounter
only when the selected env actually contains demos.

```sh
pnpm --filter bit-lite-env test
pnpm --filter bit-lite-env typecheck
pnpm --filter bit-lite-env build
```
