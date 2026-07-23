# bit-lite-env

`bit-lite-env` owns the data model for environment packages.

An environment associates component operations with vendor modules. Bit Lite currently recognizes three service names:

```ts
["test", "preview", "compile"]
```

## Source definition

Environment packages expose a JSON object:

```json
{
  "name": "@example/react-env",
  "extends": "@example/base-env",
  "services": {
    "test": {
      "vendor": "@example/vendors/test",
      "config": {
        "configFile": "@example/config/test"
      }
    },
    "preview": {
      "vendor": "@example/vendors/preview",
      "config": {
        "configFile": "@example/config/preview",
        "mounter": "@example/config/react-mounter",
        "docsTemplate": "@example/config/docs-template"
      }
    },
    "compile": {
      "vendor": "@example/vendors/compile",
      "config": {
        "target": "ES2022"
      }
    }
  },
  "config": {
    "framework": "react"
  }
}
```

All custom `config` values must be valid JSON.

## Compiled definition

`flattenEnvDefinition` merges a source definition with its resolved parent definitions. The compiled result includes:

- `formatVersion`;
- the merged services and custom configuration;
- the package inheritance chain;
- the package origin of each service.

The origin data is important because vendor and config module specifiers are resolved relative to the package that declared the service.

## Validation API

- `validateEnvDefinition`
- `validateCompiledEnvDefinition`
- `isCompiledEnvDefinition`
- `validateEnvServiceConfig`
- `validateEnvServicesConfig`
- `isSupportedEnvServiceName`
- `BitLiteEnvConfigError`

## Package development

```bash
pnpm --filter bit-lite-env build
pnpm --filter bit-lite-env typecheck
pnpm --filter bit-lite-env test
```

See [`demo-env-node`](../demo-env-node/README.md) and [`demo-env-vue`](../demo-env-vue/README.md) for concrete definitions.
