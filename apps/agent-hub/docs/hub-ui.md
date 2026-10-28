# Hub UI

> 上级文档：[../README.md](../README.md)。`hub` 子 WebView 里的 Vite 8 + React 19 单页应用；浏览器开发模式下同样能跑（[desktop-shell.md](desktop-shell.md) §8.2）。业务数据只走 `/api/v1`（D23）；桌面能力只经已定稿的 `web/src/desktop/`（[desktop-shell.md](desktop-shell.md) §5）。决策 D62–D67。
>
> 下面 §1–§4 是**接口契约**（类型签名与行为，实现时按签名落地）。§5 是页面规格。§8 是验收标准。页面组件没有入库的实现稿，按规格写。

## 1. 布局

单窗口三栏。顶栏 44 px、Bot 工具条 32 px、收起后的左栏竖条 40 px、中栏 360 px、右栏最小 380 px。Bot 面板三档 **360 / 440 / 560**，默认 440、展开。窗口放不下当前档时逐档调窄，`localStorage` 里的偏好不变。窗口最小 1100×680（desktop-shell.md §2），不做窄屏或单栏布局。

路由用 `createHashRouter`（D22）：

| 路径                  | 落在哪                                                        |
| --------------------- | ------------------------------------------------------------- |
| `/`                   | `TasksLayout`：中栏列表，右栏“未选择任务”                     |
| `/tasks/:taskId`      | 同上；`?tab=` 为 `diff` / `approvals` / `info` 时打开对应页签 |
| `/new`                | `TasksLayout` 的右栏是新建任务页（D62），不是对话框           |
| `/settings/:section?` | 占第 2–3 列；省略 section 时是 `agents`                       |
| 其余                  | 重定向到 `/`                                                  |

`TaskTab` 为 `output`、`diff`、`approvals`、`info`。`SettingsSection` 为 `agents`、`repos`、`bot`、`tokens`、`general`、`data`、`about`。

```ts
type TaskTab = 'output' | 'diff' | 'approvals' | 'info';
type SettingsSection = 'agents' | 'repos' | 'bot' | 'tokens' | 'general' | 'data' | 'about';
declare const paths: {
  home(): string;
  task(taskId: string, tab?: TaskTab): string; // output 以外加 ?tab=
  newTask(): string;
  settings(section?: SettingsSection): string; // agents 以外加 /:section
};
type BotWidth = 360 | 440 | 560;
type LayoutPrefs = { botWidth: BotWidth; botCollapsed: boolean }; // 默认 440、展开
declare function loadLayoutPrefs(storage: Storage): LayoutPrefs; // 键 agent-hub.layout.v1
declare function saveLayoutPrefs(storage: Storage, prefs: LayoutPrefs): void;
declare function effectiveBotWidth(pref: BotWidth, windowWidth: number): BotWidth;
declare function gridColumns(leftWidth: number): string; // `${left}px 360px minmax(380px, 1fr)`
```

`effectiveBotWidth`：从偏好档开始，若 `windowWidth < 档宽 + 360 + 380` 就降一档，直到 360。收起时左栏宽是 40，不读偏好档。网格列宽写在根网格的 inline style 里（根 `lint` 禁止 `grid-cols-[…]`）。`localStorage` 只放这份界面偏好（D15 的设置在侧车）。

设置页打开时网格仍是三列，但第 2–3 列由设置页自己占据（左栏 Bot 保留）。新建任务、设置都是页面，不调用 `botPanel.occlude`（D62）。

## 2. 共享模块与约定

### 2.1 `contract/src/labels.ts`

全部枚举的中文标签，以及 `reasoningEffortLabel()`。未知值原样显示。推理档：`default` 默认、`none` 关闭、`minimal` 最低、`low` 低、`medium` 中、`high` 高、`xhigh` 极高、`max` 最高（[adapter-interface.md](adapter-interface.md) §9.1）。

| 枚举             | 标签                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| 任务状态         | 排队中、准备中、运行中、已完成、失败、已取消、已中断                                            |
| 轮状态           | 未开始、进行中、已完成、失败、已取消、已中断                                                    |
| 模式             | 只读、可写                                                                                      |
| 工作区           | 原目录、worktree、远端分支                                                                      |
| 来源             | 界面、本地郎                                                                                    |
| 审批种类         | 命令、改文件、联网、其他                                                                        |
| 审批决定         | 允许一次、本会话允许、拒绝、拒绝并停止本轮                                                      |
| 审批状态         | 待审批、已允许、已拒绝、已超时、已撤回                                                          |
| 决定人           | 你、本地郎、系统                                                                                |
| 停止原因         | 正常结束、达到长度上限、达到步数上限、拒绝回答、已停止、出错                                    |
| 适配器           | Codex、ACP、网页                                                                                |
| 工具种类         | 命令、读取、编辑、删除、移动、搜索、联网、推理、MCP、其他                                       |
| diff 文件状态    | 新增、修改、删除、重命名                                                                        |
| scope 名称与说明 | `tasks:read` 读取任务与 diff；`tasks:write` 派发和追问；`approvals:decide` 代替你批准或拒绝命令 |

