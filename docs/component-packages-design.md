# Component Packages Design

## 背景

Bit-lite 当前把 component 主要建模为 workspace 里的一个目录，并按 env 分组运行 service。下一步希望把 component 提升为更接近 npm package 的单位：

- 每个 component 有稳定 ID。
- 每个 component ID 可以一对一映射为 package name。
- component 之间可以通过 package name import。
- 每个 component 可以声明自己的 dependencies。
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

- 暂不设计完整 external dependency installation。
- 暂不支持复杂 semver 冲突解决。
- 暂不做 publish/version/tag/scope。
- 暂不引入 capsule 或隔离构建环境。
- 暂不强制每个 component 拥有真实独立 `node_modules`。

第一阶段重点是让内部 component 能以 package 形式被解析。

## 配置模型

可以在未来的 `bit.json` 或当前 `bit-lite.json` schema 中引入更明确的 component 定义。

示例：

```json
{
  "components": {
    "components/ui/button": {
      "id": "ui/button",
      "packageName": "@acme/ui.button",
      "env": "react",
      "main": "index.ts",
      "dependencies": {
        "@acme/lib.math": "workspace:*",
        "clsx": "^2.1.0"
      }
    }
  }
}
```

建议字段：

- `id`: Bit-lite 语义里的 component ID，必须稳定且唯一。
- `packageName`: npm package name。可显式配置，也可从 `id` 推导。
- `env`: component 使用的 env。
- `main`: component 入口文件，默认可为 `index.ts` / `index.tsx` / `index.js`。
- `dependencies`: component 依赖声明，可以包含内部 component package 和外部 npm package。

## Package Name 映射

需要一个明确、可预测、可校验的映射规则。

建议规则：

- 如果配置了 `packageName`，优先使用配置值。
- 如果没有配置，则从 `id` 自动生成。
- workspace 可以配置默认 npm scope，例如 `@acme`。
- `ui/button` 可以映射为 `@acme/ui.button`。
- `lib/math` 可以映射为 `@acme/lib.math`。

需要校验：

- package name 必须唯一。
- package name 必须是合法 npm package name。
- 自动映射不能产生冲突。
- component ID 改名和 package name 改名应被视为高风险操作。

## Runtime Registry

Bit-lite 应该在 workspace loading 阶段构建 component package registry。

概念类型：

```ts
type ComponentPackage = {
  id: string;
  rootDir: string;
  envName: string;
  packageName: string;
  mainFile: string;
  dependencies: Record<string, string>;
};
```

registry 负责：

- 记录 component ID 到 package name 的映射。
- 记录 package name 到 component 的反向映射。
- 校验重复 ID、重复 package name、缺失入口文件。
- 区分 internal dependency 和 external dependency。
- 建立 component dependency graph。
- 为 build、link、test、preview、typecheck 提供统一 metadata。

## Dependency Graph

内部 component 依赖可以通过 `dependencies` 显式声明，也可以未来通过源码 import 分析辅助发现。

第一阶段建议只依赖显式声明：

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
- 按拓扑顺序 build。
- 只 build 某个 component 及其依赖。
- 未来支持 affected build。

外部依赖初期只做 metadata 和校验，不负责安装。

## 输出目录

不建议把真实构建产物直接写进 `node_modules`。`node_modules` 可能被 package manager 清理或重写。

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
  "types": "./index.ts"
}
```

## 两种落地模式

### Source Link Mode

第一阶段可以先做 source link mode。

特点：

- 生成 package manifest。
- 创建 `node_modules/<package>` symlink。
- `exports` 和 `types` 暂时指向源码入口。
- 不要求先完成 build pipeline。

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
- build 按 dependency graph 拓扑排序。
- watch mode 可增量更新 dist。

目标：

- 更接近真实 npm package。
- 为未来 publish/cache/isolated build 留接口。

## 命令设计

建议新增或扩展这些命令：

```sh
bit-lite link
```

生成 `.bit-lite/packages` package manifests 和 `node_modules` symlinks。

```sh
bit-lite build
```

按 component graph 编译所有 component packages。

```sh
bit-lite build @acme/ui.button
```

编译指定 component，以及它依赖的 internal components。

```sh
bit-lite graph
```

输出 component package dependency graph。

```sh
bit-lite clean
```

清理 Bit-lite 生成的 package outputs 和 symlinks。

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

### Build

build 应成为新的核心 service 或 command。它负责：

- 读取 component package registry。
- 按 env 选择 compiler/bundler。
- 生成 JS、types、assets。
- 写入 `.bit-lite/packages`。
- 更新 package manifests。

## External Dependencies

每个 component 可以声明自己的 external dependencies，但安装策略可以晚一点设计。

初期策略：

- 把 external dependencies 写入 generated package manifest。
- 校验 workspace root 是否已经可 resolve 对应 dependency。
- 不自动安装。

后续需要讨论：

- root install 还是 per-component install。
- 同一个 external package 多版本要求如何处理。
- package manager 是 pnpm/npm/yarn 还是抽象层。
- generated package manifest 是否参与 workspace package manager。
- 是否使用 `workspace:*` 表示内部 component dependency。

## 风险和顾虑

主要风险：

- `node_modules` 容易被 package manager 重写，所以不能作为唯一状态源。
- source link mode 对某些工具可能需要额外 loader 或 tsconfig 配置。
- compiled package mode 需要解决 `.d.ts`、assets、CSS、Vue/SFC、React JSX 等 env 差异。
- dependency graph 如果只依赖显式配置，可能和真实 import 不一致。
- 如果自动扫描 import，又会引入 parser、alias、conditional exports 等复杂度。
- component package name 一旦被外部代码引用，改名成本会变高。

## 推荐推进顺序

1. 扩展 component config schema，加入 `id`、`packageName`、`main`、`dependencies`。
2. 实现 component package registry 和校验。
3. 实现 `bit-lite link` 的 source link mode。
4. 修改 demo workspace，让 component 之间用 package name import。
5. 验证 TypeScript、test、preview 是否能跑通。
6. 设计并实现 compiled package mode。
7. 加入 dependency graph、topological build、clean、watch。
8. 再讨论 external dependency installation policy。

## 待讨论问题

- 配置文件应该叫 `bit.json` 还是继续兼容 `bit-lite.json`？
- component key 应该继续是 glob/path，还是改成显式 component records？
- 默认 package scope 从哪里来？
- `id` 到 `packageName` 的默认转换规则是否应该可配置？
- internal dependency 是否必须写在 `dependencies` 里，还是允许自动推断？
- source link mode 下 `exports` 指向 `.ts` 是否对目标工具链足够友好？
- build 应该是独立 command，还是一个内置 service？
- generated package 是否应该加入 package manager workspace？
