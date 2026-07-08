# Preview Command Design

## 背景

`bit-lite test --watch` 已经形成了一条可复用的命令链路：

1. CLI 解析参数。
2. 加载 workspace。
3. 根据 `--filter` 选择 components。
4. 按 env 分组。
5. 为每个 env 的 service vendor 创建一个 worker task。
6. 由 `watchVendorTasks()` 统一管理 terminal、worker 输出、信号和 shutdown。

`preview` command 希望复用这条 watch 模式，但它的产物不是测试结果，而是一组长期运行的 dev servers：

- 每个 env 启动一个 preview vendor dev server。
- 每个 preview vendor 负责渲染该 env 支持的 component docs 和 compositions。
- docs 来自 component 根目录下的 `.docs.md` / `.docs.mdx` 文档。
- compositions 来自 component 根目录下的 `*.demo.*` demo 入口文件。
- 主进程除了显示统一 terminal 输出，还启动一个主 proxy server。
- 主 proxy server 把不同 preview vendor 暴露在不同端口上的内容汇总到同一个端口，形成一个统一网站。

## 目标

实现一个长期运行的命令：

```sh
bit-lite preview --workspace <dir>
bit-lite preview --workspace <dir> --filter <component-pattern>
bit-lite preview --workspace <dir> --port 4000
```

运行时行为：

- 选择 components 后，按 env 分组。
- 对每个定义了 `services.preview` 的 env 启动一个 preview vendor task。
- 每个 vendor task 启动自己的 dev server，并在 server ready 后汇报 host、port、base path 等基本信息。
- 主进程启动一个 proxy server，默认监听 `127.0.0.1:4000`，端口冲突时自动寻找下一个可用端口。
- 统一网站提供 workspace 级入口、env 列表、component 列表、docs 链接和 composition 链接。
- 所有 vendor 页面、assets、HMR websocket 都通过主 proxy server 的同一个端口访问。
- terminal 使用现有 managed terminal 风格展示每个 env preview task 的状态、详情和原始输出。
- 按 `q` / `Ctrl+C` 或收到 `SIGINT` / `SIGTERM` 时关闭 proxy server 和所有 vendor dev servers。

## 非目标

第一阶段不解决这些问题：

- 不设计完整 docs 站点主题系统。
- 不要求所有 env 共用同一个 MDX runtime。
- 不在主进程编译 MDX。MD/MDX 渲染属于 preview vendor，因为它依赖 env 的框架、bundler 和插件。
- 不要求跨 env 的 HMR 状态共享。
- 不处理 production docs build。
- 不处理 component package registry、node_modules link、capsule 或隔离构建环境。
- 不自动推导 component dependencies。
- 不把 `preview` 建模为 env 对象上的方法。它仍然是 command 读取 env service config 后运行 vendor task。

## 用户体验

### 成功启动

```txt
bit-lite preview

Preview: http://127.0.0.1:4000

Use Up/Down and Enter for raw terminal. Press q or Ctrl+C to stop.

> Vite React Preview (react) ready      2 components http://127.0.0.1:41731
  Vite Vue Preview   (vue)   building   1 component
  Static Preview     (node)  ready      1 component http://127.0.0.1:41733
```

主站点：

- `GET /`：workspace preview shell，列出 envs 和 components。
- `GET /__bit-lite/manifest.json`：聚合后的 manifest。
- `GET /env/<encoded-env-name>/<encoded-component-id>/docs`：代理到对应 env preview vendor 的 component docs route。
- `GET /env/<encoded-env-name>/<encoded-component-id>/compositions`：代理到对应 env preview vendor 的 component compositions 列表 route。
- `GET /env/<encoded-env-name>/<encoded-component-id>/compositions/<encoded-composition-id>`：代理到对应 env preview vendor 的单个 composition route。
- `GET /env/<encoded-env-name>/<encoded-component-id>/...`：预留给同一 component 下的其他 env-scoped preview routes。

### 部分 env 不支持 preview

如果所选 components 涉及的某些 env 没有配置 `services.preview`：

- 命令继续启动其他 env 的 preview。
- terminal 或启动日志显示 skipped env。
- 主站 manifest 保留 skipped 信息，方便用户知道为什么某些 components 不出现在 preview 中。

如果全部 selected env 都没有 `services.preview`：

```txt
No preview tasks found.
Selected envs: node, react
Make sure each selected env defines services.preview in the workspace config.
```