每个枚举值都有一条标签。单测把 `domain.ts` 里的常量数组逐项对上，缺一条就失败。

### 2.2 `lib/format.ts`

纯函数，Node 里单测，不读 DOM。

```ts
type HealthTone = 'ok' | 'warn' | 'bad' | 'muted';
declare function healthTone(status: AgentHealth['status']): HealthTone; // ready→ok，auth_required→warn，unavailable→bad，其余 muted
declare function healthText(health: AgentHealth): string; // 圆点的 title：显示名由调用方拼在前面
declare function modelLine(model: string | null, effort: string | null): string; // “模型 默认 · 推理 高”
declare function formatTime(iso: string, now?: number): string; // 当天显示时刻，否则显示月日
declare function formatDuration(ms: number): string;
declare function countLabel(n: number, noun: string): string; // 0 返回空串
```

### 2.3 `HubDialog` / `HubAlertDialog` 与 ESLint 限制

对话框只用于确认、“应用到本地分支”和“本地服务的最后输出”（D62）。这两个组件是全应用唯一可以从 `@repo/ui-web` 导入 `Dialog*` / `AlertDialog*` 的文件。根 `eslint.config.mjs` 对 `apps/agent-hub/web/src/**` 加 `no-restricted-imports`：除 `components/hub-dialog.tsx` 外，不许导入这两个前缀。

只能受控使用。打开期间调用 `useBotOcclusion(true)`（[desktop-shell.md](desktop-shell.md) §5.3）。

```ts
declare function HubDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  size?: DialogContentSize;
  footer?: ReactNode;
  children?: ReactNode;
}): ReactElement;

declare function HubAlertDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description: string;
  confirmText: string;
  destructive?: boolean;
  onConfirm(): void | Promise<void>;
}): ReactElement;
```

`onConfirm` 返回 Promise 时，结束前按钮显示“处理中…”且关不掉；成功自动关闭；失败保持打开，错误交给 §2.4 的提示。

### 2.4 错误与提示

查询错误在原位显示（带“重试”）。变更错误默认弹提示；`meta.silentError` 的由调用方写在表单里（D66）。Hub UI 不发 `Idempotency-Key`（D67）。

```ts
type ClientErrorCode = ApiErrorCode | 'NETWORK' | 'NOT_CONNECTED' | 'BAD_RESPONSE';
declare class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number; // 没收到响应时为 0
  readonly details: JsonValue | null;
  issues(): Map<string, string>; // details.issues，按 path 取第一条
}
declare function errorMessage(error: unknown): string; // 服务端的中文 message 或客户端说明
```

`NOT_CONNECTED`：还没 `configure`。`NETWORK`：`fetch` 抛错。`BAD_RESPONSE`：状态不是 2xx 且正文不是契约里的错误 JSON，或 2xx 的 JSON 对不上。`issues()` 读 `details.issues[].path` / `message`，同一 path 只留第一条。

提示不用 toast 库。`ToastStore` 右下角最多 3 条，普通 4 秒、错误 8 秒。

```ts
declare const toast: {
  info(text: string): number;
  error(text: string): number;
  dismiss(id: number): void;
};
```

### 2.5 外链守卫

Markdown 和页面里的 `http` / `https` 链接不让 WebView 自己导航，交给 [desktop-shell.md](desktop-shell.md) §5.7 的 `openExternal`。`javascript:` 和其他协议直接拦住。

```ts
declare function installLinkGuard(
  doc: Document,
  open: (url: string) => Promise<void>,
  onError: (error: unknown) => void,
): () => void;
```

在捕获阶段监听 `click`。目标是带 `href` 的链接、且协议为 `http:` 或 `https:` 时 `preventDefault`，再 `void open(href).catch(onError)`。返回的函数移除监听。

### 2.6 其他约定

- 界面只做简体中文，不接 i18n（D24）。不支持附件（D25）。
- 正文、代码、错误信息用 `select-text`；`body` 是 `user-select: none`，避免拖选择时把 Bot 面板的指针抢走。
- 顶栏和 Bot 工具条不放下拉框。下拉框只放在中栏、右栏和对话框里，向下展开，不隐藏 Bot（[desktop-shell.md](desktop-shell.md) §5.3）。
- 草稿（新建任务、追问、列表筛选）放模块级变量：切页面不丢，重启丢（D65）。
- 验收标准在 §8，不在本节。

## 3. 包、入口与连接

### 3.1 包与配置

`apps/agent-hub/web`，包名 `@agent-hub/web`，`type: module`。

| 脚本        | 命令                         |
| ----------- | ---------------------------- |
| `dev`       | `vite`                       |
| `build`     | `tsc --noEmit && vite build` |
| `lint`      | `eslint .`                   |
| `typecheck` | `tsc --noEmit`               |
| `test`      | `vitest run`                 |

