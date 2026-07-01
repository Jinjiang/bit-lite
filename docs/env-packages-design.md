# Env Packages Design

## 背景

Bit-lite 当前把每个 component 使用的 env 定义写在 workspace 配置文件里。随着 env 变复杂，`bit.json` 或 `bit-lite.json` 很容易变成一个巨大配置文件：

- 每个 env 需要声明 services。
- 每个 service 需要声明 runner、vendor、targets、config。
- lint、test、typecheck、preview、compile 等工具都有自己的默认配置。
- React、Vue、Node 等常规 env 会重复出现大量相似配置。

未来希望把 env 定义发布为独立 npm package。workspace 配置只在每个 component 上引用具体 env package，具体 env 能力、默认 service、默认工具配置都由 env package 提供。

这个文档先记录早期技术设计和可行性判断，不规定最终实现细节。

## 目标

`bit.json` 只负责声明每个 component 使用哪个 env package。不同 component 可以使用不同 env，不通过 pattern 做批量推导。

env package 负责具体环境能力：

- 默认 services。
- 默认 service runner。
- 默认 target patterns。
- 默认工具配置。
- 需要的 npm dependencies。

示例：

```json
{
  "components": [
    {
      "path": "components/ui/button",
      "id": "ui/button",
      "packageName": "@acme/ui.button",
      "env": {
        "packageName": "@acme/bit-env-react",
        "version": "workspace:*"
      }
    },
    {
      "path": "components/lib/math",
      "id": "lib/math",
      "packageName": "@acme/lib.math",
      "env": {
        "packageName": "@acme/bit-env-node",
        "version": "^1.0.0"
      }
    }
  ]
}
```

每个 `env` 都是一个真实 package reference。版本使用 semver spec；如果 env package 是当前 pnpm workspace 里的本地 package，使用 `workspace:*`。

## 非目标

初期不支持 env alias。

也就是说，不设计下面这种本地别名映射：

```json
{
  "envs": {
    "react": {
      "package": "@acme/bit-env-react"
    }
  },
  "components": [
    {
      "path": "components/ui/button",
      "id": "ui/button",
      "packageName": "@acme/ui.button",
      "env": "react"
    }
  ]
}
```

原因：

- alias 需要额外维护映射关系。
- 本地 alias 会增加 workspace 配置复杂度。
- 云端 alias 表会引入中心化 registry 负担。
- 常规 env 的细节应该通过 npm package name 和 package manager 解决。

因此，env package name 就是 env identity。

初期也不支持：

- 用 component pattern 批量匹配 env。
- `defaultEnv`。
- workspace 级 env override。
- 通过配置项覆盖 env package 的 service targets。

这些能力都容易让 env 分配规则变得隐式。当前设计要求每个 component 明确写出自己的 env。

## 配置模型

建议未来配置文件以 component record 作为唯一 env 绑定入口。

```json
{
  "components": [
    {
      "path": "components/app/header",
      "id": "app/header",
      "packageName": "@acme/app.header",
      "env": {
        "packageName": "@acme/bit-env-react",
        "version": "workspace:*"
      }
    }
  ]
}
```

规则：

- `env.packageName` 必须是合法 npm package name。
- `env.version` 必须是合法 semver/package-manager spec。
- 本地 workspace env package 使用 `workspace:*` 或后续允许的 workspace semver spec。
- Bit-lite 不根据 path 或 pattern 推断 env。
- Bit-lite 不维护 env alias 表。

env package 必须能被当前 workspace 的 package manager resolve。它可以来自 registry，也可以是 monorepo 里的 workspace package。

## Env Package 协议

每个 env package 是普通 npm package。

示例 package：

```json
{
  "name": "@acme/bit-env-react",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./dist/env.js",
    "./configs/eslint": "./dist/configs/eslint.js",
    "./configs/vitest": "./dist/configs/vitest.js",
    "./configs/vite": "./dist/configs/vite.js",
    "./configs/tsconfig": "./dist/configs/tsconfig.json"
  },
  "dependencies": {
    "@bit-services/eslint": "^1.0.0",
    "@bit-services/typescript": "^1.0.0",
    "@bit-services/vite-preview": "^1.0.0",
    "@bit-services/vitest": "^1.0.0",
    "eslint": "^10.0.0",
    "typescript": "^6.0.0",
    "vite": "^8.0.0",
    "vitest": "^4.0.0"
  }
}
```

env package 可以导出 object，也可以导出 factory。建议优先支持 factory，但这里的 factory 不是为了 workspace override，而是为了未来支持 env package 之间的继承和局部替换。

例如长期可能需要：

- env A 基于 env B，只替换 test runner。
- env A 基于 env B，只换一个 config file。
- env A 复用 env B 的大部分 services，只增加 preview 能力。

这类 env-to-env composition 可以后续具体设计。初期只需要保留 factory 入口，不在 workspace 配置里引入 override 语义。

```ts
export default function createEnv(context) {
  return {
    name: "@acme/bit-env-react",
    services: {
      lint: {
        runner: "@bit-services/eslint",
        config: {
          configFile: "./configs/eslint"
        },
        targets: {
          patterns: [
            {
              include: ["**/*.{js,jsx,ts,tsx}"],
              exclude: ["dist/**"]
            }
          ]
        }
      },
      test: {
        runner: "@bit-services/vitest",
        config: {
          configFile: "./configs/vitest"
        },
        targets: {
          patterns: [
            {
              include: ["**/*.{test,spec}.{js,jsx,ts,tsx}"]
            }
          ]
        }
      },
      typecheck: {
        runner: "@bit-services/typescript",
        config: {
          tsconfig: "./configs/tsconfig"
        }
      },
      preview: {
        runner: "@bit-services/vite-preview",
        config: {
          configFile: "./configs/vite"
        }
      }
    }
  };
}
```

