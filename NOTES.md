# bit-lite Notes

## Direction

`bit-lite` should keep Bit's useful mental model of components, envs, and services, while removing the heavy parts first:

- Envs are plain JSON presets, not Bit components/aspects.
- Services are package modules named by env config.
- Components are workspace directories selected by config patterns.
- Runtime groups components by resolved env and passes a tiny context into services.

The goal is to build a small, inspectable spine before adding dependency-tree, build-cache, publishing, or dev-server complexity.

## Phase 1 Scope

Phase 1 should prove:

- Config loading from `bit-lite.json`.
- Component discovery by simple directory patterns.
- Env resolution with `defaultEnv` and single-level or recursive `extends`.
- Service loading by package name or local module path.
- Running one named service across env-grouped components.
- A demo workspace that exercises the same flows used by tests and debugging.

Target commands:

```sh
bit-lite components
bit-lite envs
bit-lite run inspect
bit-lite run typescript
bit-lite run test
```

## Phase 1 Services

Start with only three services.

### inspect

Diagnostic service. It should print enough context to verify the runtime model:

- workspace root
- env name
- component ids and root dirs
- service config

This should be the first service because it validates config parsing, env grouping, service loading, and context shape without introducing compiler/test-runner behavior.

### typescript

Minimal TypeScript service:

- use `tsconfig.json` by default
- run TypeScript checking/build for the workspace at first
- accept a service config field for `tsconfig`
- report success/failure clearly

Do not optimize for per-component incremental builds yet.

### test

Minimal Vitest service:

- run `vitest run` for the workspace at first
- accept a service config field for optional args later
- report success/failure clearly

Do not filter tests by component in phase 1 unless it falls out naturally.

## Service Contract

Keep the type definitions deliberately small at first.

```ts
export type ServiceResult = {
  ok: boolean;
  message?: string;
};

export type ServiceContext = {
  workspaceRoot: string;
  envName: string;
  components: ComponentRef[];
  serviceConfig: unknown;
};

export type ComponentRef = {
  id: string;
  rootDir: string;
};

export type BitLiteService = {
  name: string;
  run(context: ServiceContext): Promise<ServiceResult>;
};
```

Preferred module shape:

```ts
export function createService(config: unknown): BitLiteService;
```

The loader may also accept a default `BitLiteService` export if it is easy, but `createService(config)` should be the main shape because it keeps env JSON config bound to the service instance.

## Proposed Config Shape

```json
{
  "defaultEnv": "node",
  "envs": {
    "node": {
      "services": {
        "./services/inspect.ts": {},
        "./services/typescript.ts": {
          "tsconfig": "tsconfig.json"
        },
        "./services/test.ts": {}
      }
    },
    "react": {
      "extends": "node",
      "services": {
        "./services/react.ts": {}
      }
    }
  },
  "components": {
    "components/ui/**": "react",
    "components/lib/**": "node"
  }
}
```

For the demo workspace, local service module paths are fine. Package-name services can come later once package/install mechanics are ready.

## Demo Workspace

Add a `demo-workspace/` in the repo for debugging and examples.

Suggested content:

- `bit-lite.json`
- `components/lib/math/index.ts`
- `components/ui/button/index.ts`
- `components/*/*.test.ts` or equivalent Vitest tests
- local demo services if phase 1 keeps services in-repo

The demo should be runnable from its own root so command behavior is easy to inspect.

## Deferred

Do not implement these in phase 1:

- envs as components
- dependency installation/manifests/root components
- bundlers, preview, docs, schema extraction, linting, formatting
- versioning, tagging, snaps, lanes, scopes, remotes
- capsules or isolated build sandboxes
- dev server or watch mode
- per-component incremental execution
- cross-env service optimization

## Open Concerns

- JSON envs are simple, but they lose code-level env composition. Service packages should carry behavior; env JSON should only choose and configure them.
- Service loading by package name will eventually need dependency installation and module resolution policy.
- If services run subprocesses, result reporting and cancellation will need a more explicit contract later.
- Component identity is only path-based in phase 1. Real package names or stable ids can wait.
