# 未完成部分的技术方案

> 上级文档：[../README.md](../README.md)。本文列出设计文档里**还没写完或需要修正**的部分：目标、模块划分、接口契约（只有类型签名）、验收标准、依赖顺序，交给后续 Agent 完成。决策都已拍板，不要停下来等确认；本文新增的决策 D62–D67 在 §4 给出全文。后文引用其他分册的行内容时只给“文件 + 原文短语”，不给行号（行号会漂移）。

## 1. 总览与依赖顺序

| 编号 | 工作           | 产出                                                             | 现状与问题                                                                                                            |
| ---- | -------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| W1   | Hub UI         | 新增 `docs/hub-ui.md`；`web/src/` 里除 `desktop/` 以外的全部代码 | README 和 6 份分册已引用 `hub-ui.md` 的 §1–§5.7，文件不存在；§2 是它的完整提纲                                        |
| W2   | 桌面壳文档修正 | 改 `docs/desktop-shell.md` 的 §6、§8.1、§10                      | Rust 与 `web/src/desktop/` 源码已定稿；只有接线说明和验收清单与 Hub UI 的最终设计不一致                               |
| W3   | 决策与措辞同步 | 改 `decisions-and-risks.md` 等 7 个文件                          | 还有把新建任务说成对话框、以及旧的打开函数调用等说法                                                                  |
| W4   | 安全分册重写   | `docs/security.md`                                               | §8 仍写着不存在的 IPC 命令 `reveal_path` / `open_external`；“脱敏”的章节号与 4 处引用对不上                           |
| W5   | 测试分册重写   | `docs/testing.md`                                                | 仍有 Prisma、Playwright、tRPC、`cargo test`，分别与 D13、D40、D23、D54 冲突；手工清单的章节号与 7 处“§7”引用对不上    |
| W6   | 实施计划重写   | `docs/milestones.md`                                             | 仍按 M0–M5 里程碑组织（D55 要求一次实现的步骤表）；“AoneD 驱动”“MCP 端点”两张卡与 D40、D47 冲突；链接不存在的风险文档 |
| W7   | README 修订    | `README.md`                                                      | 布局示意图、遮挡说明、目录结构过时；`prettier --check` 不通过                                                         |
| W8   | 校验与提交     | —                                                                | —                                                                                                                     |

顺序：**W3 → W1 → W2 → W4 → W5 → W6 → W7 → W8**。W1 引用 D62–D67；W2 引用 hub-ui.md 的章节；W5 引用 W1、W2、W4 的章节号；W6 引用全部分册；W7 最后改索引。每项一个提交（`docs(docs): …`）。

## 2. W1 Hub UI

### 2.1 目标

- `hub` 子 WebView 里的 Vite 8 + React 19 单页应用；浏览器开发模式下同样能跑（[desktop-shell.md](desktop-shell.md) §8.2）。
- 单窗口三栏：左栏本地郎（原生 Bot 子 WebView 盖在 `BotSlot` 上）、中栏任务列表、右栏任务详情或新建任务；设置页占中栏 + 右栏。
- 业务数据只走 `/api/v1`（D23）；桌面能力只经已定稿的 `web/src/desktop/`（desktop-shell.md §5）。
- hub-ui.md 的写法与其他分册一致：源码先在临时目录用真实依赖跑过 `tsc`、vitest、`vite build`，再原样嵌入。§2.4 的签名已在这样的草稿里验证（25 个逻辑测试、5 个 jsdom 测试、`vite build`、浏览器开发模式冒烟）；草稿没有入库，页面组件只有规格（§2.5）。

### 2.2 hub-ui.md 的章节（编号已被引用，不能改）

