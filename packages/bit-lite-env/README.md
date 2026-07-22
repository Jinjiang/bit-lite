# bit-lite-env

Pure types and validation for package-owned Bit-lite env definitions.

An env package exposes one JSON file from its default `"."` package export. The JSON is static, recursively JSON-safe, and uses the package name as its identity:

```json
{
  "name": "@acme/env.react",
  "extends": "@acme/env.node",
  "services": {
    "test": {
      "vendor": "demo-vendors/testers/jest",
      "config": { "configFile": "demo-config/testers/jest/react" }
    },
    "preview": {
      "vendor": "demo-vendors/previewers/webpack",
      "config": {
        "configFile": "./webpack-react.js",
        "mounter": "demo-config/previewers/react-mounter",
        "docsTemplate": "demo-config/previewers/docs-template"
      }
    },
    "compile": {
      "vendor": "demo-vendors/compilers/typescript",
      "config": {
        "tsconfig": { "compilerOptions": { "jsx": "react-jsx" } }
      }
    }
  }
}
```

Only `test`, `preview`, and `compile` are supported. A service contains `vendor` and optional vendor-specific JSON `config`; compile config is intentionally opaque and does not impose one compiler or tsconfig shape. Commands own execution mode and component selection. Vendors own file discovery, so env definitions do not contain `targets`, `files`, or `patterns`.

`extends` contains one full npm package name. The parent must be a runtime dependency of the child env package. The loader inherits omitted services, replaces a complete service when the child declares it, and preserves the package/entry origin that declared each service.

Source packages use `validateEnvDefinition(value, expectedPackageName)`. A
generated local env instead exports a `CompiledEnvDefinition` with
`formatVersion: 1`, no runtime `extends`, a flattened inheritance list, and a
`serviceOrigins` dependency path for every service. Use
`flattenEnvDefinition()` in an env compiler and
`validateCompiledEnvDefinition()` at the generated-package boundary. These
paths let the runtime reconstruct the package that originally declared an
inherited vendor or relative config module.

This package does not execute env factories or resolve files and packages.
