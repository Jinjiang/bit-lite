# demo-config

`demo-config` publishes configuration modules used by the repository's example environments.

The package is intentionally specific to the demo. It shows how env JSON can refer to executable configuration, mounters, and templates by package subpath.

## Preview modules

| Export | Description |
| --- | --- |
| `demo-config/previewers/vite-static` | Vite configuration for framework-neutral components and MDX docs |
| `demo-config/previewers/vite-vue` | Vite configuration with Vue, MDX, aliases, and dependency deduplication |
| `demo-config/previewers/static-mounter` | Renders plain composition values |
| `demo-config/previewers/react-mounter` | Mounts React elements, component functions, or `{ component, props }` objects |
| `demo-config/previewers/vue-mounter` | Mounts Vue components or `{ component, props }` objects |
| `demo-config/previewers/docs-template` | React template used to display loaded docs modules |

## Test modules

| Export | Description |
| --- | --- |
| `demo-config/testers/jest/react` | Jest configuration for the React demo components |
| `demo-config/testers/vitest/node` | Vitest configuration for framework-neutral TypeScript |
| `demo-config/testers/vitest/vue` | Vitest configuration for Vue |

An env references the modules as strings:

```json
{
  "preview": {
    "vendor": "demo-vendors/previewers/vite",
    "config": {
      "configFile": "demo-config/previewers/vite-vue",
      "mounter": "demo-config/previewers/vue-mounter",
      "docsTemplate": "demo-config/previewers/docs-template"
    }
  }
}
```

The specifiers are resolved relative to the package that declared the service.

## Package development

```bash
pnpm --filter demo-config build
pnpm --filter demo-config typecheck
pnpm --filter demo-config test
```

The Vite configurations share their MDX setup through [`demo-utils`](../demo-utils/README.md).