| 章节  | 内容                                                                                                                                                   | 本文对应     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| §1    | 布局：网格、尺寸常量、`localStorage`                                                                                                                   | §2.4 第 1 段 |
| §2    | §2.1 `contract/src/labels.ts`；§2.2 `lib/format.ts`；§2.3 `HubDialog` / `HubAlertDialog` 与 ESLint 限制；§2.4 错误与提示；§2.5 外链守卫；§2.6 其他约定 | §2.3、§2.4   |
| §3    | §3.1 包与配置；§3.2 `main.tsx` 与根组件 `AppShell`；§3.3 API 客户端与连接                                                                              | §2.3、§2.4   |
| §4    | §4.1 查询 key；§4.2 WebSocket 写缓存；§4.3 系统通知观察者；§4.4 时间线                                                                                 | §2.4         |
| §5    | §5.1 启动与服务状态；§5.2 顶栏与左栏；§5.3 任务列表；§5.4 任务详情；§5.5 新建任务；§5.6 设置；§5.7 退出                                                | §2.5         |
| §6–§8 | 错误与空状态表；测试（指向 testing.md §3）；已验证的内容                                                                                               | §2.6         |

### 2.3 模块划分（`apps/agent-hub/web/`）

| 位置              | 文件                                                                                                   | 职责                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 根                | `package.json`、`vite.config.ts`、`index.html`、`tsconfig.json`、`test/setup.ts`                       | 见下方“包与配置”                                                                                                                                                                  |
| `src/`            | `main.tsx`、`styles.css`                                                                               | 入口顺序固定：`takeDevToken` → `installLinkGuard` → `installConnection` → `void sidecar.start()` → `createHashRouter` 并渲染                                                      |
| `src/app/`        | `paths`、`routes`、`shell`、`hooks`、`connection`、`query-client`、`singletons`、`quit`                | 路由、根组件、布局与时间线 hook、侧车 → 客户端 / WebSocket 的接线、全局单例、退出确认                                                                                             |
| `src/api/`        | `client`、`socket`、`cache`、`queries`、`task-stream`、`attention-watcher`                             | REST 封装、唯一的 WebSocket、缓存写入、查询定义、详情页事件流、系统通知用的订阅                                                                                                   |
| `src/lib/`        | `layout`、`format`、`links`、`toast`、`patch`、`timeline`、`task-form`、`list-filter`、`settings-form` | 纯函数与小型 store，全部能在 Node 里单测                                                                                                                                          |
| `src/components/` | `top-bar`、`bot-column`、`service-state`、`hub-dialog`、`toaster`、`markdown`、`task-status`           | 跨页面组件                                                                                                                                                                        |
| `src/pages/`      | `tasks-layout`、`no-task-selected`、`new-task`、`task-list/`、`task-detail/`、`settings/`              | `task-detail/` 按页签和卡片拆文件（含 `approval-card`、`composer`、`web-task-panel`、`apply-dialog`）；`settings/` 每个分区一个文件                                               |
| `contract/src/`   | `labels.ts`                                                                                            | 全部枚举的中文标签（任务 / 轮状态、模式、工作区、来源、审批种类 / 决定 / 状态、决定人、停止原因、适配器、工具种类、diff 文件状态、scope 的名称与说明）和 `reasoningEffortLabel()` |

包与配置（定稿值）：

- `@agent-hub/web`，`type: module`；脚本 `dev: vite`、`build: tsc --noEmit && vite build`、`lint`、`typecheck`、`test: vitest run`。依赖：contract、`@repo/design-tokens`、`@repo/ui-web`（`workspace:*`）、`@tanstack/react-query` ^5.99.2、`@tanstack/react-virtual` ^3.14.23、`@tauri-apps/api` ^2.12.4、`@tauri-apps/plugin-notification` ^2.7.0、`@tauri-apps/plugin-opener` ^2.7.2、`lucide-react` ^1.8.0、`react` / `react-dom` ^19.2.5、`react-router` ^7.18.4、`react-markdown` ^10.1.0、`remark-gfm` ^4.0.1、`rehype-sanitize` ^6.0.0；开发依赖与 `apps/cardhub/web` 同版本。
- `vite.config.ts`：`server: { port: 5174, strictPort: true }`；`build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 2048 }`；`optimizeDeps.include: ['@agent-hub/contract', '@repo/ui-web']`（contract 是 CommonJS，D58）；vitest 用 `jsdom`、`globals`、`setupFiles: ['./test/setup.ts']`（只补 `ResizeObserver`）、`include: ['test/**/*.test.{ts,tsx}']`。
- `styles.css`：引入 `tailwindcss` 与 `@repo/design-tokens/tailwind.css`；`@source '../../../../packages/ui-web/src'`；`html, body, #root` 设 `height: 100%; overflow: hidden`；`body` 设 `user-select: none`（正文、代码、错误信息用 `select-text`）；`.markdown` 下用 `@apply` 补回标题、列表、引用、表格、行内代码的样式。
- 网格列宽写在 inline style 里（根 `lint` 禁止 `grid-cols-[…]`）。根 `eslint.config.mjs` 对 `apps/agent-hub/web/src/**` 加 `no-restricted-imports`：除 `components/hub-dialog.tsx` 外，不许从 `@repo/ui-web` 导入 `Dialog*` / `AlertDialog*`。