依赖：`@agent-hub/contract`、`@repo/design-tokens`、`@repo/ui-web`（`workspace:*`）、`@tanstack/react-query` ^5.99.2、`@tanstack/react-virtual` ^3.14.23、`@tauri-apps/api` ^2.12.4、`@tauri-apps/plugin-notification` ^2.7.0、`@tauri-apps/plugin-opener` ^2.7.2、`lucide-react` ^1.8.0、`react` / `react-dom` ^19.2.5、`react-router` ^7.18.4、`react-markdown` ^10.1.0、`remark-gfm` ^4.0.1、`rehype-sanitize` ^6.0.0。开发依赖与 `apps/cardhub/web` 同版本（`typescript`、`vite`、`vitest`、`jsdom`、Testing Library、Tailwind）。不依赖 Playwright，不依赖 tRPC。

`vite.config.ts`：`server: { port: 5174, strictPort: true }`；`build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 2048 }`；`optimizeDeps.include: ['@agent-hub/contract', '@repo/ui-web']`（contract 是 CommonJS，D58）。vitest：`environment: 'jsdom'`、`globals: true`、`setupFiles: ['./test/setup.ts']`（只补 `ResizeObserver`）、`include: ['test/**/*.test.{ts,tsx}']`。

`styles.css`：引入 `tailwindcss` 与 `@repo/design-tokens/tailwind.css`；`@source '../../../../packages/ui-web/src'`；`html, body, #root` 设 `height: 100%; overflow: hidden`。`.markdown` 下用 `@apply` 补回标题、列表、引用、表格、行内代码的样式。

目录：

| 位置              | 文件                                                                                                   | 职责                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 根                | `package.json`、`vite.config.ts`、`index.html`、`tsconfig.json`、`test/setup.ts`                       | 上面的包与配置                                                 |
| `src/`            | `main.tsx`、`styles.css`                                                                               | 入口                                                           |
| `src/app/`        | `paths`、`routes`、`shell`、`hooks`、`connection`、`query-client`、`singletons`、`quit`                | 路由、根组件、布局与时间线 hook、侧车接线、全局单例、退出确认  |
| `src/api/`        | `client`、`socket`、`cache`、`queries`、`task-stream`、`attention-watcher`                             | REST、唯一的 WebSocket、缓存、查询、详情页事件流、系统通知订阅 |
| `src/lib/`        | `layout`、`format`、`links`、`toast`、`patch`、`timeline`、`task-form`、`list-filter`、`settings-form` | 纯函数与小型 store                                             |
| `src/components/` | `top-bar`、`bot-column`、`service-state`、`hub-dialog`、`toaster`、`markdown`、`task-status`           | 跨页面组件                                                     |
| `src/pages/`      | `tasks-layout`、`no-task-selected`、`new-task`、`task-list/`、`task-detail/`、`settings/`              | 见 §5。详情按页签和卡片拆文件；设置每个分区一个文件            |

### 3.2 `main.tsx` 与根组件 `AppShell`

入口顺序固定，不能对调（`#uiToken=` 必须在路由读 hash 之前拿走）：

1. `takeDevToken`
2. `installLinkGuard(document, openExternal, (error) => toast.error(errorMessage(error)))`
3. 渲染前 `installConnection(...)`
4. `void sidecar.start()`，然后 `createHashRouter` 并渲染
5. `AppShell` 挂载时 `installAppMenu`（只装一次，回调经 ref 取当前路由和界面状态）

主界面里的 `useDesktopSync` 在侧车就绪且设置查询有数据时调用 `botPanel.configure(settings.bot)`，并把待审批数交给 `setTrayCount`。系统通知不在这里发，由 §4.3 的 `AttentionWatcher` 发。

```ts
declare function useDesktopSync(input: {
  settings: HubConfig | undefined;
  pendingCount: number;
}): void;
```

`AppShell` 按侧车状态选择整页错误（§5.1）或三栏网格。菜单动作：⌘1 收起 / 展开左栏，⌘N 去新建任务，⌘, 去设置，⌘⇧R 刷新 Bot，⌘Q 走 §5.7。

### 3.3 API 客户端与连接

`api.*` 与 [local-api.md](local-api.md) §5.1 一一对应（路径省略 `/api/v1`，WebSocket 走 §4 的 `socket`，不进 `api`）。Hub UI 不发幂等键（D67）。`TaskListFilter` 就是 `GET /tasks` 的查询参数，`archived` 必填（服务端默认 `false`，界面自己决定）。

