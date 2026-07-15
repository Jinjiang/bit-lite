# Env packages design

Bit-lite 把 env 视为 package，而不是 workspace 配置中的 inline 对象。每个
component 都必须在 `bit-lite.json` 中显式声明自己的 env package：

```json
{
  "path": "components/ui/button",
  "id": "ui/button",
  "packageName": "@acme/ui.button",
  "env": {
    "packageName": "@acme/env.react",
    "version": "workspace:*"
  }
}
```

## Env 的两种存在方式

- `workspace:` 只有在目标同时出现在当前 Bit component registry 且
  `.comp.json` 为 `kind: "env"` 时才表示本地 env component。
- 其他 version spec 一律表示外部 package，从选择该 env 的 component
  development dependency context 中解析。即使根 pnpm workspace 或 Bit registry
  中存在同名 package，也不会改变这条身份规则。

`component.env` 会派生出逻辑 devDependency，不要求在
`.comp.json.devDependencies` 中重复。`workspace:` env 使用独立的 internal tooling
link，不会被误当成普通 runtime dependency。如果 env 的 `extends` parent 同时也是
它自身选择的 env，则 parent 仍以一次 normal runtime dependency 表示。

## 静态 JSON 入口

Env package 的默认 `"."` export 必须直接指向一个 JSON 文件。JSON 内容是静态
`EnvDefinition`，不支持 factory：

```json
{
  "name": "@acme/env.react",
  "extends": "@acme/env.node",
  "services": {
    "test": {
      "vendor": "@acme/vendors/jest",
      "config": { "configFile": "@acme/config/jest-react" }
    },
    "preview": {
      "vendor": "@acme/vendors/webpack",
      "config": {
        "configFile": "./webpack-react.js",
        "mounter": "@acme/config/react-mounter"
      }
    }
  }
}
```

第一阶段只支持 `test`、`preview`、`compile` 三个 service。每个 service 只有
`vendor` 和可选的 JSON-safe `config`。Compile config 刻意保持 vendor-specific；
不同 env 可以选择不同 compiler vendor 或不同 tsconfig 形态。

Env 不声明 `targets`、`files` 或 `patterns`。Component selection 属于 command，
测试文件等发现规则属于 vendor；当前 demo test vendors 继续硬编码自己的
`*.test.*` / `*.spec.*` 规则。

## `extends`

`extends` 使用 parent 的完整 package name。Parent 必须出现在 child env package 的
normal `dependencies`，不能只出现在 `devDependencies`。Loader 从 child package
context 递归解析 parent，并按以下规则合成：

- top-level `config` shallow merge；
- child 声明的 service 完整替换 parent service，不做 deep merge；
- 未被 child 替换的 service 保留其 declaring env origin；
- canonical JSON entry 用于 cache 与 cycle detection。

Vendor、`configFile`、`mounter`、`docsTemplate` 等模块字段从 effective service 的
declaring JSON entry origin 解析。相对路径不得逃出该 package root；package subpath
先从 declaring env dependency context 解析，再使用有记录的 workspace fallback。

## 本地 env materialization

本地 env component 的源码入口为 `index.json`。Bit-lite 在读取 env 之前使用内置、
不可配置的固定 TypeScript compiler：复制 JSON/static 文件，并把 env 自己的 `.ts`
support file 输出到相同相对位置的 `.js`。例如：

```text
index.json          -> dist/index.json
webpack-react.ts    -> dist/webpack-react.js
```

生成 package 的默认 export 指向 `./dist/index.json`。这条固定 compiler 路径不会读取
env 自己的 `services.compile`，因此 env package 是级联 compile 的终止边界。

## 普通 component compile

普通 component 按 internal runtime dependency layer 编译。每个 component 独立读取
自己的 effective `services.compile`、declaring origin 和 opaque config；同一图中可
以不同 compiler 或配置运行。某层失败会阻止其 dependent later layers，但不会阻止
同层或其他独立分支完成。

`install --compile` 的固定顺序是：dependency install、component link、本地 env
materialization、JSON env loading/inheritance、普通 component compile。

## 运行时 identity

配置中的 `env.version` 保留用户请求的 version spec；loader 另外读取实际安装的
package manifest version。跨 service/worker 边界统一使用：

```ts
env: {
  packageName: string;
  requestedVersion: string;
  installedVersion: string;
}
```

Workspace group 直接复用 loaded env runtime，不再复制 package-name-only 字段。
Vendor task/result、test result store、compile vendor input、preview prepared/skipped
state 与 proxy manifest 都携带同一个 JSON-safe identity。内部 key 从 package ref
派生；现阶段 preview URL 仍只使用 package name，因为同一 workspace 不允许同名 env
使用多个 version spec。

## Demo

`demo-env-node` 与 `demo-env-vue` 是外部式 pnpm packages，不在 demo Bit registry。
`@my-scope/env.react` 则是 `demo-workspace/components/envs/react` 中的真实 env
component。React JSON 以完整包名 extends Node，Webpack config 与 JSON 相邻，由固定
compiler 生成；mounter/docs template 仍通过 `demo-config` export subpaths 解析。