### 2.4 接口契约

**路由与布局**（`app/paths.ts`、`lib/layout.ts`）。顶栏 44、Bot 工具条 32、收起竖条 40、中栏 360、右栏最小 380 px；Bot 三档 360 / 440 / 560，窗口放不下时逐档调窄（偏好不变）。路由：`/`、`/tasks/:taskId`、`/new` 在 `TasksLayout` 下；`/settings/:section?` 占第 2–3 列；其余重定向到 `/`。

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
declare function effectiveBotWidth(pref: BotWidth, windowWidth: number): BotWidth;
declare function gridColumns(leftWidth: number): string; // `${left}px 360px minmax(380px, 1fr)`
```

**API 客户端**（`api/client.ts`）。`api.*` 与 [local-api.md](local-api.md) §5.1 一一对应（路径省略 `/api/v1`）；`TaskListFilter` 就是 `GET /tasks` 的查询参数（`archived` 必填）。Hub UI 不发幂等键（D67）。

```ts
type ClientErrorCode = ApiErrorCode | 'NETWORK' | 'NOT_CONNECTED' | 'BAD_RESPONSE';
declare class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number; // 没收到响应时为 0
  readonly details: JsonValue | null;
  issues(): Map<string, string>; // details.issues，按 path 取第一条
}
declare function errorMessage(error: unknown): string; // 服务端的中文 message 或客户端说明
type RequestOptions = { query?: Record<string, QueryValue>; body?: unknown; signal?: AbortSignal };
declare const client: {
  configure(target: { baseUrl: string; uiToken: string } | null): void; // 未配置 → NOT_CONNECTED
  request<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
};
```

**WebSocket**（`api/socket.ts`）。首条消息 `auth`，`ready` 后重发全部订阅；状态 `idle | connecting | open | reconnecting | stopped`，`getStatus` / `subscribeStatus` 供 `useSyncExternalStore`。重连间隔 1、2、5、10 秒（之后保持 10 秒）；`4008` 也走这组间隔，不立即重连；`4400`、`4403`、`4401` 停止，侧车给出新 token 后由 `connect()` 重新开始。

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
};
```

**缓存与连接**（`api/cache.ts`、`app/connection.ts`）。任务、审批对象写进 Query 缓存；事件流不进 Query（D21 的新措辞）。`applyTask` 以 `updatedAt` 较新者为准：比详情旧的推送整个忽略；列表里有就替换或（不再符合过滤条件时）移出，没有但符合条件时比第一条新就插到最前，否则让该列表失效。

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
  watcher: { onTask(task: TaskDto): void }; // AttentionWatcher：给 preparing / running 的任务各开一个订阅
  listTasks: (typeof api)['listTasks']; // onResync 时拉进行中的任务交给 watcher
};
declare function installConnection(deps: ConnectionDeps): () => void; // 渲染前调用一次
```

**查询**（`api/queries.ts`，`app/query-client.ts`）。默认 `staleTime` 30 秒、不在窗口聚焦时刷新、只对 `NETWORK` 重试 3 次；变更失败默认弹提示，`meta.silentError` 的由调用方在表单里显示。

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

**时间线**（`lib/timeline.ts`、`api/task-stream.ts`）。按 `seq` 去重；`message` / `reasoning` 按 `itemId` 拼接增量；`tool.*` 按 `itemId` 合并（先到输出时补一个占位条目）；同一轮连续同 `code` 的 `notice` 合并计数；`task.status`、`turn.*`、`diff.updated` 不进时间线（轮的开头和结尾由 `TurnDto` 渲染）。每帧（`requestAnimationFrame`）合并一批，没变的条目保持同一对象；最多缓存 5 个任务的时间线。`TimelineItem` 按 `kind` 区分：`session`、`message`、`reasoning`、`plan`、`tool`、`approval`、`notice`、`remote`。

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

**表单**（`lib/task-form.ts`）。`NewTaskForm` 的字段：`agentId`、`repoId`、`mode`、`workspace`、`baseRef`、`model`、`reasoningEffort`、`title`、`prompt`、`userVisible`；空字符串 = 用默认值。提示词最多 200 000 字符，标题最多 120。

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
declare function followUpBlocker(task: TaskDto): string | null; // 已归档 / 未结束 / worktree 已清理
declare function buildFollowUpBody(task: TaskDto, v: FollowUpValues): FollowUpBody; // 没改不传，改回默认传 null
```

