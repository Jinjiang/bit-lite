# Env Packages Design

## 背景

Bit-lite 当前把每个 component 使用的 env 定义写在 workspace 配置文件里。随着 env 变复杂，`bit.json` 或 `bit-lite.json` 很容易变成一个巨大配置文件：

- 每个 env 需要声明 services。
- 每个 service 需要声明 runner、vendor、targets、config。
- lint、test、typecheck、preview 等工具都有自己的默认配置。
- React、Vue、Node 等常规 env 会重复出现大量相似配置。

未来希望把 env 定义发布为独立 npm package。workspace 配置只引用 env package name，具体 env 能力、默认 service、默认工具配置都由 env package 提供。

这个文档先记录早期技术设计和可行性判断，不规定最终实现细节。

## 目标

`bit.json` 只负责 workspace 级别组装：

- 声明 component pattern。
- 声明每个 component pattern 使用哪个 env package。
- 为特定 env package 提供少量 workspace override。

env package 负责具体环境能力：

- 默认 services。
- 默认 service runner。
- 默认 targets 规则。
- 默认工具配置。
- 需要的 npm dependencies。

示例：

```json
{
  "defaultEnv": "@acme/bit-env-node",
  "components": {
    "components/ui/**": "@acme/bit-env-react",
    "components/vue/**": "@acme/bit-env-vue",
    "components/lib/**": "@acme/bit-env-node"
  },
  "envs": {
    "@acme/bit-env-react": {
      "config": {
        "preview": {
          "port": 3301
        }
      }
    }
  }
}
```

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
  "components": {
    "components/ui/**": "react"
  }
}
```

原因：

- alias 需要额外维护映射关系。
- 本地 alias 会增加 workspace 配置复杂度。
- 云端 alias 表会引入中心化 registry 负担。
- 常规 env 的细节应该通过 npm package name 和 package manager 解决。

因此，env package name 就是 env identity。

## 配置模型

建议未来配置文件以 package name 作为唯一 env 标识。

```json
{
  "defaultEnv": "@acme/bit-env-node",
  "components": {
    "components/lib/**": "@acme/bit-env-node",
    "components/ui/**": "@acme/bit-env-react"
  },
  "envs": {
    "@acme/bit-env-node": {},
    "@acme/bit-env-react": {
      "config": {
        "lint": {
          "args": ["--max-warnings=0"]
        }
      }
    }
  }
}
```

`envs` 是可选 override。没有 override 时，Bit-lite 直接加载 env package 默认定义。

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

env package 可以导出 object，也可以导出 factory。建议优先支持 factory，因为它能接收 workspace override。

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
          components: [
            {
              patterns: [
                {
                  include: ["**/*.{js,jsx,ts,tsx}"],
                  exclude: ["dist/**"]
                }
              ]
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
          components: [
            {
              patterns: [
                {
                  include: ["**/*.{test,spec}.{js,jsx,ts,tsx}"]
                }
              ]
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
  envPackageRoot: string;
  workspaceRoot: string;
  userConfig?: unknown;
};
```

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
  mode?: "run-once" | "watch" | "serve";
};
```

`name` 必须等于 env package name，或者在加载时被 Bit-lite 归一化成 env package name。这样可以避免 alias 和 package identity 不一致。

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
  service: "lint" | "test" | "typecheck" | "preview" | string;
  vendor: string;
  run(input: ServiceInput, host?: ServiceHost): ServiceTask | Promise<ServiceResult>;
};
```

runner 输入和输出应该是结构化 JSON，而不是依赖命令行字符串。

## 路径解析规则

路径解析必须在早期明确，否则 env package 和 workspace override 会很容易混乱。

建议规则：

- env package 内声明的相对路径，相对 env package root 解析。
- `bit.json` 里 workspace override 的相对路径，相对 workspace root 解析。
- component source 永远来自 workspace。
- runner package 优先从 env package 解析，失败后再从 workspace root 解析。
- config package subpath 通过 Node package exports 解析。

示例：

```ts
configFile: "./configs/vite"
```

如果来自 env package，解析为：

```txt
node_modules/@acme/bit-env-react/dist/configs/vite.js
```

如果来自 workspace override，解析为：

```txt
<workspace-root>/configs/vite.config.ts
```

## Workspace Override

workspace 可以覆盖 env package 的部分配置，但不应该复制完整 env 定义。

示例：

```json
{
  "envs": {
    "@acme/bit-env-react": {
      "config": {
        "lint": {
          "args": ["--max-warnings=0"]
        },
        "preview": {
          "port": 3301
        }
      }
    }
  }
}
```

