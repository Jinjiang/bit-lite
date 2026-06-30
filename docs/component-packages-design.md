# Component Packages Design

## 背景

Bit-lite 当前把 component 主要建模为 workspace 里的一个目录，并按 env 分组运行 service。下一步希望把 component 提升为更接近 npm package 的单位：

- 每个 component 有稳定 ID。
- 每个 component ID 可以映射为 package name。
- component 之间可以通过 package name import。
- 每个 component 可以声明自己的 dependencies、devDependencies、peerDependencies。
- Bit-lite 可以把 component 编译或链接到 `node_modules`，让 IDE、TypeScript、bundler、test runner 都走标准 package resolution。

这个文档先记录宏观设计，不规定最终实现细节。

## 目标

最终希望每个 component 可以对应一个可解析的 package，例如：

```txt
node_modules/@acme/ui.button/
  package.json
  dist/index.js
  dist/index.d.ts
```

其他 component 可以像使用 npm package 一样使用它：

```ts
import { Button } from "@acme/ui.button";
```

而不是依赖相对路径：

```ts
import { Button } from "../../ui/button";
```

## 非目标

初期不一次性解决所有包管理问题：

- 暂不支持复杂 semver 冲突解决。
- 暂不做 publish/version/tag/scope。
- 暂不引入 capsule 或隔离构建环境。
- 暂不强制每个 component 拥有真实独立 `node_modules`。
- 暂不自动检测源码 import 并推导 dependencies。

第一阶段重点是让内部 component 能以 package 形式被解析，并且让依赖关系由显式配置驱动。

## 配置模型

`bit.json` 只作为 workspace 级别的 component 索引。它不承载每个 component 的完整 package metadata，只保留定位和身份信息：

- `path`: component 在 workspace 里的路径。
- `id`: Bit-lite 语义里的 component ID，必须稳定且唯一。
- `packageName`: npm package name。可显式配置，也可从 `id` 推导后固化记录。
- `env`: component 使用的 env package reference。

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

`env` 必须指向一个具体 env package。这个 package 的版本由 semver spec 描述；如果 env package 来自当前 pnpm workspace，使用 pnpm 的 `workspace:*` 约定。

每个 component 目录下放置自己的 `.comp.json`，记录 package 级别的依赖信息：

```json
{
  "dependencies": {
    "@acme/lib.math": "workspace:*",
    "clsx": "^2.1.0"
  },
  "devDependencies": {
    "vitest": "^4.0.0"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

第一阶段所有 component 依赖都需要手动写入 `.comp.json`。未来可以增加源码 import 分析作为辅助提示，但不把自动检测作为初始设计前提。

## Package Name 映射

需要一个明确、可预测、可校验的默认映射规则，同时允许手动覆写 package name。

建议规则：

- 如果 `bit.json` 里配置了 `packageName`，优先使用配置值。
- 如果没有配置，则从 `id` 自动生成并写回显式记录。
- workspace 可以配置默认 npm scope，例如 `@acme`。
- `ui/button` 可以映射为 `@acme/ui.button`。
- `lib/math` 可以映射为 `@acme/lib.math`。

需要校验：

- component ID 必须唯一。
- package name 必须唯一。
- package name 必须是合法 npm package name。
- 自动映射不能产生冲突。
- component ID 改名和 package name 改名应被视为高风险操作。

即使存在默认转换规则，`id` 和 `packageName` 仍然都应该被记录。`id` 是 Bit-lite 语义身份，`packageName` 是 npm resolution 身份，两者不能互相替代。

## Main Entry 检测

`main` 不建议放在 `bit.json` 或 `.comp.json` 里配置。Bit-lite 只支持自动检测 component 根目录下的标准入口文件。

建议检测顺序：

1. `index.ts`
2. `index.tsx`
3. `index.js`
4. `index.jsx`
5. `index.mjs`
6. `index.cjs`
7. `index.esm.js`

如果没有命中入口文件，registry loading 阶段报错。如果未来需要支持更复杂入口，可以在单独 RFC 里讨论，不作为 component package 初始配置的一部分。

## Runtime Registry

Bit-lite 应该在 workspace loading 阶段构建 component package registry。

概念类型：

```ts
type PackageRef = {
  packageName: string;
  version: string;
};