**筛选与设置**（`lib/list-filter.ts`、`lib/settings-form.ts`）。`ListFilterState` 为 `{ status: StatusFilter; agentId: string; source: '' | TaskSource; q: string }`。

```ts
type StatusFilter = 'all' | 'active' | 'ended' | 'archived'; // 全部 / 进行中 / 已结束 / 已归档
declare function toTaskListFilter(state: ListFilterState): TaskListFilter; // 空字段省略，q 截到 100
declare function sectionOfIssue(path: string): SettingsSection; // 'agents.1.command' → 'agents'
declare function uniqueId(name: string, taken: readonly string[], fallback: string): string;
declare function newRepo(path: string, info: RepoInspectionDto, taken: string[]): RepoConfig;
declare function newAcpAgent(taken: readonly string[]): AcpAgentConfig; // command 留空，填了才能保存
declare function normalizeBlockedHosts(hosts: readonly string[]): string[]; // 锁定的 3 个 GitHub 主机在前
declare function isDirty(draft: HubConfig, saved: HubConfig): boolean; // 键排序后比较
declare function withRepo(config: HubConfig, repo: RepoConfig): HubConfig; // 第一个仓库成为默认
declare function withoutRepo(config: HubConfig, repoId: string): HubConfig; // 删默认仓库时清空默认
```

**组件**（`components/`，props 用文字列出）。`HubDialog({ open, onOpenChange, title, description?, size?: DialogContentSize, footer?, children? })` 与 `HubAlertDialog({ open, onOpenChange, title, description, confirmText, destructive?, onConfirm(): void | Promise<void> })` 只能受控使用；`onConfirm` 返回 Promise 时，结束前按钮显示“处理中…”且关不掉，成功自动关闭，失败保持打开。`Markdown({ text, className? })`（GFM + rehype-sanitize）；`TaskStatusBadge({ status, className? })`；`toast.info(text)` / `toast.error(text)` 返回 `number` 型 id，`toast.dismiss(id)`；`installLinkGuard(doc, open: (url) => Promise<void>, onError)` 返回卸载函数。

### 2.5 页面规格