merge 规则需要谨慎设计。早期建议使用浅层 service-level merge：

- env package 提供完整默认 service definition。
- workspace override 只覆盖对应 service 的 `config` 和少量标准字段。
- 不支持任意深层魔法 merge。
- 如果需要完全替换某个 service，应显式声明 `replace: true` 或类似机制。

## Targets 模型

env package 应该能声明默认 targets。Bit-lite 根据 component 和 pattern 解析出具体 files，再传给 runner。

概念模型：

```ts
type ServiceTargetInput = {
  files?: string[];
  patterns?: ServiceTargetPattern[];
  components?: ServiceComponentTargetSelector[];
};

type ServiceTargetPattern = {
  kind?: string;
  include?: string[];
  exclude?: string[];
  rootDir?: string;
};

type ServiceComponentTargetSelector = {
  component: ComponentRef;
  patterns?: ServiceTargetPattern[];
  files?: string[];
  filter?: Record<string, unknown>;
};
```

这个模型支持：

- lint 对所有源码文件生效。
- test 只匹配 `*.test.*` 和 `*.spec.*`。
- preview 查找 `preview.ts`、`preview.tsx` 或 docs 文件。
- typecheck 可以选择 workspace-level tsconfig，也可以未来支持 component-level project references。

## Service 重新定义方向

### Lint

lint service 应该定义为：

- 输入：component targets、config file、args。
- 输出：diagnostics、summary。
- 不依赖 human-readable CLI output 判断结果。

ESLint、Oxlint、Biome 都应该去掉 demo hardcode。默认规则属于 env package 或 config file，不属于 runner。

### Test

test service 应该定义为：

- 输入：test targets、config file、run mode。
- 输出：suites、cases、failures、summary。
- watch mode 通过结构化 event 更新状态。

CLI output 可以作为 `output` event 附带，但不应该是主要数据源。

### Typecheck

typecheck 不应该复用 compile runner。

typecheck service 应该定义为：

- 输入：tsconfig、component set、可选 project references。
- 输出：diagnostics、files count、errors、warnings。
- runner 可以是 TypeScript API、`tsc`、`tsgo`。

TypeScript compile/transpile 是另一个 service，不应和 typecheck 混在一起。

### Preview

preview 不应该复用一次性 Vite/Webpack build runner。

preview service 应该定义为：

- 输入：preview entries、docs entries、base、port、config file。
- 输出：server url、host、port、base、entries。
- 生命周期：启动 dev server，发送 `ready` event，直到 abort 时关闭。

Vite preview 和 Webpack preview 应该是 dev-server runner，而不是 compile runner。

### Compile

compile service 独立存在，用于产出 artifacts。

compile service 应该定义为：

- 输入：entry targets、output dir、config。
- 输出：artifacts、diagnostics、summary。

它可以复用 Vite/Webpack/Rollup/esbuild/SWC/Babel，但语义和 preview 不同。

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

## 加载流程

Bit-lite 加载 workspace 时：

1. 读取 `bit.json`。
2. 根据 component patterns 发现 components。
3. 收集所有 env package names。
4. 从 workspace root 解析并加载 env package。
5. 调用 env factory，传入 package root、workspace root、user config。
6. 得到 env definition。
7. 根据 component pattern 把 components 分组到 env package。
8. 运行 service 时加载对应 runner package。
9. Bit-lite 解析 targets，并把结构化 input 传给 runner。
10. runner 通过结构化 event/result 返回执行信息。

## 可行性判断

这个方案整体可行，并且比 alias 方案更简单。

优点：

- package name 就是 env identity。
- 版本管理交给 npm/package manager。
- 常规 env 不需要本地或云端维护映射表。
- env 能力可以独立发布和升级。
- Bit-lite 核心可以保持更薄。

主要风险：

- package resolution 规则必须清楚。
- env package 自带依赖可能导致工具版本重复。
- Vite/Webpack 插件 resolution 可能受 package root 影响。
- TypeScript、React、Vue 等 peer dependency 需要友好错误提示。
- workspace override 和 env default 的 merge 规则不能过度魔法。

## 第一阶段建议

第一阶段只做最小闭环：

- `bit.json` 支持直接用 env package name。
- env package 支持 default export factory。
- env definition 返回 services。
- service runner 使用结构化 input/event/result。
- 先支持 lint、test、typecheck、preview 四类常用 service。
- 不支持 alias。
- 不支持复杂 dependency conflict resolution。
- 不支持云端 env registry。

这样可以尽早验证 env package 作为发布单元是否成立。