| 方法                                                                        | 端点                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `health` `me`                                                               | `GET /health` `GET /me`                                             |
| `listAgents` `refreshAgent`                                                 | `GET /agents` `POST /agents/:id/refresh`                            |
| `listRepos` `listRepoRefs` `inspectRepo`                                    | `GET /repos` `GET /repos/:id/refs` `POST /repos/inspect`            |
| `disableOriginPush`                                                         | `POST /repos/:id/disable-origin-push`                               |
| `createTask` `listTasks` `getTask` `listTaskEvents`                         | `POST /tasks` `GET /tasks` `GET /tasks/:id` `GET /tasks/:id/events` |
| `waitTask` `getTaskResult` `getTaskDiff`                                    | `GET /tasks/:id/wait` `/result` `/diff`                             |
| `followUp` `cancelTask` `archiveTask` `unarchiveTask`                       | `POST /tasks/:id/turns` `/cancel` `/archive` `/unarchive`           |
| `deleteTask` `applyTask`                                                    | `DELETE /tasks/:id` `POST /tasks/:id/apply`                         |
| `completeRemoteTurn` `setRemoteLink`                                        | `POST /tasks/:id/remote/done` `/remote/link`                        |
| `listApprovals` `decideApproval`                                            | `GET /approvals` `POST /approvals/:id/decision`                     |
| `getSettings` `putSettings`                                                 | `GET /settings` `PUT /settings`                                     |
| `listTokens` `createToken` `updateToken` `revokeToken` `rotateDefaultToken` | token 五个端点                                                      |
| `exportDiagnostics` `listAudit`                                             | `POST /diagnostics/export` `GET /audit`                             |

```ts
type RequestOptions = { query?: Record<string, QueryValue>; body?: unknown; signal?: AbortSignal };
declare const client: {
  configure(target: { baseUrl: string; uiToken: string } | null): void; // 未配置 → NOT_CONNECTED
  request<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
};
```

`configure(null)` 用于侧车断开。`request` 把非 2xx 的契约错误转成 `ApiError`。

WebSocket（`api/socket.ts`）首条消息 `auth`，`ready` 后重发全部订阅。状态 `idle | connecting | open | reconnecting | stopped`。`getStatus` / `subscribeStatus` 供 `useSyncExternalStore`。重连间隔 1、2、5、10 秒，之后保持 10 秒。`4008` 立即重连。`4400`、`4403`、`4401` 停止；侧车给出新 token 后由 `connect()` 重新开始。

```ts
type TasksHandlers = {
  onTask(task: TaskDto): void;
  onApproval(approval: ApprovalDto): void;
  onResync(): void; // 每次（重新）订阅成功；tasks 主题不回放，要重新拉 REST
};
type TaskHandlers = {
  afterSeq(): number; // 重新订阅时从这里接着收
  onEvent(envelope: HubEventEnvelope): void;
  onGone(): void; // TASK_NOT_FOUND
};
declare const socket: {
  connect(url: string, token: string): void; // 目标没变且可用时什么都不做
  subscribeTasks(handlers: TasksHandlers): () => void;
  subscribeTask(taskId: string, handlers: TaskHandlers): () => void;
  getStatus(): SocketStatus;
  subscribeStatus(listener: () => void): () => void;
};
```

缓存与连接（D21）：任务、审批对象写进 Query 缓存；任务事件流不进 Query，合并进 `TaskStreams` / `Timeline`。`applyTask` 以 `updatedAt` 较新者为准：比详情旧的推送整个忽略；列表里有就替换，不再符合过滤条件时移出；没有但符合条件时，比该列表第一条新就插到最前，否则让该列表失效。

```ts
declare function matchesFilter(task: TaskDto, filter: TaskListFilter): boolean; // 与服务端过滤一致
declare function applyTask(qc: QueryClient, task: TaskDto): void;
declare function applyApproval(qc: QueryClient, approval: ApprovalDto): void; // 维护待审批与详情
declare function applyTaskEvent(qc: QueryClient, e: HubEventEnvelope): void; // turn.* 刷详情，diff.updated 刷 diff
declare function removeTask(qc: QueryClient, id: string): void; // 服务端不推送删除
declare function resyncAll(qc: QueryClient): void; // 失效 ['tasks'] 与待审批
type ConnectionDeps = {
  sidecar: { getState(): SidecarState; subscribe(listener: () => void): () => void };
  client: Pick<typeof client, 'configure'>;
  socket: Pick<typeof socket, 'connect' | 'subscribeTasks'>;
  queryClient: QueryClient;
  watcher: { onTask(task: TaskDto): void };
  listTasks: (typeof api)['listTasks']; // onResync 时拉进行中的任务交给 watcher
};
declare function installConnection(deps: ConnectionDeps): () => void; // 渲染前调用一次
```

侧车每次进入就绪：用 `LaunchInfo` 配置客户端、`socket.connect`、`resyncAll`。离开就绪：`configure(null)`，socket 停在当前策略上（侧车自己会换 token，下次就绪再 `connect`）。

## 4. 查询、缓存与时间线

### 4.1 查询 key

`app/query-client.ts`：默认 `staleTime` 30 秒、不在窗口聚焦时刷新、只对 `NETWORK` 重试 3 次。变更失败默认 `toast.error`；`meta.silentError === true` 时不弹。