- **§5.1 启动与服务状态**：侧车从未就绪或已放弃重启 → 整页（“正在启动本地服务…”或“本地服务没有启动” + 错误原文 + “重试”“复制错误信息”）。就绪过之后，顶栏中间显示“正在重启本地服务…”“本地服务已断开，N 秒后自动重启”（有 stderr 时带“详情”对话框）、“实时更新已断开，正在重连…”或“实时更新已停止 / 重新加载界面”。
- **§5.2 顶栏与左栏**：顶栏依次是“Agent Hub”、每个启用的 Agent（圆点颜色按 `healthTone`，`title` 为 `显示名：healthText`，运行数 > 0 时显示数字，点击去设置）、服务状态、“待审批 N”（打开最早一条的审批页签）、“新建任务”（⌘N）、设置（⌘,）。顶栏和 Bot 工具条不放下拉框。Bot 工具条：刷新（⌘⇧R）、用浏览器打开、调整宽度、收起（⌘1）；`BotSlot` 下按面板状态显示占位文案（未设置地址时带“去设置”）。
- **§5.3 任务列表**：筛选条有状态、Agent、来源三个 `Select` 和标题搜索框（去抖 300 ms、最多 100 字）；筛选状态放模块级变量（切页面不丢）。`useInfiniteQuery` + 底部 `IntersectionObserver` 哨兵翻页，每页 50，不虚拟化。行是 `<Link>`：第 1 行状态徽标 · 来源 · Agent · 时间；第 2 行标题 + “待批 N”“待你操作”（网页任务 `running`）“只读越界”；第 3 行仓库 · `#shortId` · 第 N 轮。当前行用 `useMatch('/tasks/:taskId')` 高亮。空列表、筛选无结果（带“清除筛选”）、加载、错误（带“重试”）四种状态。
- **§5.4 任务详情**：标题栏显示标题、Agent、模式、`modelLine`、工作区、仓库、分支、短号。按钮：停止本轮（`queued` 时叫“取消”；请求后仍未结束则变成“强制停止”，确认后 `force: true`）、追问（聚焦输入框）、应用（对话框，可选“合并到当前分支”，错误显示在对话框里）、归档 / 取消归档、删除（只有已归档的才有，破坏性确认）、在 Finder 中显示、复制路径。横幅只放在右栏：`lastError`、只读越界、worktree 已清理。网页任务在页签上方显示 `WebTaskPanel`（[web-agent.md](web-agent.md) §5.2）。页签放在 `?tab=`：输出 / Diff N / 审批 N / 详情。
  - 输出：`timelineRows` 用 react-virtual 渲染（动态测量行高；距底 48 px 以内算贴底，新内容自动滚动，否则显示“回到底部”）。各类条目：轮头（第 N 轮、提示词、模型）、消息（Markdown）、推理（默认折叠）、计划、工具（标题 + 命令，输出默认折叠，展开状态存在行外的 Map 里）、内联审批卡、提示（`×N`）、远端提交；轮尾显示停止原因、时长、用量和本轮改动统计。
  - 追问框在底部：`followUpBlocker` 不为空时禁用并显示原因；⌘Enter 发送；可改模型和推理档；每个任务一份草稿；错误显示在框内。
  - Diff：范围（整个任务 / 单轮）和轮次选择；运行中有“刷新 diff”（`live`）；`pairFilePatches` 按文件分块，超过 400 行默认折叠；截断和超过 5 MB 只有统计时给出提示；`DIFF_NOT_AVAILABLE` 显示“本轮结束后才有 diff”。
  - 审批卡：标题、命令、目录、路径、原因；按钮来自 `options`；`useNow(30_000)` 刷新剩余时间；`409 APPROVAL_NOT_PENDING` 提示“已被处理”并刷新；已结束的审批折叠显示决定人和时间。
  - 详情页签：字段表 + 轮表。任务不存在 → “任务不存在或已删除” + 返回列表。
- **§5.5 新建任务**（右栏页面，D62）：字段依次是 Agent、仓库、模式、工作区、基线（`Combobox`，原目录时隐藏）、模型与推理（`modelChoices` 的三种形态）、Codex 的“在 ChatGPT 应用里显示”、标题、提示词（⌘Enter 提交）。提示：D38 的只读提示、Agent 不可用、仓库有未提交改动且用 worktree（“未提交的改动不会带进 worktree”）。可写 + 原目录先确认。服务端 `issues` 按 path 显示在字段下，其余错误显示在表单顶部；成功后清空草稿并跳到该任务。草稿放模块级变量。
- **§5.6 设置**（D62、D65）：左侧分区导航（有错误的分区显示红点）；整份配置一份草稿，有改动时底部固定“保存 / 放弃更改”；带着未保存的改动离开 `/settings` 时用 `useBlocker` 确认。保存：`PUT /settings` → 写回缓存、失效 agents 与 repos → 对新增且勾选了“禁用 origin 推送”的仓库调用 `disable-origin-push` → `restartRequired` 时显示“端口改动在重启本地服务后生效”。
  - Agent：各字段、健康状态与“重新检查”、“添加 ACP Agent”、删除（确认）。仓库：路径 + “检测” → `newRepo`；默认仓库单选、远端只读列表、禁用 origin 推送、移除。本地郎：地址、两类 origin、UA、“用系统浏览器打开”、面板状态、“清除本地郎登录数据”（确认）。
  - 桥接 token（立即生效，不进草稿）：列表；新建（明文只显示一次，可复制）；改 scope（加 `approvals:decide` 要二次确认）；吊销；轮换默认 token（显示新明文和 `bridgeTokenFile`）。
  - 通用：端口、调度、审批超时、桥接 diff 上限、推送黑名单（锁定的 3 项删不掉）。数据与诊断：保留期限、诊断开关、导出诊断包、审计日志（按 `before` 翻页）、数据目录。关于：版本（`LaunchInfo.serverVersion`）、路径、“重启本地服务”（确认）。