### 端口

建议参数：

- `--host <host>`：主 proxy host，默认 `127.0.0.1`。
- `--port <port>`：主 proxy port，默认 `4000`。

vendor dev server 端口暂不暴露 CLI 参数。主进程默认从 `6000` 开始按 env task 顺序分配，遇到占用端口就继续向后寻找。

## Env Config

`bit-lite-env` 需要把 `preview` 加入支持的 env service names。

概念类型：

```ts
export const supportedEnvServiceNames = ["test", "preview"] as const;

export type PreviewServiceConfig = JsonObject & {
  configFile: string;
  mounter?: string;
  docsTemplate?: string;
};

export type EnvServiceConfigMap = {
  test: EnvServiceConfig<TestServiceConfig>;
  preview: EnvServiceConfig<PreviewServiceConfig>;
};
```

示例 workspace config：

```json
{
  "envs": {
    "react": {
      "services": {
        "preview": {
          "vendor": "demo-vendors/previewers/vite-react",
          "config": {
            "configFile": "demo-config/previewers/vite-react",
            "mounter": "demo-config/previewers/react-mounter",
            "docsTemplate": "demo-config/previewers/react-docs-template"
          }
        }
      }
    }
  }
}
```

`services.preview.config.configFile` 指向对应 env vendor 使用的 webpack config file 或 Vite config file。

`services.preview.config.mounter` 是可选的 module specifier，指向一个 mounter 函数。mounter 接收当前要展示的 demo/composition，并把它渲染到 preview 页面上的 DOM root。React env 可以用 React root 渲染，Vue env 可以 `createApp()`，其他 env 也可以用自己的挂载方式。

`services.preview.config.docsTemplate` 是可选的 module specifier，指向 docs template。docs template 负责把 component docs 内容、component metadata 和 composition links 组织成最终 docs 页面。它对应原版 Bit 里的 docs template 概念，但第一阶段只作为 env preview vendor 的输入，不在主程序里执行。

文档和 demo 入口不放在 config 里描述，也不支持 `docsDir`、`include`、`exclude`。第一阶段由 vendor 直接基于 `runtime.data.components` 查找 docs 和 compositions，这和当前 test vendor 自行查找 test files 的方式保持一致。

## Command Flow

`runPreviewCommand(parsed)` 的整体流程：

1. `loadWorkspace(parsed.workspaceRoot)`。
2. `selectComponentRefs(workspace.components, parsed.componentFilters)`。
3. `groupSelectedComponentsByEnv(workspace, components)`。
4. 为每个拥有 `group.env.services.preview` 的 env 创建 `VendorTaskStartOptions`。
5. 启动主 proxy server，确定实际 `proxyOrigin`。
6. 为每个 task 准备 preview runtime data：
   - vendor server host。
   - vendor server port，从 `6000` 开始由主进程分配。
   - vendor base path，例如 `/env/<encoded-env-name>/`。
   - proxy public origin，例如 `http://127.0.0.1:4000`。
7. 启动 preview vendor tasks，使用 worker mode。
8. 监听每个 task 的 `result` message，只更新该 env 的 ready server 信息。
9. 启动 managed terminal，title 使用函数动态显示主 preview URL。
10. 等待用户或系统 shutdown。
11. 关闭 proxy server，再停止 vendor tasks。

## Vendor Task Helper Changes

当前 `watchVendorTasks()` 会创建 tasks、启动 terminal 并阻塞直到 shutdown。`preview` 需要在 tasks 启动后把 task result 接入 proxy server 的状态，并在 shutdown 时清理 proxy server。因此建议做一个小的、向后兼容的扩展，而不是复制整套 watch 逻辑。

建议新增 options：

```ts
export type WatchVendorTasksOptions<...> = {
  serviceId: string;
  label: string;
  title: ManagedTerminalOptions["title"];
  canAttach?: ManagedTerminalOptions["canAttach"];
  worker?: WorkerRunnerOptions;
  formatResult(result: unknown): string[] | Error;
  formatStoppingMessage?(reason: string): string | undefined;
  isInteractiveTerminal?(): boolean;
  nonInteractiveMode?: "snapshot-and-exit" | "keep-alive";
  onTasksStarted?(tasks: VendorTask[]): void | (() => void) | Promise<void | (() => void)>;
};
```

语义：

