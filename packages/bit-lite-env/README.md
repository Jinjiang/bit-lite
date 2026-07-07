# bit-lite-env

`bit-lite-env` defines the shape of a Bit-lite env package.

This package is intentionally independent for now. It does not import from other Bit-lite packages and no existing package imports it yet.

## Supported Services

- `test`

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