| key                                  | 来源                            | `staleTime` | 维护方式                                            |
| ------------------------------------ | ------------------------------- | ----------- | --------------------------------------------------- |
| `['agents']`                         | `GET /agents`                   | 默认        | 每 10 秒刷新；新建任务页 `refetchOnMount: 'always'` |
| `['repos']`、`['repos', id, 'refs']` | `GET /repos`、`/refs`           | 默认、60 秒 | 保存设置后失效                                      |
| `['settings']`                       | `GET /settings`                 | `Infinity`  | 保存成功后 `setQueryData`                           |
| `['approvals', 'pending']`           | `GET /approvals?status=pending` | `Infinity`  | WebSocket，最早的在前                               |
| `['tasks', 'list', filter]`          | `GET /tasks`（无限查询）        | `Infinity`  | WebSocket + `applyTask`                             |
| `['tasks', 'detail', id]`            | `GET /tasks/:id`                | `Infinity`  | WebSocket + `applyTaskEvent`                        |
| `['tasks', 'diff', id, scope, turn]` | `GET /tasks/:id/diff`           | `Infinity`  | `diff.updated` 时失效                               |
| `['tokens']`、`['audit']`            | `GET /tokens`、`/audit`         | 默认        | 操作成功后失效                                      |

Agent 状态不经 WebSocket 推送，所以 `['agents']` 靠 10 秒轮询（[adapter-interface.md](adapter-interface.md) §9.2）。

### 4.2 WebSocket 写缓存

`subscribeTasks` 是全局一条：`onTask` → `applyTask`，再交给 `AttentionWatcher`；`onApproval` → `applyApproval`；`onResync` → `resyncAll`，并 `listTasks({ archived: false, status: 'queued,preparing,running', limit: 50 })` 把进行中的任务逐个交给 watcher。`turn.*` 不写时间线缓存，只 `invalidateQueries(['tasks','detail', id])`。`diff.updated` 失效该任务的 diff key。删除只发生在 `DELETE` 成功之后，调用 `removeTask`。

### 4.3 系统通知观察者

`AttentionWatcher` 给每个 `preparing` / `running` 的任务开一个 `subscribeTask`。收到值得通知的事件时调用 [desktop-shell.md](desktop-shell.md) §5.6 的 `notificationFor`；非空且窗口不在前台则 `notifyInBackground`。任务离开这两个状态就退订。同一任务不重复订阅。

```ts
declare class AttentionWatcher {
  constructor(deps: {
    subscribeTask: typeof socket.subscribeTask;
    notify(text: { title: string; body: string }): void;
    isBackground(): boolean;
  });
  onTask(task: TaskDto): void;
  stop(): void;
}
```

通知种类只有 D28 的三类：新审批、任务结束、网页任务的提示词已就绪。规则在 `notify-rules.ts`，Hub UI 不另写一套文案。

### 4.4 时间线

`lib/timeline.ts` 与 `api/task-stream.ts`（D64）。按 `seq` 去重。`message` / `reasoning` 按 `itemId` 拼接增量。`tool.*` 按 `itemId` 合并，先到输出时补一个占位条目。同一轮连续同 `code` 的 `notice` 合并计数。`task.status`、`turn.*`、`diff.updated` 不进时间线（轮的开头和结尾由 `TurnDto` 渲染）。

每帧（`requestAnimationFrame`）合并一批，没变的条目保持同一对象。最多缓存 5 个任务的时间线，超出就丢掉最久没打开的。

`TimelineItem` 的 `kind`：`session`、`message`、`reasoning`、`plan`、`tool`、`approval`、`notice`、`remote`。

```ts
type TimelineSnapshot = {
  items: readonly TimelineItem[];
  usage: ReadonlyMap<string, UsageInfo>;
  lastSeq: number;
};
declare const timeline: { apply(envelopes: readonly HubEventEnvelope[]): boolean }; // 有变化返回 true
type TurnSection = { turn: TurnDto; items: TimelineItem[]; usage: UsageInfo | null };
declare function groupByTurn(turns: readonly TurnDto[], s: TimelineSnapshot): TurnSection[];
type TimelineRow =
  | { type: 'turn-head' | 'turn-foot'; key: string; section: TurnSection } // 轮尾只有已结束的轮有
  | { type: 'item'; key: string; item: TimelineItem };
declare function timelineRows(sections: readonly TurnSection[]): TimelineRow[];
declare function useTaskTimeline(taskId: string): TimelineSnapshot; // 挂载时 taskStreams.open(taskId)
```

`lib/patch.ts` 的 `pairFilePatches` 把统一 diff 按文件拆开，供 §5.4 的 Diff 页签使用。超过 400 行的文件块默认折叠。

## 5. 页面

### 5.1 启动与服务状态

侧车从未就绪，或已放弃重启：整页，不画三栏。