- `test --watch` 保持默认 `nonInteractiveMode: "snapshot-and-exit"`，便于测试。
- `preview` 使用 `nonInteractiveMode: "keep-alive"`，即使在非 TTY 环境也一直运行到 signal。
- `onTasksStarted()` 在 worker tasks 已创建并开始监听输出后调用。
- 如果 `onTasksStarted()` 返回 cleanup，`watchVendorTasks()` 在 shutdown finally 中调用。

如果后续 `watchVendorTasks()` 继续变复杂，可以再拆出更底层的 `startVendorTasks()`。第一阶段先用 hook，改动面更小。

## Vendor Runtime Data

当前 `VendorData` 包含：

```ts
type VendorData = {
  envName: string;
  components: ComponentRef[];
  config: VendorConfig;
  args: CliArguments;
  context?: WorkspaceRuntime;
};
```

`preview` 需要给 vendor 传递命令运行时分配的信息。建议增加一个可选的、JSON-only 的 `runtime` 字段：

```ts
type VendorData<Config extends VendorConfig = VendorConfig, Runtime extends JsonObject = JsonObject> = {
  envName: string;
  components: ComponentRef[];
  config: Config;
  args: CliArguments;
  context?: WorkspaceRuntime;
  runtime?: Runtime;
};
```

preview runtime 概念类型：

```ts
type PreviewVendorRuntime = {
  host: string;
  port: number;
  basePath: string;
  proxyOrigin: string;
};
```

这样 env 的静态 service config 和命令运行时数据不会混在一起。已有 vendors 可以忽略 `runtime` 字段，不受影响。

## Preview Vendor Protocol

每个 preview vendor 仍然导出标准 `meta: VendorDefinition` 和 default runner function。

```ts
export const meta: VendorDefinition = {
  id: "vite-react-preview",
  label: "Vite React Preview",
  hint: "Serve React component docs with Vite",
  moduleUrl: import.meta.url
};
```

vendor 启动后应发送：

1. `{ type: "ready" }`：runner 初始化完成。
2. `{ type: "status", status: "building" }`：正在构建或扫描 docs。
3. `{ type: "result", data }`：dev server 已经监听成功，server 基本信息可用。
4. `{ type: "status", status: "ready" }`：稳定等待请求。

preview result 只承载 server ready 信息。docs 列表、composition 列表、component routes、diagnostics 不通过 vendor result 回传；主程序基于 selected components 和固定 route 约定生成聚合页面，具体文件是否存在、如何渲染、缺失时展示什么页面，都由对应 env vendor 负责。

preview result 概念类型：

```ts
type PreviewServiceResult = {
  service: "preview";
  vendor: string;
  envName: string;
  mode: "serve";
  server: PreviewServerInfo;
};

type PreviewServerInfo = {
  origin: string;
  host: string;
  port: number;
  basePath: string;
};
```

vendor dev server 必须服务固定 env base path。主 proxy 把 react env 挂在 `/env/react/` 时，component route 约定是：

```txt
/env/react/components%2Fui%2Fbutton/docs
/env/react/components%2Fui%2Fbutton/compositions
/env/react/components%2Fui%2Fbutton/compositions/primary
```

其中 component id 和 composition id 都使用 URL-safe encoding。`docs` 和 `compositions` 是 component route 下的第一批能力；未来可以在同一级别扩展：

```txt
/env/react/components%2Fui%2Fbutton/canvas
```

vendor 必须支持 env base path，因为 dev server assets、HMR client、module imports 和 docs links 都需要在被 proxy 后仍然有效。

## Docs and Compositions Discovery

第一阶段只约定 component 根目录下的 docs 入口文件和 demo 入口文件：

- `*.docs.md`
- `*.docs.mdx`
- `*.demo.*`

发现规则：

- vendor 在 `runtime.data.components` 的每个 `rootDir` 下查找 `*.docs.md` 或 `*.docs.mdx`。
- 如果一个 component 下有多个匹配文件，按稳定排序取第一个作为该 component 的 docs 入口文件。
- vendor 在每个 component `rootDir` 下查找 `*.demo.*`。
- 每个 demo 文件都是一个默认要展示的 composition 入口。
- composition id 默认来自 demo 文件名去掉 `.demo.<ext>` 后的部分。例如 `primary.demo.tsx` 对应 composition id `primary`。
- 如果需要在一个 demo 文件中导出多个 named compositions，可以后续扩展；第一阶段先按 file-level composition 建模。
- 没有 docs 的 component 不影响 server 启动；对应 `/docs` route 由 vendor 返回缺失文档页面或 404。
- 没有 demo 的 component 不影响 server 启动；对应 `/compositions` route 由 vendor 返回空列表页面或 404。
- docs title 优先取 frontmatter `title`，其次取第一个 `# heading`，最后取 component id。