type ComponentPackage = {
  id: string;
  rootDir: string;
  packageName: string;
  env: PackageRef;
  mainFile: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
};
```

registry 负责：

- 记录 component ID 到 package name 的映射。
- 记录 package name 到 component 的反向映射。
- 校验重复 ID、重复 package name、缺失入口文件。
- 读取每个 component 的 `.comp.json`。
- 区分 internal dependency 和 external dependency。
- 建立 component dependency graph。
- 为 `install`、`link`、`compile`、`inspect`、`test`、`preview`、`typecheck` 提供统一 metadata。

判断 internal dependency 时，不能只看 version spec。只要 dependency package name 出现在当前 workspace 的 component package registry 里，就应该被视为 workspace 内部 component dependency；`workspace:*` 是推荐写法，但 registry 仍应以 package name 反查为准。

## Dependency Graph

内部 component 依赖第一阶段只依赖 `.comp.json` 显式声明：

```json
{
  "dependencies": {
    "@acme/lib.math": "workspace:*"
  }
}
```

graph 可以支持：

- 检查 internal dependency 是否存在。
- 检查循环依赖。
- 按拓扑顺序 compile。
- 只 compile 某个 component 及其依赖。
- 未来支持 affected compile。

自动 import detect 可以后续作为 lint/inspect 级别的提示能力加入。初期不根据源码扫描结果隐式修改 graph。

## Install 与输出目录

只要 Bit-lite 需要把 component package 链接进 `node_modules`，就不能直接把普通 package manager 当成唯一入口。需要提供一层 `bit-lite install`：

```sh
bit-lite install
```

这个命令语义上接近 `pnpm install`，但会先读取并解析：

- workspace `bit.json`。
- 每个 component 的 `.comp.json`。
- component package registry。
- internal dependency graph。
- env package references。

然后再把推导出的 package metadata、workspace 内部链接关系和外部依赖交给底层 package manager 或 Bit-lite 自己的链接器处理。

构建产物不建议直接写进 `node_modules`。`node_modules` 可能被 package manager 清理或重写。

建议 Bit-lite 自己管理生成目录：

```txt
.bit-lite/packages/@acme/ui.button/
  package.json
  dist/index.js
  dist/index.d.ts