| 状态                           | 文案                                                 |
| ------------------------------ | ---------------------------------------------------- |
| 还在等第一次 ready             | “正在启动本地服务…”                                  |
| 放弃重启（`fatal` 或次数用尽） | “本地服务没有启动” + 错误原文 + “重试”“复制错误信息” |

就绪过之后，顶栏中间显示一条服务状态，不挡住三栏：

| 侧车 / socket         | 文案                                                         |
| --------------------- | ------------------------------------------------------------ |
| 正在重启              | “正在重启本地服务…”                                          |
| 已退出、等待退避      | “本地服务已断开，N 秒后自动重启”；有 stderr 时带“详情”对话框 |
| socket `reconnecting` | “实时更新已断开，正在重连…”                                  |
| socket `stopped`      | “实时更新已停止” + “重新加载界面”                            |

“详情”用 `HubDialog`，内容是侧车 stderr 的尾部，所以会按 §2.3 隐藏 Bot。

### 5.2 顶栏与左栏

顶栏从左到右：“Agent Hub”、每个启用的 Agent（圆点颜色 `healthTone`，`title` 为 `显示名：healthText`，运行数 > 0 时显示数字，点击去设置的 Agent 分区）、服务状态（§5.1）、“待审批 N”（有待审批才显示，打开最早一条的审批页签）、“新建任务”（⌘N）、设置（⌘,）。

Bot 工具条：刷新（⌘⇧R）、用浏览器打开、调整宽度（`↔` 在 360 / 440 / 560 三档间切换）、收起（⌘1）。`BotSlot` 盖在工具条下面。面板状态的占位：

| `BotPanelState.kind` | 文案                             |
| -------------------- | -------------------------------- |
| `unsupported`        | “浏览器开发模式不内嵌本地郎”     |
| `unconfigured`       | “设置本地郎地址”，带“去设置”     |
| `external`           | 地址 + “用浏览器打开”            |
| `opening`            | “正在打开本地郎…”                |
| `error`              | 错误原文                         |
| `open`               | 不显示占位（原生视图盖住这一块） |

### 5.3 任务列表

筛选条：状态、Agent、来源三个 `Select`，加标题搜索框（去抖 300 ms、最多 100 字）。筛选状态放模块级变量。

`ListFilterState` 为 `{ status: StatusFilter; agentId: string; source: '' | TaskSource; q: string }`。`StatusFilter` 为 `all`（全部）、`active`（进行中）、`ended`（已结束）、`archived`（已归档）。

```ts
declare function toTaskListFilter(state: ListFilterState): TaskListFilter; // 空字段省略，q 截到 100
```

`all` / `active` / `ended` 的 `archived` 为 `false`；`active` 的 status 是 `queued,preparing,running`；`ended` 是四个终态；`archived` 只设 `archived: true`。`matchesFilter` 用同一套规则，这样推送插入和移出与服务端一致。

`useInfiniteQuery`，每页 50，底部 `IntersectionObserver` 哨兵翻页，不虚拟化（D64）。行是 `<Link>`：

1. 状态徽标 · 来源 · Agent · 时间
2. 标题，以及“待批 N”“待你操作”（网页任务 `running`）“只读越界”
3. 仓库 · `#shortId` · 第 N 轮

当前行用 `useMatch('/tasks/:taskId')` 高亮。四种状态：空列表、筛选无结果（带“清除筛选”）、加载、错误（带“重试”）。

### 5.4 任务详情

标题栏：标题、Agent、模式、`modelLine`、工作区、仓库、分支、短号。

按钮：

| 按钮             | 行为                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| 停止本轮         | `queued` 时文案是“取消”。请求后仍未结束则变成“强制停止”，确认后 `force: true` |
| 追问             | 聚焦底部输入框                                                                |
| 应用             | “应用到本地分支”对话框，可选“合并到当前分支”。错误显示在对话框里，不弹 toast  |
| 归档 / 取消归档  | 直接请求                                                                      |
| 删除             | 只有已归档的才有，破坏性确认                                                  |
| 在 Finder 中显示 | `revealInFinder`                                                              |
| 复制路径         | 剪贴板                                                                        |

横幅只放在右栏：`lastError`、只读越界、worktree 已清理。网页任务在页签上方显示 `WebTaskPanel`（[web-agent.md](web-agent.md) §5.2）。页签在 `?tab=`：输出 / Diff N / 审批 N / 详情。

输出：`timelineRows` 用 `@tanstack/react-virtual` 渲染，动态测量行高。距底 48 px 以内算贴底，新内容自动滚动，否则显示“回到底部”。条目：轮头（第 N 轮、提示词、模型）、消息（Markdown）、推理（默认折叠）、计划、工具（标题 + 命令，输出默认折叠，展开状态存在行外的 Map 里）、内联审批卡、提示（`×N`）、远端提交。轮尾：停止原因、时长、用量、本轮改动统计。