- **§5.7 退出**：`createQuitHandler`：有排队或运行中的任务时先把窗口拉到前台再确认（文案说明会变成“已中断”、可以追问继续）；问不到任务数（3 秒超时）就直接退出；确认框开着时再按 ⌘Q 忽略。

### 2.6 验收标准

1. `pnpm --filter @agent-hub/web typecheck`、`test`、`build` 通过；`pnpm lint` 通过。
2. 单测覆盖：布局偏好读写与逐档调窄；`ApiError.issues`；WebSocket 重连与关闭码；`applyTask` 忽略旧推送、插入 / 移出 / 失效列表；时间线去重与合并；补丁拆分；新建任务与追问的表单规则；`toTaskListFilter` 与 `matchesFilter` 一致；设置表单的辅助函数；`labels.ts` 覆盖全部枚举值。jsdom 测试：`HubDialog` 打开时调 `botPanel.occlude`；`HubAlertDialog` 的“处理中”；Markdown 清洗（去掉脚本、事件属性、`javascript:` 链接，图片变链接）；浏览器开发模式下 `AppShell` 启动失败 → 重试 → 主界面（顶栏圆点、待审批按钮跳转、WebSocket 地址）。
3. 浏览器开发模式冒烟：连假侧车时三栏网格、健康圆点、“待审批 N”、本地郎占位都正确，控制台没有错误。macOS 上按 desktop-shell.md §10 验收。
4. hub-ui.md 嵌入的源码与验证过的临时目录逐字一致，章节号符合 §2.2，不出现真实域名和 token。

## 3. W2 desktop-shell.md 修正

只改文字，不改源码块：

- **§6 接线顺序**改成与 §2.3 一致的 5 步：① `takeDevToken`；② `installLinkGuard(document, openExternal, …)`；③ 渲染前 `installConnection(...)`（侧车每次就绪：配置客户端、连 WebSocket、让全部查询失效）；④ `void sidecar.start()`，然后渲染；⑤ `AppShell` 挂载时 `installAppMenu`（只装一次，回调经 ref 取当前状态），主界面里的 `useDesktopSync` 负责 `botPanel.configure(settings.bot)` 和 `setTrayCount(待审批数)`，系统通知由 `AttentionWatcher` 发出。
- **§8.1**：“重启服务”改为“重启本地服务”（设置页“关于”分区）。
- **§10**：第 6 条改为“打开确认框和‘应用到本地分支’对话框时 Bot 面板隐藏；新建任务、设置是页面，不隐藏 Bot”；第 10 条的文案改为“本地服务已断开，1 秒后自动重启”。
- 验收：文中提到的每个函数名都能在 §2.4 或 desktop-shell.md §5 的源码里找到。

## 4. W3 决策与措辞同步

在 `decisions-and-risks.md` §1.3 追加：

| 编号 | 决策                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D62  | 新建任务和设置是**页面**（右栏 / 中栏 + 右栏），不是对话框：对话框会隐藏 Bot 面板，填长表单时要能看着本地郎。对话框只用于确认、“应用到本地分支”和“本地服务的最后输出”。 |
| D63  | Markdown 用 react-markdown + remark-gfm + rehype-sanitize（默认规则），不做代码高亮；CSP 不放行远程图片，图片显示成链接。                                               |
| D64  | 输出时间线用 `@tanstack/react-virtual` 虚拟滚动；任务列表用游标分页 + `useInfiniteQuery`，不虚拟化。                                                                    |
| D65  | 不用表单库：React state + 手写校验 + 服务端 `issues` 按 path 回填；新建任务、追问、列表筛选的草稿放模块级变量（切页面不丢，重启丢）。                                   |
| D66  | 不用 toast 库：自写 `ToastStore`，右下角最多 3 条，普通 4 秒、错误 8 秒。查询错误在原位显示，变更错误默认弹提示。                                                       |
| D67  | Hub UI 不发 `Idempotency-Key`（服务端只对桥接 token 生效，local-api.md §3.3），防重复提交靠提交期间禁用按钮。                                                           |