```

然后在 workspace 根目录生成 symlink：

```txt
node_modules/@acme/ui.button -> .bit-lite/packages/@acme/ui.button
```

好处：

- `node_modules` 只是解析入口。
- 构建产物在 Bit-lite 可控目录里。
- 清理、重建、缓存、watch 更容易设计。
- 避免把用户真实依赖和生成产物混在一起。
- workspace 内部 component dependency 可以通过 symlink 稳定解析。

## Generated Package Manifest

每个 component package 可以生成自己的 `package.json`。

compiled package mode 示例：

```json
{
  "name": "@acme/ui.button",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "dependencies": {
    "@acme/lib.math": "workspace:*",
    "clsx": "^2.1.0"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

source link mode 示例：

```json
{
  "name": "@acme/ui.button",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./index.ts"
  },
  "types": "./index.ts",
  "dependencies": {
    "@acme/lib.math": "workspace:*",
    "clsx": "^2.1.0"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

`devDependencies` 是否写入 generated package manifest 需要按运行场景区分。用于 test/typecheck 的本地 manifest 可以包含它们；用于未来 publish 的 manifest 则通常不应该带上 component 本地 dev dependencies。

## 两种落地模式

### Source Link Mode

第一阶段可以先做 source link mode。

特点：

- 生成 package manifest。
- 创建 `node_modules/<package>` symlink。
- `exports` 和 `types` 暂时指向源码入口。
- 不要求先完成 compile pipeline。

目标：

- 验证 package name import。
- 验证 IDE 和 TypeScript resolution。
- 验证 test、preview、typecheck 能否在 package import 下跑通。
- 尽早暴露 module resolution 问题。

### Compiled Package Mode

第二阶段再引入真正编译产物。

特点：

- component 源码编译到 `.bit-lite/packages/<package>/dist`。
- package manifest 指向 `dist`。
- 生成 `.d.ts`。
- compile 按 dependency graph 拓扑排序。
- watch mode 可增量更新 dist。

目标：

- 更接近真实 npm package。
- 为未来 publish/cache/isolated build 留接口。

## 命令设计

建议新增或扩展这些命令：

```sh
bit-lite install
```

解析 Bit-lite component/env metadata，并完成 external dependencies 安装与 internal component links。

```sh
bit-lite link
```

生成 `.bit-lite/packages` package manifests 和 `node_modules` symlinks。这个命令可以被 `bit-lite install` 调用，也可以用于快速重建链接。

```sh
bit-lite compile
```

按 component graph 编译所有 component packages。

```sh
bit-lite compile @acme/ui.button
```

编译指定 component，以及它依赖的 internal components。

```sh
bit-lite inspect
```

输出 component package metadata、env package refs、dependency graph、entry detection 结果和 registry 校验信息。

```sh
bit-lite clean
```

清理 Bit-lite 生成的 package outputs 和 symlinks。

`build` 先保留给未来更高层的语义，不在当前阶段使用。`graph` 也先不作为独立命令引入，现有或未来的 graph 输出应放进 `inspect`。

## Service 集成

现有 service 可以逐步利用 component package registry。

### Typecheck

初期可以继续按 env group 运行。引入 package link 后，TypeScript resolution 应能解析内部 package imports。

后续可考虑：

- 每个 component package 生成 tsconfig fragment。
- 支持 project references。
- 支持按 dependency graph typecheck。

### Test

test service 仍可按 component root 查找 test files。区别是 test 中 import 内部 component 时可以走 package name。

### Preview

preview app 可以继续从 preview file 入口启动。组件间依赖可通过 package name 解析。

### Compile

compile 应成为新的核心 service 或 command。它负责：

- 读取 component package registry。
- 按 env 选择 compiler/bundler。
- 生成 JS、types、assets。
- 写入 `.bit-lite/packages`。
- 更新 package manifests。

## External Dependencies

每个 component 可以声明自己的 external dependencies。第一阶段不自动检测，只读取 `.comp.json`。

初期策略：

- 把 external dependencies 写入 generated package manifest。
- 通过 `bit-lite install` 把 external dependencies 交给底层 package manager 安装。
- 校验 workspace root 是否已经可 resolve 对应 dependency。
- 对 workspace 内部 component dependency 使用 registry 反查和 symlink 处理。

后续需要讨论：

- root install 还是 per-component install。
- 同一个 external package 多版本要求如何处理。
- package manager 是 pnpm/npm/yarn 还是抽象层。
- generated package manifest 是否参与 workspace package manager。
- 是否只允许 `workspace:*` 表示内部 component dependency，还是允许更具体的 workspace semver spec。

## 风险和顾虑

主要风险：

- `node_modules` 容易被 package manager 重写，所以不能作为唯一状态源。
- `bit-lite install` 需要和底层 package manager 的 lockfile、workspace protocol、hoisting 策略协作。
- source link mode 对某些工具可能需要额外 loader 或 tsconfig 配置。
- compiled package mode 需要解决 `.d.ts`、assets、CSS、Vue/SFC、React JSX 等 env 差异。
- dependency graph 如果只依赖显式配置，可能和真实 import 不一致。
- 如果自动扫描 import，又会引入 parser、alias、conditional exports 等复杂度。
- component package name 一旦被外部代码引用，改名成本会变高。

## 推荐推进顺序

1. 扩展 component config schema，让 `bit.json` 只记录 `path`、`id`、`packageName`、`env`。
2. 为每个 component 引入 `.comp.json`，记录 dependencies、devDependencies、peerDependencies。
3. 实现 component package registry、entry detection 和校验。
4. 实现 `bit-lite inspect`，输出 registry、entry、env、dependency graph 信息。
5. 实现 `bit-lite link` 的 source link mode。
6. 修改 demo workspace，让 component 之间用 package name import。
7. 验证 TypeScript、test、preview 是否能跑通。
8. 设计并实现 `bit-lite install`。
9. 设计并实现 compiled package mode 和 `bit-lite compile`。
10. 再讨论 external dependency conflict policy、publish、cache、isolated build。

## 待讨论问题

- 配置文件应该叫 `bit.json` 还是继续兼容 `bit-lite.json`？
- `env` package reference 在 schema 里是否固定为 `{ packageName, version }`，还是支持字符串 shorthand？
- 默认 package scope 从哪里来？
- `id` 到 `packageName` 的默认转换规则是否应该可配置？
- internal dependency 是否必须使用 `workspace:*`，还是允许其他 workspace semver spec？
- source link mode 下 `exports` 指向 `.ts` 是否对目标工具链足够友好？
- `bit-lite install` 和 pnpm/npm/yarn lockfile 的关系如何设计？
- generated package 是否应该加入 package manager workspace？