追问框在底部。`followUpBlocker` 不为空时禁用并显示原因。⌘Enter 发送。可改模型和推理档。每个任务一份草稿。错误显示在框内（`silentError`）。

Diff：范围（整个任务 / 单轮）和轮次。运行中有“刷新 diff”（`live`）。`pairFilePatches` 按文件分块，超过 400 行默认折叠。截断、以及超过 5 MB 只有统计时，给出提示。`DIFF_NOT_AVAILABLE` 显示“本轮结束后才有 diff”。

审批卡：标题、命令、目录、路径、原因。按钮来自 `options`。`useNow(30_000)` 刷新剩余时间。`409 APPROVAL_NOT_PENDING` 提示“已被处理”并刷新。已结束的审批折叠，显示决定人和时间。

详情页签：字段表 + 轮表。任务不存在 → “任务不存在或已删除” + 返回列表。

### 5.5 新建任务

右栏页面（D62）。字段依次是：Agent、仓库、模式、工作区、基线（`Combobox`，原目录时隐藏）、模型与推理（`modelChoices` 的三种形态）、Codex 的“在 ChatGPT 应用里显示”、标题、提示词（⌘Enter 提交）。

提示：D38 的只读提示、Agent 不可用、仓库有未提交改动且用 worktree（“未提交的改动不会带进 worktree”）。可写 + 原目录先用 `HubAlertDialog` 确认。

服务端 `issues` 按 path 显示在字段下，其余错误显示在表单顶部。成功后清空草稿并跳到该任务。草稿放模块级变量。

```ts
declare const DEFAULT_OPTION = '__default__'; // Radix Select 把 '' 当成“未选择”，进出表单时转换
declare function initialForm(agents: readonly AgentDto[], repos: readonly RepoDto[]): NewTaskForm;
declare function withAgent(form: NewTaskForm, agent: AgentDto): NewTaskForm; // 模式、工作区回到默认
declare function withMode(form: NewTaskForm, agent: AgentDto, mode: TaskMode): NewTaskForm;
declare function modelChoices(agent: AgentDto, def: AgentDefaults, model: string): ModelChoices;
declare function validateForm(form: NewTaskForm, agent?: AgentDto, repo?: RepoDto): FormProblems;
declare function needsInPlaceWriteConfirm(form: NewTaskForm): boolean; // 可写 + 原目录
declare function readOnlyWithoutSandbox(agent: AgentDto, form: NewTaskForm): boolean; // D38 提示
declare function buildCreateBody(form: NewTaskForm, agent: AgentDto): CreateTaskBody;
```

`NewTaskForm` 的字段：`agentId`、`repoId`、`mode`、`workspace`、`baseRef`、`model`、`reasoningEffort`、`title`、`prompt`、`userVisible`。空字符串表示用默认值。提示词最多 200 000 字符，标题最多 120。`modelChoices` 三种形态：Agent 给出模型列表；只有默认模型字符串；完全不能选（网页 Agent）。

追问用同一文件里的：

```ts
declare function followUpBlocker(task: TaskDto): string | null; // 已归档 / 未结束 / worktree 已清理
declare function buildFollowUpBody(task: TaskDto, v: FollowUpValues): FollowUpBody; // 没改不传，改回默认传 null
```

### 5.6 设置

左侧分区导航，有错误的分区显示红点（D62、D65）。整份配置一份草稿。有改动时底部固定“保存 / 放弃更改”。带着未保存的改动离开 `/settings` 时用 `useBlocker` 确认。

保存顺序：`PUT /settings` → 写回 `['settings']` → 失效 agents 与 repos → 对新增且勾选了“禁用 origin 推送”的仓库调用 `disableOriginPush` → `restartRequired` 时显示“端口改动在重启本地服务后生效”。

| 分区       | 内容                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent      | 各字段、健康状态与“重新检查”、“添加 ACP Agent”、删除（确认）                                                                                                   |
| 仓库       | 路径 + “检测” → `newRepo`；默认仓库单选；远端只读列表；禁用 origin 推送；移除                                                                                  |
| 本地郎     | 地址、两类 origin、UA、“用系统浏览器打开”、面板状态、“清除本地郎登录数据”（确认）                                                                              |
| 桥接 token | 不进草稿，立即生效。列表；新建（明文只显示一次，可复制）；改 scope（加 `approvals:decide` 要二次确认）；吊销；轮换默认 token（显示新明文和 `bridgeTokenFile`） |
| 通用       | 端口、调度、审批超时、桥接 diff 上限、推送黑名单（锁定的 3 项删不掉）                                                                                          |
| 数据与诊断 | 保留期限、诊断开关、导出诊断包、审计日志（按 `before` 翻页）、数据目录                                                                                         |
| 关于       | 版本（`LaunchInfo.serverVersion`）、路径、“重启本地服务”（确认，调 `sidecar` 的重启）                                                                          |