同时修改：D21 改为“任务、审批对象（`tasks` 主题）写进 Query 缓存；任务事件流（`task` 主题）不进 Query，合并进 `TaskStreams` / `Timeline`”；D38 把新建任务的旧对话框说法改为“新建任务页”；D54 加上 desktop-shell.md §10。其他文件：`adapter-acp.md`、`adapter-interface.md`、`architecture.md`、`milestones.md`、`testing.md` 里同样改为“新建任务页”；`web-agent.md` §5.2 表格里的旧打开函数调用改为 `openExternal(...)`（`web/src/desktop/external.ts`）；`local-api.md` §1.1 的 `z.config(...)` 注释删掉“web/src/main.tsx 也调一次”（Hub UI 不在本地跑 zod 校验）。验收：在 `docs/` 下搜索把“新建任务”和“对话框”连写成的旧说法，以及 `openUrl` 后紧跟括号的调用，都没有结果。

## 5. W4 security.md 重写

目标章节（编号已被引用）：§1 资产，§2 威胁模型，§3 绝不向 GitHub 推送（§3.1 Agent 子进程的 git 环境与推送地址：`origin` 推送禁用、`allowedPushHosts` 推导、`checkPushTarget`；§3.2 子进程环境的构造：`agentEnv()`、登录 PATH、`envPassthrough`；§3.3 Hub 的 hooks 目录：`GitGuard.ensure()` 每次启动重写、脚本权限 0755、`pre-push` 只在有 `AGENT_HUB_PUSH_ALLOWED_HOSTS` 时放行、只许推 `refs/heads/agent-hub/*`、禁止删除、拦截记入 `guard/blocked.ndjson`；§3.4 事后检测：轮前轮后 `refs/remotes/*` 快照比对、读取拦截记录；§3.5 沙箱断网与 Hub 自己的推送），§4 凭据与身份（§4.2 环境变量白名单），§5 脱敏规则（密钥模式表），§6 脱敏的执行点（日志 meta、桥接响应、URL 去 userinfo），§7 本地接口与默认只读，§8 残余风险（R7），§9 桌面壳与 WebView（Bot 没有 IPC、capability 只授 `hub`、opener 只放行 `http(s)` 与 Finder、Hub 链接守卫、图片 CSP），§10 安全验收清单。`PushPolicy` 为 `{ allowedHosts: readonly string[]; blockedHosts: readonly string[]; allowLocal: boolean }`。

```ts
declare function parsePushTarget(url: string): { protocol: string; host: string | null }; // 支持 scp 写法与 IPv6
declare function checkPushTarget(url: string, policy: PushPolicy): string | null; // null = 允许，否则是拒绝原因
declare function stripUserinfo(url: string): string; // https 去掉整个 userinfo，ssh 只去密码
declare function redact(text: string): string; // §5 的全部模式
declare const FORWARDED_HOOKS: readonly string[]; // 13 个转发给仓库自己的 hook（不含 reference-transaction）
declare function prePushHookScript(blockedHosts: readonly string[], guardLog: string): string;
```

验收：`push-target.ts`、`hooks.ts`、`redact.ts` 的全文嵌入并在临时目录测试通过（https 带 token、scp、IPv6、本机路径、删除远端分支、推标签、子域名）；所有指向 security.md 的引用在新编号下语义正确。

## 6. W5 testing.md 重写