composition title 优先由 demo module 自己导出，例如：

```ts
export const title = "Primary";
```

如果没有 title，vendor 可以从 composition id 派生显示名。

MD/MDX 渲染归属：

- 主进程不读取和编译 MDX。
- 主进程不读取、不编译、不执行 demo modules。
- preview vendor 可以选择 Vite、webpack、Next、Vue plugin、React MDX plugin 或纯 markdown renderer。
- 不同 env 的 docs 页面可以长得不同；主站只负责统一入口、路由和聚合 manifest。

Compositions 渲染归属：

- preview vendor 负责发现 `*.demo.*`、加载 demo module、调用 env 配置的 `mounter`。
- `mounter` 接收当前 composition 和目标 DOM root，并负责把 demo 渲染出来。
- 不同 env 可以定义不同 mounter，主程序不需要理解 React、Vue、Svelte 或其他框架的挂载细节。

概念接口：

```ts
type PreviewMounterContext = {
  componentId: string;
  compositionId: string;
};

type PreviewMounter = (
  composition: unknown,
  root: HTMLElement,
  context: PreviewMounterContext
) => void | (() => void) | Promise<void | (() => void)>;

type PreviewDocsTemplateContext = {
  componentId: string;
  docsModule: unknown;
  compositions: { id: string; route: string }[];
};

type PreviewDocsTemplate = (context: PreviewDocsTemplateContext) => unknown;
```

这些接口是 vendor-facing 概念接口，不要求 `bit-lite` 主程序直接 import 或调用。

## Proxy Server Design

主 proxy server 属于 `bit-lite` CLI 进程。它维护一份内存状态：

```ts
type PreviewProxyState = {
  proxy: {
    origin: string;
    host: string;
    port: number;
  };
  envs: Record<string, PreviewEnvState>;
  skipped: PreviewSkippedEnv[];
};

type PreviewEnvState = {
  envName: string;
  taskId: string;
  vendor: string;
  status: string;
  server?: PreviewServerInfo;
  components: PreviewProxyComponent[];
};

type PreviewProxyComponent = {
  componentId: string;
  docsRoute: string;
  compositionsRoute: string;
};
```

核心路由：

```txt
GET /                              main preview shell
GET /__bit-lite/manifest.json      aggregated JSON manifest
GET /__bit-lite/events             optional SSE updates for the shell
GET /env/:envName/:componentId/docs
GET /env/:envName/:componentId/compositions
GET /env/:envName/:componentId/compositions/:compositionId
GET /env/:envName/:componentId/*
```

`envName` 和 `componentId` 必须经过 URL-safe encoding。不要把 component id 中的 `/` 直接当成 route segment。`/env/:envName/*` 下的所有请求都代理到对应 env vendor server；主程序不需要知道 `docs` 之外的子路由含义。

代理行为：

- HTTP 请求按 env route 转发到对应 vendor `server.origin`。
- path 不再额外 rewrite，vendor 看到的 path 应该包含它声明的 `basePath`。
- 如果 env server 尚未 ready，返回一个 lightweight loading/error 页面。
- WebSocket upgrade 也必须代理到对应 vendor server，否则 Vite/webpack HMR 会失效。

依赖选择：

- 如果只做普通 HTTP proxy，可以用 Node `http` + `fetch` streaming。
- 但 dev server preview 通常需要 HMR websocket，所以第一阶段建议直接引入小型 proxy 依赖，例如 `http-proxy`，由 `pnpm` 安装。
- 主站 HTML/CSS/JS 可以先由 CLI 内联生成，后续再拆成包内静态资源。

## Aggregated Manifest

主站 shell 不需要知道每个 env 的内部构建细节，只读取 aggregated manifest：