```ts
declare function sectionOfIssue(path: string): SettingsSection; // 'agents.1.command' → 'agents'
declare function uniqueId(name: string, taken: readonly string[], fallback: string): string;
declare function newRepo(path: string, info: RepoInspectionDto, taken: string[]): RepoConfig;
declare function newAcpAgent(taken: readonly string[]): AcpAgentConfig; // command 留空，填了才能保存
declare function normalizeBlockedHosts(hosts: readonly string[]): string[]; // 锁定的 3 个 GitHub 主机在前
declare function isDirty(draft: HubConfig, saved: HubConfig): boolean; // 键排序后比较
declare function withRepo(config: HubConfig, repo: RepoConfig): HubConfig; // 第一个仓库成为默认
declare function withoutRepo(config: HubConfig, repoId: string): HubConfig; // 删默认仓库时清空默认
```

锁定的三个主机是 `github.com`、`ssh.github.com`、`gist.github.com`（[architecture.md](architecture.md) §8）。

### 5.7 退出

`createQuitHandler` 交给 `installAppMenu` 的退出动作：

- 有排队或运行中的任务时，先 `showMainWindow`，再用 `HubAlertDialog` 确认。文案说明这些任务会变成“已中断”、可以追问继续。
- 问不到任务数（3 秒超时）就直接 `ipc.quitApp()`。
- 确认框开着时再按 ⌘Q 忽略。

```ts
declare function createQuitHandler(deps: {
  countActive(signal: AbortSignal): Promise<number>;
  confirm(message: string): Promise<boolean>;
  showMainWindow(): Promise<void>;
  quitApp(): Promise<void>;
}): () => void;
```

## 6. 错误与空状态

组件：`Markdown`（GFM + rehype-sanitize 默认规则，不做代码高亮，D63）。图片不渲染成 `<img>`，改成链接，因为 CSP 的 `img-src` 没有远程来源（[desktop-shell.md](desktop-shell.md) §4.5）。`TaskStatusBadge({ status, className? })`。

| 位置       | 空 / 错                                                         |
| ---------- | --------------------------------------------------------------- |
| 整页       | §5.1 的未就绪与放弃重启                                         |
| 任务列表   | 空、筛选无结果、加载、错误 + 重试                               |
| 任务详情   | 不存在或已删除；diff 还没有；审批已被处理                       |
| 新建任务   | 字段下的 `issues`；表单顶部的其他错误；D38 提示；未提交改动提示 |
| 设置       | 分区红点；保存失败留在草稿上；离开未保存时 `useBlocker`         |
| 追问       | `followUpBlocker` 的原因；框内错误                              |
| 外链       | `openExternal` 失败 → `toast.error`                             |
| 待审批按钮 | 数量为 0 时不显示                                               |
| Bot 占位   | §5.2 的六种 `kind`                                              |

## 7. 测试

用例放在 `web/test/**/*.test.{ts,tsx}`，用 vitest + Testing Library。规格与 [testing.md](testing.md) §3 的 Hub UI 一节是同一份，这里列出必须覆盖的行为，避免两处各写各的：

- 布局偏好读写，以及 `effectiveBotWidth` 逐档调窄、偏好不变。
- `ApiError.issues` 按 path 取第一条。
- WebSocket 重连间隔与关闭码 `4008` / `4400` / `4403` / `4401`。
- `applyTask` 忽略旧推送、插入、移出、失效列表。
- 时间线去重与合并（增量、工具占位、连续 `notice`）。
- `pairFilePatches`。
- 新建任务与追问的表单规则，含 D38 与可写原目录确认。
- `toTaskListFilter` 与 `matchesFilter` 一致。
- 设置表单的辅助函数，含锁定的三个推送黑名单主机。
- `labels.ts` 覆盖 §2.1 的全部枚举值。
- jsdom：`HubDialog` 打开时调 `botPanel.occlude`；`HubAlertDialog` 的“处理中”；Markdown 去掉脚本、事件属性、`javascript:` 链接，图片变成链接。
- jsdom：浏览器开发模式下 `AppShell` 启动失败 → 重试 → 主界面（顶栏圆点、待审批按钮跳转、WebSocket 地址）。

不写 Playwright，不测 Rust。

## 8. 验收标准

1. `pnpm --filter @agent-hub/web typecheck`、`test`、`build` 通过；`pnpm lint` 通过。
2. 单测覆盖 §7 列出的逻辑与 jsdom 行为。数量上，逻辑测试与 jsdom 测试都要能在 `pnpm --filter @agent-hub/web test` 里点名找到，而不是只写在本文里。
3. 浏览器开发模式冒烟：连假侧车时三栏网格、健康圆点、“待审批 N”、本地郎占位都正确，控制台没有错误。macOS 上按 [desktop-shell.md](desktop-shell.md) §10 验收。
4. 本文的章节号保持 §1、§2.1–§2.6、§3.1–§3.3、§4.1–§4.4、§5.1–§5.7、§6、§7、§8，不另起一套编号。文档和夹具里不出现真实域名和 token。