目标章节：§1 原则；§2 分层（Hub UI 测试路径改为 `web/test/**/*.test.{ts,tsx}`，删掉 tRPC、Playwright、`cargo test`）；§3 单元与集成测试规格（假 Agent 与剧本 `server/test/fakes/scenario.ts`、夹具录制、`jsonrpc.spec.ts`、`supervisor.spec.ts`、网页 Agent 的 jest 用例、desktop-shell 的 17 个行为测试、§2.6 第 2 条的 Hub UI 用例）；§4 错误路径矩阵（保留 E01… 编号；网页 Agent 行改为人工协作流程：轮询、完成本轮、拉取失败）；§5 CI（删掉 Prisma `db:generate` 和 Playwright 两步；`desktop/` 不进 CI）；§6 测试数据规范；§7 手工验收（合并现 §6 的表、desktop-shell.md §10、security.md §10）。验收：全文没有 Prisma、Playwright、tRPC、`cargo test`；矩阵里每个编号都能在 W6 的某一步里找到。

## 7. W6 milestones.md 重写

结构：§1 步骤总览（步骤、内容、依赖、检查点命令），§2 通用完成标准（保留编号；风险链接改为 `decisions-and-risks.md`；Rust 只要求 `cargo check`），§3 各步骤细则，§4 最终验收（testing.md §7）。步骤与依赖：

- 步骤 1 脚手架：commitlint 加 scope `agent-hub`（D56），根脚本 `dev:agent-hub`、`desktop:bundle`，`build` 排除 `@agent-hub/desktop`，CI 改动。
- 步骤 2 contract（依赖 1）；步骤 3 侧车骨架：路径、SQLite、迁移、日志、配置、`--lifeline stdin`、ready 行（依赖 2）；步骤 4 鉴权与 API 框架（依赖 3）。
- 步骤 5 进程管理与 JSON-RPC 传输、假 Agent 框架（依赖 3）；步骤 6 任务核心：调度、事件管线、审批、恢复（依赖 4、5）；步骤 7 工作区与 git：快照、diff、worktree、应用、推送守卫（依赖 6）。
- 步骤 8 Codex 适配器、步骤 9 ACP 适配器与 profile、步骤 10 网页适配器与 `PushService`（都依赖 7）；步骤 11 REST 端点、WebSocket、本地郎示例（依赖 8–10）。
- 步骤 12 桌面壳 Rust + `web/src/desktop/`（依赖 3）；步骤 13 Hub UI（依赖 11、12）；步骤 14 打包与手工验收（依赖全部）。

侧车开发脚本定为 `AGENT_HUB_DEV=1 nest start --watch --preserveWatchOutput`；contract 的 `package.json` 照 `@repo/shared` 输出 CommonJS，zod ^4.6.6。验收：每步都有检查点命令；不再出现“AoneD 驱动”“MCP 端点”。

## 8. W7 README 修订

- 布局示意图：Bot 工具条改为 `[⟳] [↗] [↔] [⇤]`，说明加上“`↔` 在三档宽度间切换”；审批按钮改为 `[允许一次][拒绝][拒绝并停止本轮]`（Codex 另有“本会话允许”）。
- 遮挡说明改为：对话框和确认框打开时 Bot 面板临时隐藏；下拉框只放在中栏和右栏、向下展开，不隐藏 Bot。
- 目录结构：contract 列表加 `dto.ts`；`web/src` 列出 `app/`、`api/`、`lib/`、`components/`、`pages/`、`desktop/`。文档索引加上本文。
- 运行 `prettier --write README.md`。

## 9. W8 校验与提交

每项完成后在仓库根目录执行，全部通过再提交：

- `pnpm exec prettier --check apps/agent-hub`、`pnpm lint`。
- mermaid 图全部能用 `mmdc` 渲染；文档间相对链接与 `§` 锚点都指向存在的文件和章节；表格每行列数与表头一致。
- `rg -n 'ahu_[A-Za-z0-9_-]{43}|ahb_[A-Za-z0-9_-]{20,}' apps/agent-hub` 没有结果（文档里只能用明显的假 token），域名只用 `*.example` 或 `<内网 git 域名>`。
- 嵌入的源码在临时目录里 `tsc --noEmit` 通过、相关测试通过，与文档逐字一致。
- 风险和决策只链到 [decisions-and-risks.md](decisions-and-risks.md)。相对链接必须能打开目标文件；紧跟在链接后面的 `§` 必须对得上该文件的章节号。