factory context 概念类型：

```ts
type EnvFactoryContext = {
  packageName: string;
  version: string;
  envPackageRoot: string;
  workspaceRoot: string;
};
```

`userConfig` 暂不放入 context，因为当前设计不支持 workspace env override。

## Env Definition

env package 返回标准 env definition。

概念类型：

```ts
type EnvDefinition = {
  name: string;
  services: Record<string, EnvServiceDefinition>;
  config?: Record<string, unknown>;
};

type EnvServiceDefinition = {
  runner: string;
  config?: unknown;
  targets?: ServiceTargetInput;
};
```

`name` 必须等于 env package name，或者在加载时被 Bit-lite 归一化成 env package name。这样可以避免 alias 和 package identity 不一致。

`EnvServiceDefinition` 不包含 `mode`。run once、watch、serve 等运行模式由 service 语义和运行时 args 决定，而不是 env package 静态声明决定。

## Service Runner 协议

env package 不直接实现所有工具逻辑，而是组合 service runner package。

例如：

- `@bit-services/eslint`
- `@bit-services/oxlint`
- `@bit-services/vitest`
- `@bit-services/typescript`
- `@bit-services/vite-preview`
- `@bit-services/webpack-preview`

runner 应该导出带 `run` 的对象，而不是单独函数。

概念类型：

```ts
type ServiceRunner = {
  service: "lint" | "test" | "typecheck" | "preview" | "compile" | string;
  vendor: string;
  run(input: ServiceInput, host?: ServiceHost): ServiceTask | Promise<ServiceResult>;
};
```

runner 输入和输出应该是结构化 JSON，而不是依赖命令行字符串。

## 路径解析规则

路径解析必须在早期明确，否则 env package、runner package 和 workspace 文件会很容易混乱。

建议规则：

- env package 内声明的相对路径，相对 env package root 解析。
- component source 永远来自 workspace。
- runner package 优先从 env package 解析，失败后再从 workspace root 解析。
- config package subpath 通过 Node package exports 解析。
- 运行时 CLI args 中的 workspace 文件路径，相对 workspace root 解析。

示例：

```ts
configFile: "./configs/vite"
```

如果来自 env package，解析为：

```txt
node_modules/@acme/bit-env-react/dist/configs/vite.js
```

## Targets 模型

env package 可以声明默认 target patterns，但不应该声明具体 components。

component 选择由 Bit-lite 运行时决定，例如：

```sh
bit-lite test --filter @acme/ui.button
```

因此 service targets 里不需要 `components` 字段。Bit-lite 会根据 `--filter`、component package registry 和当前命令上下文选出 component set，再把解析后的文件列表或 component context 传给 runner。

`rootDir` 也不建议放进 targets。多个 component 共享的 root 通常就是 workspace root；每个 component 的 rootDir 已经存在于 component registry，不需要 env package 重复配置。

概念模型：

```ts
type ServiceTargetInput = {
  files?: string[];
  patterns?: ServiceTargetPattern[];
};

type ServiceTargetPattern = {
  kind?: string;
  include?: string[];
  exclude?: string[];
};
```

这个模型支持：

- lint 对选中 components 的源码文件生效。
- test 只匹配选中 components 内的 `*.test.*` 和 `*.spec.*`。
- preview 查找选中 components 内的 `preview.ts`、`preview.tsx` 或 docs 文件。
- typecheck 可以选择 workspace-level tsconfig，也可以未来支持 component-level project references。

## 依赖策略

早期建议 env package 自带默认工具依赖，优先保证开箱可用。

例如 React env package 依赖：

- `@bit-services/vite-preview`
- `@bit-services/vitest`
- `@bit-services/typescript`
- `vite`
- `vitest`
- `typescript`

后续可以引入 peer dependency 模式，让高级 workspace 自己控制工具版本。

需要明确 resolver 优先级：

1. env package dependencies。
2. workspace dependencies。
3. 友好错误提示。

如果 env package 是当前 workspace 内的本地 package，应通过 package manager 的 workspace protocol 管理版本，例如 `workspace:*`。

## 可行性判断

这个方案整体可行，并且比 alias、pattern、override 混合方案更简单。

优点：

- package name 就是 env identity。
- 每个 component 的 env 选择是显式的。
- 版本管理交给 npm/package manager。
- 常规 env 不需要本地或云端维护映射表。
- env 能力可以独立发布和升级。
- Bit-lite 核心可以保持更薄。

主要风险：

- package resolution 规则必须清楚。
- env package 自带依赖可能导致工具版本重复。
- Vite/Webpack 插件 resolution 可能受 package root 影响。
- TypeScript、React、Vue 等 peer dependency 需要友好错误提示。
- 没有 workspace override 后，短期定制能力会更少，需要通过 env package composition 或新 env package 解决。

## 第一阶段建议

第一阶段只做最小闭环：

- `bit.json` 在每个 component record 上直接声明 env package ref。
- env package 支持 default export factory。
- env definition 返回 services。
- service targets 只描述 files/patterns，不描述 components/rootDir。
- service runner 使用结构化 input/event/result。
- 先支持 lint、test、typecheck、preview、compile 五类常用 service。
- 不支持 alias。
- 不支持 component pattern env mapping。
- 不支持 workspace env override。
- 不支持复杂 dependency conflict resolution。
- 不支持云端 env registry。

这样可以尽早验证 env package 作为发布单元是否成立。
