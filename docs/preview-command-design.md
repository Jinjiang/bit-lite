# Preview Command Design

## Overview

`bit-lite preview` 是准备者和编排者；preview vendor 只是 dev-server adapter。命令通过 `bit-lite-preview/node` 的可复用 Node API，把选中的 components 转换为浏览器可以执行的输入，再把一个最小的 JSON contract 交给 Vite 或 Webpack vendor。

这条边界有三个目的：

- docs/demo 的发现、路由和入口生成不再被每个 vendor 重复实现；
- Vite 与 Webpack 服务同一套浏览器 runtime 和三种界面；
- MDX 编译仍由各 env 的 dev-server config 决定，而不是序列化进 vendor runtime。

## Command-owned preparation

对每个选中的 env，命令依次完成：

1. 仅扫描本次选中的 component roots。
2. 稳定排序 component 和文件；第一个 `*.docs.md(x)` 是 docs。命令用 TypeScript parser 静态读取每个 `*.demo.*` 的 runtime value exports，每个 export 各自形成一个 composition，全程不在 Node 中执行 demo module。
3. 从 workspace 解析 `configFile`、可选 `mounter` 和可选 `docsTemplate`。只有 env 实际含 demo 时才要求 `mounter`。
4. 在 workspace 的 `.bit-lite/preview-<env>-*` 下生成一个 HTML 和一个 JavaScript entry。
5. 启动 vendor，并在正常退出、准备失败或 vendor 启动失败时删除命令创建的临时目录。

一个 env 准备失败不会阻止其他 env 启动。失败原因会保留在 proxy manifest；如果全部 env 都失败，命令关闭 proxy 并返回错误。

生成 entry 的核心数据是 `PreviewBrowserComponent[]`：

```ts
const components = [{
  component: { id: "components/ui/button" },
  docs: {
    title: "Button documentation",
    route: "#components%2Fui%2Fbutton?preview=docs",
    load: () => import("../../components/ui/button/button.docs.mdx")
  },
  compositions: [{
    id: "primary/MySecondDemo",
    exportName: "MySecondDemo",
    name: "My Second Demo",
    route: "#components%2Fui%2Fbutton?preview=compositions&name=primary%2FMySecondDemo",
    load: () => import("../../components/ui/button/primary.demo.tsx")
      .then((module) => module["MySecondDemo"])
  }]
}];
```

每一项内容拥有自己的 literal dynamic import。不存在顶层 `loadDocs` 或 `loadComposition` callback，也不把函数放进 JSON runtime。

### Export-level demo authoring

一个 demo 文件可以导出多个 demo。稳定 ID 是 `<demo-file-id>/<export-name>`，因此 `primary.demo.ts` 中的 `MySecondDemo` 对应 `primary/MySecondDemo`。display name 由 export name 生成：camel/Pascal case、数字到大写字母边界、下划线等分隔符以及 acronym-to-word 边界会被拆分，例如 `mySecondDemo` → `My Second Demo`、`XMLCard` → `XML Card`。不再支持单独的 title export。

```ts
import Card from "./index.vue";

export const Primary = { component: Card, props: { title: "Primary card" } };
export const MySecondDemo = { component: Card, props: { title: "Second card" } };
```

`default` export 仍兼容，ID 和名称分别为 `primary/default` 与 `Default`，但不推荐新代码使用。每个 runtime value export 都会被当作 demo，因此 helper 必须保持未导出；type-only exports 会被忽略。无法静态确定名称的裸 `export *` 会在 preparation 阶段报错，请改用显式 named exports。

## Minimal vendor contract

vendor runtime 只包含 server 坐标和预生成文件路径：

```ts
type PreviewPreparedRuntime = {
  server: {
    host: string;
    port: number;
    basePath: string;
    proxyOrigin: string;
  };
  prepared: {
    entryFile: string;
    htmlFile: string;
  };
};
```

它是 JSON-only 的；raw components、browser manifest、MDX options 和 dev-server config 内容都不属于这个 runtime。

Vite adapter 读取已解析的 `configFile`，服务 prepared HTML，并把稳定的 `__bit-lite/preview.js` URL 转换到 prepared entry。Webpack adapter 同样读取 `configFile`，只编译一个 logical entry，并让 docs/demo dynamic imports 形成 lazy chunks。二者都保持原有 ready/result/error/shutdown protocol，并把 HMR 的 public path 指向 proxy 下的 env base。

这里的 `configFile` 是用户维护的 dev-server integration config：Vite 时是 `vite.config`，Webpack 时是 `webpack.config`。它决定 loader/plugin、resolve、framework transform 等开发服务器行为；名称不表示命令要执行 production bundling。

## One document, one entry, three hash surfaces

一个 env 永远服务同一份 HTML 和同一个 logical entry。浏览器 runtime 根据 `location.hash` 选择界面：

```txt
/env/react/#components%2Fui%2Fbutton
/env/react/#components%2Fui%2Fbutton?preview=overview
/env/react/#components%2Fui%2Fbutton?preview=docs
/env/react/#components%2Fui%2Fbutton?preview=compositions&name=primary%2FMySecondDemo
```