```json
{
  "proxy": {
    "origin": "http://127.0.0.1:4000"
  },
  "envs": [
    {
      "envName": "react",
      "vendor": "vite-react-preview",
      "status": "ready",
      "server": {
        "origin": "http://127.0.0.1:41731",
        "basePath": "/env/react/"
      },
      "components": [
        {
          "componentId": "components/ui/button",
          "docsRoute": "/env/react/components%2Fui%2Fbutton/docs",
          "compositionsRoute": "/env/react/components%2Fui%2Fbutton/compositions"
        }
      ]
    }
  ],
  "skipped": []
}
```

主站可以先做静态刷新或手动 reload。后续通过 `GET /__bit-lite/events` 使用 SSE 推送状态变化，让页面实时更新。

## Terminal Integration

preview 继续使用 `ManagedTerminal`：

- 每个 preview vendor 是一个 terminal item。
- `formatPreviewResult()` 把 `PreviewServiceResult` 转成 details，例如 component 数量和 vendor server URL。
- terminal title 使用函数，动态显示主 proxy URL。
- vendor stdout/stderr 通过现有 worker output capture 展示。
- attach 到某个 item 时，用户看到对应 vendor dev server 的原始输出。

示例 details：

```txt
2 components http://127.0.0.1:41731
```

主 proxy server 自己可以先不作为 terminal item，因为它由 command 进程直接管理。后续如果需要展示 proxy access logs，可以把 proxy server 建模为一个 synthetic `ManagedTerminalItem`，但这不是第一阶段必需。

## Shutdown

shutdown 顺序：

1. terminal 收到 quit / Ctrl+C，或进程收到 `SIGINT` / `SIGTERM`。
2. 停止接收新的 proxy 请求。
3. 关闭 HTTP server 和 websocket proxy。
4. 对所有 vendor tasks 发送 shutdown message。
5. 等待 vendor task `stop()`。
6. 超时后调用 `terminate()`。
7. 恢复 terminal 状态并退出。

vendor 必须在收到 shutdown message 后关闭自己的 dev server。对于 Vite、webpack 这类 server，需要显式调用 `server.close()`。

## Implementation Plan

### Phase 1: Protocol and CLI skeleton

- 在 `bit-lite-env` 中支持 `preview` service name 和基础 config validation。
- 在 `bit-lite` 中新增 `commands/preview.ts`，复用 test command 的 workspace loading、component selection 和 env grouping。
- 扩展 `watchVendorTasks()`：
  - `onTasksStarted()` hook。
  - `nonInteractiveMode: "keep-alive"`。
  - 可选 cleanup。
- 在 `VendorData` 增加可选 `runtime` 字段。
- 注册 CLI command：`preview: runPreviewCommand`。

### Phase 2: Proxy server

- 实现 `PreviewProxyServer`：
  - 分配主 proxy host/port。
  - 维护 env server registry。
  - 提供 `/` shell 和 `/__bit-lite/manifest.json`。
  - 代理 `/env/:envName/*` HTTP 请求。
  - 支持 websocket upgrade。
- `runPreviewCommand()` 在启动 vendor tasks 前启动 proxy server，并在 `onTasksStarted()` 中监听 preview result 更新 server registry。

### Phase 3: Demo preview vendors

- 新增 demo React preview vendor，使用 Vite + React + MD/MDX 支持。
- 新增 demo Vue preview vendor，使用 Vite + Vue，并至少支持 markdown docs。
- 可选新增 node/static preview vendor，用于纯 markdown component。
- 更新 demo workspace 的 `services.preview` 配置。
- 把现有 demo workspace 里的 `preview.ts` 命名迁移为 `*.demo.*`。
- 给现有 demo components 的 `*.docs.md` 和 `*.demo.*` 接入实际渲染。

### Phase 4: Tests

- command unit tests：
  - 没有 preview tasks 时输出正确提示。
  - `--filter` 先筛 component，再按 env 启动 preview tasks。
  - preview task result 会更新 proxy server info。
  - shutdown 会关闭 proxy 和 vendor tasks。
- proxy tests：
  - manifest route。
  - env route proxy。
  - missing env / not ready env。
  - websocket upgrade 可以被转发。
- vendor tests：
  - docs discovery。
  - compositions discovery。
  - mounter integration。
  - docs template integration。
  - result shape validation。
  - shutdown closes dev server。

## Open Questions

- MDX 是否作为所有 env 的统一能力，还是只由 React-like env 支持？
- 主站 shell 是否需要实时 SSE 更新，还是第一阶段用 manifest polling / reload 即可？