- overview：默认界面和 component 首页；当前实现显示 docs 链接与 demo 列表。
- docs：调用所选 component record 的 `docs.load()`，然后交给 docs template。
- named demo：调用所选 composition record 的 `load()`，然后交给 env mounter。

缺少 component、docs、demo 或 mounter，以及 loader/render 错误，都显示受控状态。`hashchange` 和接受的 HMR update 只重绘当前 surface，不重新生成 entry 或重新加载 HTML。demo 切换、HMR replacement 和 shutdown 前会先等待 mounter cleanup，并为新的 framework mount 使用新的 host ownership boundary。已有 export 的实现变化保留 HMR；新增、删除或重命名 export 会改变 preparation catalog，本次设计要求重启 `bit-lite preview`。

## Browser renderer inputs

```ts
type StartPreviewOptions = {
  components: PreviewBrowserComponent[];
  mounter?: PreviewMounter;
  docsTemplate?: PreviewDocsTemplate;
  renderOverview?: PreviewOverviewRenderer;
};
```

三种 renderer 都是 optional：

- 没有 `docsTemplate` 时使用 shared `DefaultDocsTemplate`；它只收到 `{ docs }`。
- 没有 `renderOverview` 时使用 shared demo-list overview。
- 没有 `mounter` 仍可访问 overview/docs；进入 demo 时显示 controlled missing-mounter state。命令会在已发现 demo 的正常 env 配置中提前拒绝这种情况。

自定义 overview 是一个刻意收窄的 browser-only hook。它收到 component、docs descriptor 和 composition descriptors，所有 `load` 函数都会先移除：

```ts
type PreviewOverviewProps = {
  component: { id: string };
  docs?: { title?: string; route: string };
  compositions: Array<{
    id: string;
    exportName: string;
    name: string;
    route: string;
  }>;
};
```

这个接口允许未来替换首页 renderer，但不是一个通用 extension system。

## Node package boundary and HTML assets

准备与代理的实现位于 `bit-lite-preview/node`，但策略所有权仍在命令：`bit-lite` 决定选择哪些 env、何时准备、何时启动 vendor，以及何时清理。Node API 只接受结构化 component/config 输入，不反向依赖 `bit-lite`、`bit-lite-context` 或 `bit-lite-env`，因此不会形成 package cycle。

prepared entry HTML、proxy shell 和状态页都是 `bit-lite-preview/src/assets` 下的独立 HTML 文件。Node 代码通过文件读取获取模板，package build 会把它们复制到 `dist/assets`；这样 HTML/CSS/脚本可以按正常文件 review，而不是藏在一行 TypeScript 字符串中。

## MDX compile options vs. DocsTemplate

这两层职责必须保持分离：

- `demo-utils` 的 `mdxOptions` 是普通 JavaScript 编译配置，可以含 remark/rehype plugin functions。每个 Vite/Webpack config 显式 import 它，再交给自己的 native MDX plugin/loader。
- `PreviewDocsTemplate` 是浏览器 runtime 配置，接收已经加载的 `{ docs }` module 并决定如何渲染。

示例：

```ts
// vite.config.ts
import mdx from "@mdx-js/rollup";
import { mdxOptions } from "demo-utils";

export default {
  plugins: [mdx({ ...mdxOptions, include: /\.docs\.mdx?$/ })]
};
```

```ts
// webpack.config.ts
import { createRequire } from "node:module";
import { mdxOptions } from "demo-utils";

const require = createRequire(import.meta.url);
export default {
  module: {
    rules: [{
      test: /\.docs\.mdx?$/,
      use: { loader: require.resolve("@mdx-js/loader"), options: mdxOptions }
    }]
  }
};
```

`mdxOptions` 不进入 worker JSON，也不需要 serialization。不同 env 可以用 `createMdxOptions()` 追加局部 plugins，同时保留 shared defaults。

## Future site shell boundary

未来网站可能加入确定的 Design System CSS、全局脚本、header 或 React layout。当前不提供 vendor 级扩展点，也不把这些内容设计成每个 env 的配置。

预留边界位于 shared browser entry/runtime：未来可以让它固定 import 一个站点 package，或让 prepared HTML 固定加载该 package 的 CSS/脚本。站点设计确定后可以通过升级 package 版本统一维护，不要求 vendor 特殊配置。除了当前窄范围的 `renderOverview`，这个 site-shell boundary 暂时保持 private。

## Proxy and failure model

主 proxy 默认监听 `127.0.0.1:4000`：

- `/`：workspace/env/component shell；
- `/__bit-lite/manifest.json`：ready、starting、failed、skipped 状态与公开 hash links；
- `/env/<encoded-env>/...`：只转发到对应 env dev server，包括 assets、lazy chunks、Vite WebSocket 和 Webpack HMR event stream。

旧的 path routes（例如 `/component/docs` 和 `/component/compositions/primary`）不再是 preview surface。迁移时应改成 env base 加 hash route。

## Verification

```sh
pnpm --filter bit-lite-preview test
pnpm --filter demo-utils test
pnpm --filter demo-config test
pnpm --filter demo-vendors test
pnpm --filter bit-lite test
pnpm typecheck
pnpm build
```

当前 intentionally deferred 的内容是具体 homepage/site layout、Design System 视觉规范以及 production docs build；它们不影响上述 prepared runtime 和 renderer contracts。
