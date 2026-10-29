# Cardhub Monorepo · 接手 Agent 速读

> 这份文档专为接手本仓库的 AI Agent 准备。粒度是"开机即跑"——读完不需要再问"用什么栈/为什么这么配/为什么 miniapp 锁 React 18"。
>
> 文档分工见 [README.md](README.md)：功能现状看 [feature-inventory.md](feature-inventory.md)，待办任务看 [development-backlog.md](development-backlog.md)，本文只负责环境、约定和踩坑。

最后更新：2026-10-17（Zeabur → 阿里云香港 VPS 迁移完成，功能梳理与任务池落地）。新发现的坑请补到 §6。

---

## 1. 项目本质

- **仓库**：[/Users/xujiaqi/workspace/multi-apps](.)（**multi-apps**），定位是承载本人多个个人应用的 monorepo。
- **首个应用**：**Cardhub**，PRD 在 [docs/Cardhub/prd/](prd/)，目标是一个"现代化卡牌百科 + 社区"。
- **多端目标**：Web / Desktop (Win/mac/Linux) / iOS / Android / 小程序（微信 + 多平台）+ H5。
  - Web/Desktop/iOS/Android **共享一份 React 19 代码**（Tauri WebView 加载 web 产物）。
  - 小程序走独立 **Taro 4 + React 18**（Taro 暂不支持 React 19）；UI 重写一层，但业务逻辑、tRPC client、stores、shared utils、i18n、zod schema 全部复用。

## 2. 技术栈（最终决策，**不要再换**）

| 层          | 选型                                                                               | 备注                                                            |
| ----------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 包管理      | **PNPM 10.18.2 + workspaces**                                                      | 锁在 `package.json#packageManager`                              |
| 任务编排    | **Turborepo 2.9.6**                                                                | TUI on                                                          |
| 后端        | **NestJS 11 + tRPC v11**（Express adapter，**非** `nestjs-trpc` 适配器）           | tRPC 直接用 Express middleware                                  |
| ORM         | **Prisma 6.19.3**（**别升 7**，schema 语法 breaking）                              | seed 用 `ts-node`                                               |
| DB / Cache  | PostgreSQL 16 / Redis 7（Docker compose）                                          | 见 [docker/docker-compose.yml](../../docker/docker-compose.yml) |
| Auth        | `@nestjs/jwt` + `passport-jwt` + bcrypt 10 rounds                                  |                                                                 |
| 前端        | React 19.2 + TypeScript 6.0.3 + Vite 8                                             | TS 6 用 `ignoreDeprecations: "6.0"` 抑制告警                    |
| 样式        | **TailwindCSS v4** + shadcn/ui（手写在 `@repo/ui-web`）                            | v4 JIT 扫不到运行时拼接 class，详见 §6                          |
| 状态        | **MobX 6**（client）+ `@tanstack/react-query 5`（server，via `@trpc/react-query`） | PRD 写的是 Zustand+SWR，已被用户确认改                          |
| 路由        | `react-router` v7                                                                  |                                                                 |
| 桌面/移动   | **Tauri v2**                                                                       | [apps/cardhub/native/](../../apps/cardhub/native/)              |
| 小程序      | **Taro 4.2** + React **18**                                                        | React 18 是被迫的，原因见 §6                                    |
| Lint/Format | ESLint 10（flat config）+ Prettier 3                                               | NestJS 装饰器场景的 `import type` 警告是已知误报，**不要修**    |
| Git         | Husky 9 + lint-staged 16 + commitlint 20                                           | 严格 conventional commits，scope 白名单见 §6.10                 |

### 与 PRD 的关键差异

PRD 写"后端 Rust + Axum + SQLx"和"前端 Zustand + SWR"。实际选型已和用户确认改为（完整冲突裁决表见 [README.md](README.md#历史文档与当前实现的冲突裁决)）：

- 后端 Rust → **NestJS + tRPC + Prisma**：理由是端到端 TypeScript 类型推导对个人项目效率最高。
- Zustand → **MobX**：与现有跨端 store 体验更一致。
- SWR → **@tanstack/react-query**（通过 `@trpc/react-query` 集成）。
- Prisma 7 → **Prisma 6**：Prisma 7 的 schema 语法是 breaking change（datasource url 必须外置），不必要的折腾。

## 3. 仓库结构

```
multi-apps/
├── apps/cardhub/
│   ├── api/        NestJS + tRPC + Prisma 后端
│   ├── web/        Vite + React 19 web
│   ├── native/     Tauri v2 壳（Desktop + iOS + Android 共一个工程）
│   └── miniapp/    Taro 4 + React 18（微信/支付宝/抖音/百度/QQ + H5）
├── packages/
│   ├── shared/         zod schemas + i18n + 常量 + utils（CJS 输出）
│   ├── stores/         MobX stores（含 LocaleStore / SessionStore）
│   ├── trpc-contract/  仅 type re-export AppRouter
│   ├── design-tokens/  Tailwind preset + Taro scss
│   ├── ui-web/         shadcn/ui 组件（Button, Card, ...）
│   ├── ui-mini/        Taro 组件包装
│   ├── config-ts/      TS 预设（base/react/node/nest/taro）
│   ├── config-eslint/  ESLint flat 预设
│   └── config-prettier/
├── Dockerfile.api      生产 API 镜像（仓库根目录构建）
├── Dockerfile.web      生产 Web 镜像（nginx + 运行时 /config.js）
├── deploy/             VPS 部署：compose、Caddy edge、部署 / 备份脚本
├── docker/             本地开发用 docker-compose.yml（Postgres + Redis）
├── docs/Cardhub/       文档索引、本文档、功能全景、任务池、PRD / UI 规范
└── .github/workflows/  ci / images / deploy + 原生与小程序 release（后两者为手动 / 占位）
```

## 4. 已完成功能

PRD Epic 1–3（浏览、搜索、账户、卡牌评论）和 Phase 2（论坛、交易信息板、举报队列）均已落地，生产运行在阿里云香港 VPS。功能逐项状态、Web 路由、tRPC 接口清单、数据模型和已知缺陷统一维护在 [feature-inventory.md](feature-inventory.md)，本文不再重复，避免两处不同步。

### 数据库与种子数据

- Schema：[apps/cardhub/api/prisma/schema.prisma](../../apps/cardhub/api/prisma/schema.prisma) — `User / Series / Card / Comment / Topic / Reply / Listing / Report` 8 张表。
- Migrations：`20260501165944_init` → `20260502184922_add_user_role_and_forum` → `20260502185947_add_listings_and_reports`。
- Seed：
  - catalog-only（生产、预发）：`pnpm --filter @cardhub/api seed:catalog`，只写 3 系列 / 9 卡牌，不创建用户或用户内容。部署后在容器内执行 `node dist/scripts/seed-catalog.js`，见 deploy/README.md。
  - demo（仅本地）：`pnpm --filter @cardhub/api seed:demo` 或 `pnpm --filter @cardhub/api db:seed`，写 catalog + alice / admin 两个 demo 用户。运行前必须设置 `DEMO_USER_PASSWORD` / `DEMO_ADMIN_PASSWORD`，缺失会非零退出。

### 测试账号

M6 起 demo seed 预置两个账号（`pnpm --filter @cardhub/api db:seed` 自动 upsert；密码来自环境变量，不写入代码或文档）：

| username | email              | password env var      | role  | 用途                                                   |
| -------- | ------------------ | --------------------- | ----- | ------------------------------------------------------ |
| `alice`  | alice@cardhub.test | `DEMO_USER_PASSWORD`  | user  | 普通用户，发帖 / 评论 / 发布交易意向                   |
| `admin`  | admin@cardhub.test | `DEMO_ADMIN_PASSWORD` | admin | 论坛删任意 topic / reply、查看 `reports.list` 举报队列 |

> ⚠️ 这两个账号只用于本地开发。生产和预发都只运行 catalog seed，预发测试账号由 ops 手动创建随机密码；不要在仓库、PR 描述或部署文档中记录真实密码。

## 5. 开发命令速查

| 用途                 | 命令                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------- |
| 一次起 web + api     | `pnpm dev`                                                                                    |
| 仅 api               | `pnpm dev:api`                                                                                |
| 仅 web               | `pnpm dev:web`                                                                                |
| Tauri 桌面           | `pnpm dev:native`                                                                             |
| 小程序               | `pnpm dev:miniapp`                                                                            |
| 共享包 watcher       | `pnpm dev:packages`                                                                           |
| 起 Postgres + Redis  | `pnpm db:up` / `pnpm db:down`                                                                 |
| 应用迁移             | `pnpm db:migrate`（**注意交互式，CI/script 用 `prisma migrate deploy`**）                     |
| 灌本地 demo 种子数据 | 设置 `DEMO_USER_PASSWORD` / `DEMO_ADMIN_PASSWORD` 后运行 `pnpm --filter @cardhub/api db:seed` |
| 全仓 typecheck       | `pnpm typecheck`                                                                              |
| 全仓 lint            | `pnpm lint`                                                                                   |
| Playwright 冒烟      | 构建 API 与 Web 后 `pnpm --filter @cardhub/e2e test:e2e`（需本机 Postgres 与 Redis）          |

## 6. 关键设计决策与"别再踩"清单

> 这一节如果忽略，下一个 Agent 会原地复刻一遍我踩过的坑。**请通读**。

### 6.1 共享包统一 CJS 输出

`shared / stores / trpc-contract / design-tokens / ui-mini` 的 `package.json` 都**不要**加回 `"type": "module"`，`tsconfig.build.json` 的 `module` 都是 `CommonJS`（trpc-contract 是 `NodeNext` 因为要解析 `@cardhub/api` 的 exports 字段）。

**原因**：NestJS 编译产物是 CJS，require 一个 ESM 包会报 `ERR_UNSUPPORTED_DIR_IMPORT`（tsc 不会帮 ESM import 加 `.js`）。

### 6.2 Vite `optimizeDeps.include` 必须包含全部 `@repo/*`

见 [apps/cardhub/web/vite.config.ts](../../apps/cardhub/web/vite.config.ts)。CJS 包没法直接给浏览器做 named import，靠 Vite 预打包。

### 6.3 Tailwind v4 JIT 不扫运行时拼接的类

gradient 类全集中在 [apps/cardhub/web/src/lib/gradients.ts](../../apps/cardhub/web/src/lib/gradients.ts)，用字面量写出来让 JIT 看见。新增 series/card slug 时**记得在这里加映射**，否则封面会变成纯灰。

### 6.4 小程序锁 React 18，pnpm overrides 把 `@types/react` 统一到 19

Taro 4.2 硬编码了 `react/cjs/react-jsx-runtime.production.min.js`，React 19 删了这个 exports 入口。因此：

- `apps/cardhub/miniapp/package.json` 锁 `react@^18.3.1`。
- [pnpm-workspace.yaml](../../pnpm-workspace.yaml) 的 overrides 把 `@types/react` 强统一到 19，否则 web 端会爆 `Type 'bigint' is not assignable to ReactNode`。

### 6.5 Webpack 锁 5.91.0

`pnpm-workspace.yaml` 的 overrides 里有 `webpack: "5.91.0"`。Taro 4.2 的 webpack5-runner 校验 ProgressPlugin schema 时认死老版本，新版会炸。

### 6.6 NestJS dev 启动竞态

[apps/cardhub/api/nest-cli.json](../../apps/cardhub/api/nest-cli.json) 的 `deleteOutDir: false`、`dev` 脚本带 `--preserveWatchOutput`、tsconfig 不开 `incremental`。三件套缺一会偶发 `Cannot find module dist/main`。

### 6.7 Prisma `JsonValue` 不要直接透出到 tRPC 输出

会把客户端 TS 推导深度撑爆（`TS2589`）。在后端 router 显式收窄成 `Record<string, primitive> | null`，参考 [apps/cardhub/api/src/modules/cards/cards.router.ts](../../apps/cardhub/api/src/modules/cards/cards.router.ts) 里 `attributes` 的写法。

### 6.8 JWT context 是工厂函数

tRPC 的 `createContext` 由 [apps/cardhub/api/src/trpc/context.ts](../../apps/cardhub/api/src/trpc/context.ts) 的 `makeCreateContext(authService, prisma)` 在启动时构造。验签后按主键查一次用户（`tokenVersion`、`role`）。新增需要 ctx 的依赖时，从 Nest 容器拿出来传给 factory，**不要**在 router 里直接 import 单例。

### 6.9 后台启动 vite 用 subshell

macOS 没有 `setsid`，`nohup ... &` 在脚本退出后会被 SIGHUP。要用 `(pnpm dev </dev/null >log 2>&1 &)` 这种 subshell 包装。

### 6.10 commitlint scope 白名单

见 [commitlint.config.cjs](../../commitlint.config.cjs)：

```
root, web, native, miniapp, api, ui-web, ui-mini, shared, stores,
trpc-contract, design-tokens, config, docker, ci, docs, deps
```

其它 scope 会被 husky 拒绝。新模块（forum / listings / reports / sentry）走 `api` / `web`，不新增 scope。

### 6.11 Prisma migrate dev 是交互式命令

会阻塞等待 migration name 输入。**脚本/CI 必须用 `--name <name>`**：

```bash
pnpm --filter @cardhub/api prisma migrate dev --name add_user_role
```

CI / 部署用 `prisma migrate deploy`（非交互）。

### 6.12 测试账号 + 测试 DB 隔离

集成测试不要打开发库。测试 DB 用 service container（CI）或本地另起一个 schema：

```bash
DATABASE_URL="postgresql://cardhub:cardhub@localhost:5432/cardhub_test?schema=public" \
pnpm --filter @cardhub/api prisma migrate reset --force --skip-seed
```

Playwright 冒烟另用库 `cardhub_e2e`（可用 `DATABASE_URL` 覆盖）。每次运行在 global setup 里生成 `alice` / `admin` 的密码并写入 gitignore 的 `.auth/passwords.json`，不把密码放进仓库。冒烟会自己拉起 API 和 `vite preview`，写接口的内存限流随进程重启清掉。

### 6.13 Sentry 守卫式初始化

API 端 [main.ts](../../apps/cardhub/api/src/main.ts) 与 Web 端 [main.tsx](../../apps/cardhub/web/src/main.tsx) 都用 `if (DSN)` 守卫包住 `Sentry.init()`，**dev 留空 DSN 时不上报、不增加任何运行时开销**。当 API `SENTRY_DSN` 或 Web `WEB_SENTRY_DSN` 设置后：

- API：`SentryExceptionFilter` 全局拦截 5xx；tRPC `onError` 仅上报 `INTERNAL_SERVER_ERROR`（避免 `BAD_REQUEST` / `UNAUTHORIZED` 噪音）；environment 取 `SENTRY_ENVIRONMENT`（compose 中等于 `ENV_NAME`），release 取 `GIT_SHA`。请求上的 id 写入 Sentry 标签 `request_id`（见 §6.18）。
- Web：`ErrorBoundary` 的 `onError` 调 `Sentry.captureException`。

真实 DSN 不要写进仓库。API 的 DSN 放在 VPS 的 `/opt/cardhub/<environment>/<environment>.env` 的 `SENTRY_DSN`；Web 的 DSN 放在同一 env 文件的 `WEB_SENTRY_DSN`。Web Docker 入口脚本会把 `WEB_SENTRY_DSN`、`SENTRY_ENVIRONMENT` 和镜像 `GIT_SHA` 写入运行时 `/config.js`，因此同一个 Web 镜像可同时用于 staging 和 production。`VITE_SENTRY_DSN` 仅保留给非容器静态构建 fallback，不用于 Docker 部署。

### 6.14 tRPC URL 解析（Web / Tauri）

[apps/cardhub/web/src/lib/trpc.tsx](../../apps/cardhub/web/src/lib/trpc.tsx) 的 `resolveTrpcUrl()` 按以下顺序决策，越具体的分支越靠前：

1. Tauri + Android + 开发模式 → `http://10.0.2.2:4000/trpc`（Android 模拟器访问宿主机的地址不是 `localhost`）。
2. Tauri（检测 `__TAURI_INTERNALS__`）→ `VITE_TRPC_URL_TAURI`，没有则 `VITE_TRPC_URL`；必须是以 `/trpc` 结尾的绝对 http(s) 地址，否则直接抛错。iOS 模拟器与宿主同网络，也走这一条。
3. 浏览器 → 运行时 `window.__CARDHUB_CONFIG__.TRPC_URL`（Web 容器启动时由 nginx 入口脚本写入 `/config.js`）→ 构建时 `VITE_TRPC_URL` → 同源 `/trpc`（本地开发由 Vite 代理到 `CARDHUB_API_ORIGIN`，默认 `http://localhost:4000`。Playwright 冒烟把这个变量指到自己的 API 端口，`vite dev` 和 `vite preview` 共用同一份代理）。

`.env.development` / `.env.staging` / `.env.production` 三套配置按 `vite build --mode <mode>` 选用。生产镜像的 `VITE_TRPC_URL` 留空，让同一个镜像通过运行时 `TRPC_URL` 同时服务预发和生产。

**注意**：Vite 会把 `VITE_TRPC_URL=` 注入为空字符串而不是 `undefined`。`resolveTrpcUrl()` 先 `trim()` 并把空字符串归一成 `undefined`，否则 `httpBatchLink` 会把 `auth.login` 发到 `http://localhost:5173/auth.login?batch=1`，登录 / 注册直接 404。

### 6.15 Safe-area 不要 padding 整个 body（M4）

iOS Tauri / iOS Safari 的"刘海屏"通过 `env(safe-area-inset-*)` 暴露内边距。**不要**在 `<body>` 上加 `padding-top`，因为 `SiteHeader` 是 `position: sticky; top: 0`——一旦 body 有 padding，sticky 会贴到 padding 后的位置，刘海上方留出一条颜色条带，体验丑。

正确做法（已落地在 [globals.css](../../apps/cardhub/web/src/styles/globals.css)）：CSS vars `--safe-area-{top,right,bottom,left}` + utility 类 `.app-safe-top` / `.app-safe-x` / `.app-safe-bottom`。

- SiteHeader（sticky）→ `.app-safe-top`：背景延伸到刘海，内容下沉。
- PageShell `<main>` → `.app-safe-x .app-safe-bottom`：横屏 iPhone 的左右切角 + 底部 home indicator。
- 桌面 / Android（无刘海）→ `env(...)` fallback `0px`，零成本 no-op。

### 6.16 Taro 小程序集成踩坑（M5）

1. **React 18 硬锁**：见 §6.4。miniapp 的 `package.json` `react@^18.3.1`，pnpm 的 overrides 把 `@types/react` 统一到 19。miniapp 代码里写 React 19-only 语法（e.g. `use`、Context Actions）会在其它端炸。

2. **H5 build 默认不生成 `index.html`**：Taro 4.2 的 [`@tarojs/webpack5-runner`](../../node_modules/.pnpm) `H5WebpackPlugin.getPlugins()` 里写死 `if (fs.existsSync(path.join(sourceDir, 'index.html'))) { plugins.htmlWebpackPlugin = ... }`。**必须** 在 `apps/cardhub/miniapp/src/index.html` 留一个最简模板，否则 `dist/h5/` 只有 `js/` + `css/`，没有入口 HTML，浏览器根本加载不起来。模板已提交。

3. **小程序没有 Tailwind JIT**：web 端的 `bg-gradient-to-br from-… via-… to-…` 字面量在 miniapp 完全无效。M5 的方案是三处同步：
   - `apps/cardhub/web/src/lib/gradients.ts`（Tailwind class string，给 v4 JIT 看）
   - `apps/cardhub/miniapp/src/lib/gradients.ts`（返回完整 `linear-gradient(…)` 字符串）
   - `packages/design-tokens/src/taro.scss`（`$gradient-<slug>: linear-gradient(…)` SCSS 变量）

   新增 slug 三个都要加，否则封面灰底。

4. **miniapp 的 tRPC 不是 React-Query 变体**：web 端用 `@trpc/react-query`，hooks `useQuery` / `useMutation` 自动管 loading/error。miniapp 端是裸 `@trpc/client`，每页要自己 `useState` 管 loading/error + `useEffect` 触发。参数 schema 可以复用 `@repo/shared` 的 zod `safeParse()` 做前端校验。

5. **Taro page 目录结构**：每个 page 必须同时有 `index.tsx`（组件）+ `index.config.ts`（`definePageConfig(...)`）+ `index.scss`（可选但建议有，保持 loader chain 稳定）。空 scss 也行。

6. **路由栈行为**：`Taro.navigateTo` 有 **10 层页面栈上限**。登录成功后优先用 `navigateBack()`（把登录页从栈移除）；只有第一层时 `redirectTo` 回首页。不要用 `switchTab`，除非某页在 tabBar 里注册过。

7. **微信服务器域名白名单是硬性阻塞**：详见 miniapp README。开发工具里勾 `不校验合法域名` 能绕过，**上线必须配**。M5 代码侧 ready，`AppID 申请 + 白名单` 要用户手动完成。

8. **miniapp local `pnpm lint` 用不了**：Taro CLI 依赖 ESLint 8.41.0，和仓库根的 ESLint 10 flat config 互斥。`apps/cardhub/miniapp/package.json#scripts.lint` 是一个占位 echo；`pnpm lint`（仓库根）才是真实 lint。

9. **mobx-react-lite + Taro**：`observer()` 包一下页面组件即可，不需要额外 polyfill。但 Taro 的 `useDidShow` / `useDidHide` 是 Taro 自有 hook，不要和 React 的 `useEffect` 混用——要在页面 _返回可见_ 时做事（比如刷新评论列表）就用 `useDidShow`。

### 6.17 部署相关的坑

1. **Web 容器缺少合法的 `TRPC_URL` 会拒绝启动**：入口脚本 `apps/cardhub/web/docker-entrypoint.d/10-cardhub-runtime-config.sh` 要求完整的 http(s) 地址且以 `/trpc` 结尾，不再回退同源。`Dockerfile.web` 头部的旧注释与此不符（CH-005 清理）。
2. **Prisma 迁移只增不删**：发布时 `prisma migrate deploy` 先于新容器执行，失败回滚只换镜像。已合入 `main` 的迁移文件不能删改；删列和改名不能写进同一次迁移。约定见 [development-backlog.md](development-backlog.md) §1.3。
3. **`seed-catalog` 会覆盖同 slug 的数据**：它按 slug upsert，不要在生产重复执行；内容管理后台（CH-107）上线时要改为只插入缺失记录。
4. **env 文件里的 `CORS_ORIGIN` 会覆盖代码默认值**：代码默认值包含 Tauri 来源，`deploy/.env.example` 的生产值只有 `https://card-hub.app`。桌面 / 移动端连生产 API 前必须补上 Tauri 来源（CH-303）。
5. **限流按 IP，计数在 Redis**：`trust proxy` 只信任 1 跳（Caddy）。如果以后在 Caddy 前再加 CDN / SLB，要同步调整，否则所有用户会共享同一个 IP 的限额。各限流器前缀是 `cardhub:rl:v1:<名称>:`。Redis 故障时 `passOnStoreError` 放行，不要改回“失败就 500”。公开目录缓存前缀是 `cardhub:cache:v1:`，TTL 5 分钟；停 Redis 时读接口回源。API 测试需要本机 Redis（CI 用 service container）。Jest 里每个 `createApp` 用独立限流前缀，缓存键带 worker id，避免并行用例互相顶掉计数或列表缓存。Redis 地址在创建客户端时读当前 `process.env`：`ConfigModule.forRoot` 会在 `AppModule` 第一次求值时把环境变量冻成快照，之后再改 `REDIS_PORT` 若只走 `ConfigService.get` 仍会连到原来的实例。停 Redis 期间的后台写无法删键；连接断开或删键失败后，下次 `ready` 会 `SCAN` + `UNLINK` 清掉整个 `cardhub:cache:v1:*`，不要改成 `KEYS`，也不要扫到 `cardhub:rl:v1:*`。清除失败按 200ms 起指数退避，最多 6 次，单次等待不超过 30 秒，到上限后停；下一次断线再重新计。`X-Cache` 只在 `ENV_NAME=staging` 且 `CATALOG_CACHE_HEADER=true` 时出现，生产默认关闭。这两个变量必须写在 `deploy/docker-compose.yml` 的 api `environment:` 里，env 文件本身不会进容器。`deploy.yml` 读取 `vars.CATALOG_CACHE_HEADER`，只有精确的 `true` 保持 true，空值和其他值都写成 `false`，再由 `remote-deploy.sh` 原地写入 env 文件。生产默认 false，所以不会输出 `X-Cache`。staging 要打开就在 GitHub Environment 里把该变量设为 `true`。一次 HTTP 里有多个 procedure 时，头只留一个值：有 BYPASS 就是 BYPASS，否则有 MISS 就是 MISS，否则 HIT。这是部署配置，合入要守夜人手动做；staging env 设 `CATALOG_CACHE_HEADER=true`，生产不设。
6. **本机办公网络可能拦截 `card-hub.app`**：在 owner 的办公网络下访问线上域名会返回安全策略拦截页（HTTP 403）。线上验证请在外网进行，或通过 VPS 上的 `curl --resolve` 检查。

### 6.18 API 日志是 JSON，request id 有格式

`apps/cardhub/api` 用 `nestjs-pino`。`createApp` 里要保留 `app.useLogger(app.get(NativeLogger))`，否则 Nest 的 `Logger` 仍是文本，请求上下文也不会挂上。

`LoggerModule.forRoot` 只在 `AppModule` 注册一次，并且 `forRoutes` 留空。请求日志由 `createApp` 里的 `attachRequestLogging` 挂上，位置在 helmet 和 JSON parser 之前。Nest 的 `init()` 会把模块中间件追加到已有的 `app.use` 之后；parser 在 400/413 时直接结束响应，不调用 `next()`，晚挂的中间件看不到这次请求。再挂一份 pino-http，每个请求会打两行。`useLogger` 之后要 `flushLogs()`，否则 `bufferLogs` 会把 Nest 的日志一直留在缓冲区里。

`X-Request-Id` 用 zod 校验：trim 后 1–128 字符，字符集 `[A-Za-z0-9._:-]`，首字符必须是字母或数字。空、换行、超长都会换成新的 UUID。不要把原始头写进日志。响应头 `X-Request-Id` 是最终采用的值。

请求日志只有一个 `requestId`。不要在 pino 的根 `base` 上再写 `requestId: null`：pino 会把子 logger 的绑定接在父绑定后面，同名键会在原始 JSON 里出现两次。进程级日志没有这个键。Sentry 事件标签是 `request_id`。`authorization`、`cookie`、`set-cookie` 和请求体不进日志。`x-forwarded-for` 保留：限流读的是请求上的 `req.ip`，不读日志；Caddy 后面 `remoteAddress` 只是代理地址，排障要靠这一个头对上客户端。`url` 和 `query` 里的 `input`、`token`、`code`、`access_token`、`refresh_token`、`id_token`、`reset_token` 记为 `[Redacted]`，避免 tRPC 的 `?input=` 或以后的验证链接进日志。

`LOG_LEVEL` 只接受 pino 的级别名，其它值回到 `info`。Compose 把这个变量注入 API 容器。

日志轮转是 `json-file` 的 `max-size=10m`、`max-file=5`。改 compose 后要重建容器，`docker inspect` 才能看到。守夜人在 staging 验收。

### 6.19 收藏是私人数据，迁移只加表

`collection_items` 是 CH-203 cut-3 的新表。旧进程不读它。应用回滚到上一个 SHA 时表留着，不要用删迁移文件的方式回滚。

`collection.list` 和 `collection.progress` 只按当前登录用户查询。不要把 `ownedCount` / `wanted` 放进 `cards.bySlug` 或 `cardhub:cache:v1:` 的目录缓存；那条缓存是公开的。平行版本分母等 CH-213，这次的 `total` 是系列里的全部卡牌。

## 7. 路线图

下面的 M0–M7 路线图**已全部完成**，保留作历史参考（原计划文件 `.cursor/plans/cardhub-roadmap-execution_*.plan.md` 未纳入仓库）。后续工作统一在 [development-backlog.md](development-backlog.md) 中排期和领取。

```mermaid
flowchart TD
  M0[M0 移交文档 done] --> M1[M1 测试 plus 安全 plus CI]
  M1 --> M2[M2 NFR 与 UX 收尾]
  M2 --> M25[M2.5 API 部署 plus 监控]
  M25 --> M3[M3 Tauri Desktop]
  M3 --> M4[M4 Tauri iOS 与 Android]
  M25 --> M5[M5 Taro 小程序]
  M2 --> M6[M6 Phase 2 论坛]
  M6 --> M7[M7 Phase 2 交易板]
```

| Milestone | 关键产出                                                                                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1**    | jest+vitest 装包、helmet、@nestjs/throttler、bcrypt CI 选型、6-8 个核心测试、coverage 阈值、CI 跑 test、Dependabot、pnpm audit                                                                                                           |
| **M2**    | LocaleStore localStorage + MobX autorun 同步 `<html lang>`、双层 ErrorBoundary、skip-to-content、focus-visible、SiteHeader 折叠菜单、路由懒加载、bundle visualizer、登录后 redirect 回原页、首页硬编码、axe-core dev 扫描、Lighthouse CI |
| **M2.5**  | VPS + Docker Compose 部署、Sentry 前后端、Postgres/Redis、Dockerfile 启动跑 migrate deploy、VITE_TRPC_URL 多环境策略、部署运行手册                                                                                                       |
| **M3**    | `cargo tauri icon` 生成图标、Tauri 感知 trpc URL（`__TAURI_INTERNALS__`）、CORS 校验、本地 dmg 构建、native README                                                                                                                       |
| **M4**    | `tauri ios init` / `android init`、Android emulator 用 `10.0.2.2`、iOS Simulator 用 localhost、真机用 staging URL、`viewport-fit=cover` + `safe-area-inset`                                                                              |
| **M5**    | 微信白名单 + HTTPS（前置）、app.tsx 挂 store + Taro storage driver、注册 7 个页面、ui-mini 扩组件（Field/Empty/Skeleton/Link）、SCSS 渐变变量                                                                                            |
| **M6**    | Prisma 加 `User.role` + Topic + Reply、5min 编辑窗口、admin 删任意、Markdown body（react-markdown + rehype-sanitize）、cursor 分页                                                                                                       |
| **M7**    | Prisma Listing（含 currency / imageUrls）+ Report 表、举报系统、`/trade` + 卡牌页内列表、强 disclaimer                                                                                                                                   |

## 7.5 部署运行手册

### 7.5.1 VPS + Docker Compose

Cardhub 以平台无关的方式部署在阿里云香港的一台 Ubuntu 24.04 VPS 上（2026-10 从 Zeabur 迁移，PR #37–#49）：

- 镜像：仓库根 [`Dockerfile.api`](../../Dockerfile.api) 与 [`Dockerfile.web`](../../Dockerfile.web)。Web Docker 镜像使用 PR #38 的 nginx entrypoint，在容器启动时由运行时 `TRPC_URL` 生成未缓存的 `/config.js`。
- 编排：[`deploy/docker-compose.yml`](../../deploy/docker-compose.yml) 启动 API / Web / Postgres 16 / Redis 7；Postgres/Redis 仅在各 compose project 默认网络内。
- 代理：[`deploy/edge`](../../deploy/edge) 的共享 Caddy 负责 80/443、自动 HTTPS 和反向代理；API/Web 通过 external `edge` 网络上的 `ENV_NAME-api` / `ENV_NAME-web` 别名接入。生产 Web 根域名路由由 `deploy/edge/optional/root-web.caddy` 提供，`/opt/cardhub/edge/edge.env` 中需保持 `ROOT_WEB_DOMAINS=card-hub.app`。根域名和 staging Web 域名上的 `GET /sitemap.xml` 反代到对应 API；`/robots.txt` 仍由 Web 容器提供。改完 Caddyfile 后要重建边缘容器，否则 `/sitemap.xml` 仍会落到 SPA。
- 配置：复制 [`deploy/.env.example`](../../deploy/.env.example) 到 `/opt/cardhub/production/production.env` 与 `/opt/cardhub/staging/staging.env`，两套环境用同一个 app compose 文件和不同 project name（`cardhub-prod` / `cardhub-staging`）。生产 `TRPC_URL=https://api.card-hub.app/trpc`，预发 `TRPC_URL=https://api-staging.card-hub.app/trpc`。
- 运行手册：见 [`deploy/README.md`](../../deploy/README.md)，包含服务器 bootstrap、GHCR 登录、DNS、部署、回滚、备份/恢复、日志查看、GitHub Environment 保护规则和单主机 staging/prod key 隔离限制。

API 启动命令仍是 `npx prisma migrate deploy && node dist/main.js`，首次部署空库会自动执行已有 migrations。`CATALOG_SEED_CMD` 默认留空；生产和 staging 首次部署空库后手动运行一次 `docker compose exec -T api node dist/scripts/seed-catalog.js`。staging 测试账号由 ops 手动创建随机密码，不运行 `seed-demo`。

### 7.5.2 镜像发布与部署

- `.github/workflows/images.yml`：CI 在 main push 成功后构建 API + Web 镜像，推送到 GHCR，标签为 `sha-<full sha>` 与 `main`。
- `.github/workflows/deploy.yml`：手动部署 staging / production；自动 staging 仅接受同仓库 main push 的 CI workflow_run。production 和 staging 的部署 SHA 都必须可从 `origin/main` 到达。
- 部署脚本会同步已验证 commit 的 `deploy/` 文件到 `/opt/cardhub/<environment>/deploy`，再运行远端部署。健康校验要求 API `/health.gitSha` 等于目标 SHA，并等待 Web Docker health 为 `healthy` 且 `/healthz` 可访问。部署、健康检查或 seed 失败会尝试回滚到上一个不可变 `sha-` tag 并让 job 失败。
- 备份：`deploy/backup.sh` 由 cron 每日执行（Asia/Shanghai 02:15 staging、02:20 prod），保留 7 份日备份 + 4 份周备份。两条任务追加到同一个 `/opt/cardhub/backups/backup.log`。阿里云 OSS（香港）上传是强制的：`offsite.env` 缺失、不可读，或缺少 `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_BUCKET` / `OSS_ENDPOINT` 任一键，脚本非零退出并留下本地 dump。每次退出写一行 `BACKUP_RESULT=ok|fail`。没有配置 `BACKUP_PING_URL`，巡检对每个 project 跑 `deploy/check-backup-log.sh`（`project=` 整词匹配，staging 成功不能掩盖 prod 失败）。

### 7.5.3 本地验证生产构建

```bash
docker build -f Dockerfile.api -t cardhub-api:test .
docker build -f Dockerfile.web -t cardhub-web:test .
ENV_NAME=prod docker compose -f deploy/docker-compose.yml --env-file deploy/.env.example config
ENV_NAME=prod docker compose -f deploy/edge/docker-compose.yml --env-file deploy/.env.example config
```

## 8. 接手 Agent 工作建议

### 8.1 入口节奏

- **先领任务再动手**：从 [development-backlog.md](development-backlog.md) 领取任务，按任务卡的验收标准和 §1 通用完成标准交付；涉及 PRD 原始故事时再对照 [prd/epics.md](prd/epics.md) 的 AC。
- **每个任务**：跑 `pnpm typecheck && pnpm lint && pnpm test`，能跑端到端就用浏览器走一遍真实页面。
- **一个任务一个分支、一个 PR**，squash 合并到 `main`；合并后 staging 自动部署，生产由 owner 手动发布。

### 8.2 每次改动后必须做

- 改 **共享包源码** → `pnpm --filter ./packages/<name> build`，否则 NestJS 跑的是旧 dist。
- 改 **i18n 字典** → 重启 vite 并清 `apps/cardhub/web/node_modules/.vite` 缓存。
- 改 **Prisma schema** → `prisma migrate dev --name xxx`（**带 --name**，不带会阻塞）。
- 改 **trpc-contract 间接依赖的类型**（即任何 router 输入输出）→ `pnpm --filter @repo/trpc-contract build`，否则 web 端 tsc 拿到旧 .d.ts。
- **根目录 `pnpm build`**：Turbo 已排除 `@cardhub/native`（桌面壳单独构建）；Docker / CI 走 api + web + 小程序包即可。

### 8.3 验证清单

| 类型                  | 命令                                            |
| --------------------- | ----------------------------------------------- |
| typecheck             | `pnpm typecheck`                                |
| lint                  | `pnpm lint`                                     |
| 测试                  | `pnpm test`                                     |
| Web build             | `pnpm --filter @cardhub/web build`              |
| API build             | `pnpm --filter @cardhub/api build`              |
| Miniapp build         | `pnpm --filter @cardhub/miniapp build`          |
| Native build（macOS） | `pnpm --filter @cardhub/native build`           |
| 端到端                | cursor-ide-browser MCP 跑 http://localhost:5173 |

### 8.4 commit 规范

```
<type>(<scope>): <subject>

<body explaining the why>
```

- type：feat / fix / docs / style / refactor / test / chore
- scope：见 §6.10 白名单
- subject ≤ 72 字符
- body 解释 _why_ 而非 _what_

### 8.5 后台启动多端

```bash
# API + Web 一起（推荐）
pnpm dev

# 只起 API（subshell 包装防 SIGHUP）
(cd apps/cardhub/api && pnpm dev </dev/null >/tmp/cardhub-api.log 2>&1 &)

# 只起 Web
(cd apps/cardhub/web && pnpm dev </dev/null >/tmp/cardhub-web.log 2>&1 &)

# 等端口起来
sleep 6 && lsof -i :4000 -t && lsof -i :5173 -t
```

## 9. Backlog

原先记在这里的事项已并入 [development-backlog.md](development-backlog.md)（对照关系见该文 §5）。以下几项暂不排期，记录备查：

- PWA / Service Worker（Tauri 已覆盖离线诉求）。
- Tauri 桌面离线模式（`tauri-plugin-sql` SQLite 缓存）。
- 论坛版块 / 标签系统。
- changesets 自动生成 release notes。
- multi-apps 仓库“如何新增第二个 app”的模板文档。
- 微信 `wx.login` / 开放数据 / 订阅消息（PRD 范围外）。
- API trpc-panel / 类型可视化。

## 10. 已完成 milestone（实施进度）

- [x] **M0**（2026-05-03）：本文档。commit `945838f`。
- [x] **M1**（2026-05-03）：jest+vitest 测试栈、helmet、@nestjs/throttler + express-rate-limit、bcryptjs、Postgres CI service container、Dependabot、pnpm audit、README 测试/CI/部署章节。37 个测试全过。commit pending.
- [x] **M2**（2026-05-03）：LocaleStore localStorage 持久化、MobX autorun 同步 `<html lang>`、双层 ErrorBoundary、skip-to-content、focus-visible、SiteHeader 汉堡菜单、路由 React.lazy 代码分割（首页 chunk 770KB → 299KB）、登录后 redirect 回原页、首页统计卡 i18n、@axe-core/react dev 扫描、bundle visualizer。commit pending.
- [x] **M2.5**（2026-05-03）：Sentry SDK 双端集成（`SENTRY_DSN` 守卫式启用，dev 0 开销）、`SentryExceptionFilter` 全局拦截 5xx + tRPC `onError` 上报 `INTERNAL_SERVER_ERROR`、Web `ErrorBoundary.onError` 接 `Sentry.captureException`；Dockerfile.api 启动跑 `prisma migrate deploy`（prisma CLI 移到 dependencies）；`resolveTrpcUrl()` 五条决策路径（dev/prod/Tauri/Android emulator）；新增 `.env.development/.staging/.production` 三套；CORS_ORIGIN 默认值加入 `tauri://localhost,https://tauri.localhost`；handoff doc 加 §7.5 部署运行手册。commit `a4a935d`.
- [x] **M3**（2026-05-03）：Tauri Desktop 图标全套生成（`src-tauri/icons/` 16 张 + ios/ 18 张 + android/ 25 张），从 `source.png` 占位图通过 `tauri icon` 一键导出；保留可重生成脚本 `generate-source.py`；native README 重写覆盖 macOS/Windows/Linux 各自 toolchain + 命令；M2.5 的 Tauri-aware tRPC URL 已就绪。`cargo check` 通过 Rust 侧编译验证。commit `97aa9d3`.
- [x] **M4**（2026-05-03）：iOS init `tauri ios init --ci` 在本机（Xcode 16.4 + iOS 17 SDK + xcodegen + cocoapods）跑通，但 `gen/apple/` 全保持 gitignore（每次 fresh checkout 用 30s 重生成）；Android init 跳过（本机 ANDROID_HOME / JDK / NDK 全缺失）；trpc.tsx Android emulator detection（`__TAURI_INTERNALS__` + UA Android + DEV → `http://10.0.2.2:4000/trpc`，M2.5 已就位）；index.html 加 `apple-mobile-web-app-capable` / `mobile-web-app-capable` / `apple-mobile-web-app-status-bar-style` / `theme-color` 四条 meta；globals.css 暴露 `--safe-area-{top,right,bottom,left}` CSS vars + `.app-safe-{top,x,bottom}` utility 类；SiteHeader（sticky）和 PageShell（main）应用 safe-area；.gitignore 加 `xcuserdata/` / `.gradle/` / `Pods/` 兜底；写 `apps/cardhub/native/MOBILE_SETUP.md` 详细列 macOS/Linux/Windows 三平台 mobile toolchain 安装步骤、release 流程、常见错误。commit `ea2f598`.
- [x] **M5**（2026-05-03）：Taro miniapp 业务接入。`src/app.tsx` 挂 `StoreProvider` + taroSessionStorageDriver / taroLocaleStorageDriver（`Taro.getStorageSync` 三件套）；`src/lib/trpc.ts` headers 回调读 `rootStore.session.token` 注入 `authorization: Bearer`；`src/app.config.ts` 注册 7 页（首页 / 系列列表 / 系列详情 / 卡牌详情 + 评论 / 搜索 / 登录 / 注册）；每页用 `ScrollView + View + Text + Input + Textarea` 重写 web 端等价视图；`@repo/ui-mini` 扩充 Field / RarityBadge / Empty / Skeleton / Link（封装 `Taro.navigateTo`）/ BreadcrumbsMini 五个组件；`@repo/design-tokens/src/taro.scss` 新增 12 个 `$gradient-<slug>` + 4 种稀有度配色；`src/lib/gradients.ts` 返回 `linear-gradient(...)` 字符串供 inline style；`@repo/shared/src/i18n` 新增 `miniapp.*` 字典；`src/index.html` 模板补上（否则 H5 build 不生成入口 HTML，Taro 源码 `fs.existsSync(template)` 守卫）；`package.json#scripts.lint` 改为 echo 占位，Taro CLI 带着过旧 ESLint 8 不兼容根仓库 flat config。`pnpm --filter @cardhub/miniapp build` 出 `dist/weapp/pages/{auth,cards,index,search,series}/*/index.wxml` 7 页；`pnpm --filter @cardhub/miniapp miniapp:h5` 出 `dist/h5/{index.html,js,css}`。17/17 typecheck、0 lint errors、37/37 test 保持。微信 AppID 注册 + 服务器域名白名单需用户手动完成（详见 miniapp README + §6.16）。commit `ff6b83f`.
- [x] **M6**（2026-05-03）：PRD Phase 2 论坛落地。Prisma schema 加 `User.role` (default `user`) + `Topic` (slug / title / body / pinned / `@@index([createdAt])`) + `Reply` (`@@index([topicId, createdAt])`)；migration `add_user_role_and_forum`；seed upsert `admin` / `alice` 两个测试账号（admin 角色用来跑 `forum.topics.delete` 的"admin 删任意"分支）。新增 `forum` router 8 条 procedure（topics list/bySlug/create/update/delete + replies list/create/delete），cursor pagination key 在 `(createdAt desc, id desc)`、5 min 编辑窗口、admin 检查仅在非 owner 时再 prisma.user.findUnique 一次拿 role。slug 生成走 `@repo/shared` 新增 `slugify(title)` + 6 位 nanoid 后缀，碰 P2002 重试 5 次。`main.ts` 新增 `forumTopicCreateLimiter`（5/h/IP）和 `forumReplyCreateLimiter`（30/h/IP），ipKeyGenerator 共享 `ipKey()` helper。Web 新增 3 页（forum-list useInfiniteQuery / forum-new 带 markdown preview / forum-detail 含回帖区 + 删除按钮 + Markdown 渲染）；新增 `MarkdownView` 组件（react-markdown + remark-gfm + rehype-sanitize 三件套，绝不用 dangerouslySetInnerHTML）；i18n 字典 `forum.*` + `nav.forum/trade` 中英双语；SiteHeader 桌面 + 移动 nav 都加 Forum / Trade。`@repo/shared/zod` 新增 topicCreateInput/topicUpdateInput/replyCreateInput/cursorPaginationInput；`@repo/shared/utils` 新增 slugify/slugifyBase。5 个新 forum.router.spec 测试（cursor 分页 hasMore / anon 拒绝 / 5min 窗口 / admin 删 / 普通用户拒删）。28 个 API 测试 + 6 web 测试全绿。commit pending.
- [x] **M7**（2026-05-03）：PRD Phase 2 交易信息板落地。Prisma schema 加 `Listing`（含 `kind ListingKind`、`price Decimal? @db.Decimal(12,2)`、`currency String @default("CNY")`、`imageUrls String[] @default([])`、`status ListingStatus @default(OPEN)`、`@@index([cardSlug])` + `@@index([status, createdAt])`）+ `Report`（多态指针 `targetType` / `targetId`、`status ReportStatus @default(PENDING)`、`@@index([targetType, targetId])`）+ 4 个 enum；migration `add_listings_and_reports`。`@repo/shared/src/zod` 新增 `LISTING_KIND_VALUES` / `LISTING_STATUS_VALUES` / `REPORT_TARGET_VALUES` / `REPORT_STATUS_VALUES` 常量数组 + 类型；`listingPriceSchema`（接受 number 或 string，clamp 到 0-9_999_999_999.99 并 round 到 2 位小数）；`currencyCodeSchema`（ISO 4217 三字母正则）；`listingPublishInput` / `listingListInput` / `reportCreateInput` / `reportListInput`。新增 `listings` router 5 条 procedure（list 默认仅 OPEN 排序 createdAt desc / byCard 卡牌详情页用 take 5 / mine authed / publish authed 带 cardSlug 存在性校验 + Decimal 转换 / close authed 带 ownership-or-admin 检查；price 在响应里 `Decimal.toFixed(2)` 转 string 避免 tRPC `string | Decimal` 联合）。新增 `reports` router 2 条 procedure（create authed 带每用户 10/day quota 计数 + admin role 重新查 / list authed admin only 带 cursor pagination）。`main.ts` 新增 `listingPublishLimiter` (10/h/IP) 和 `reportCreateLimiter` (20/h/IP) 两条 express-rate-limit，复用 ipKey helper。Web 新增 3 个组件 / 2 页：`/trade` (TradeListPage useInfiniteQuery + kind/cardSlug 筛选 + 强 disclaimer + ReportButton + CloseButton 自助关闭) / `/trade/new` (TradePublishPage 带 type-toggle / decimal price input / multi-line image URLs / strict disclaimer)；`ListingsForCard` 嵌入卡牌详情页的"该卡的交易意向"列表（最多 5 条 + 链到 /trade + 鉴别用户隐藏自家 ReportButton）；`ReportButton` 通用举报按钮（unauth fallback 跳 /login，open 后 textarea 提交，成功显示 thanks）；trade & report i18n 中英双语；SiteHeader 桌面 + 移动 nav 加 `Trade` 链接（M6 已经加过 `nav.trade`）。Test：`listings.router.spec.ts` 8 个 / `reports.router.spec.ts` 5 个，含 publish 缺卡 NOT_FOUND、Decimal 入库格式、close ownership / admin / 已关闭幂等、create 配额 10、admin-only list FORBIDDEN。所有测试 41 个全过；`pnpm typecheck` 17/17；`pnpm lint` 0 errors。commit pending.
- [x] **M7 hardening**（2026-05-04）：补齐举报系统闭环与运行时验收。Auth `register/login/me` 返回 `role`，`SessionStore.isAdmin` 驱动 Web 管理入口；新增 `/reports` 管理员举报队列页，`reports.list` 返回 listing/topic/reply/comment 上下文；`reports.create` 校验 target 是否仍存在，避免无效举报；论坛 topic/reply、卡牌 comment、交易 listing 均挂上举报入口，管理员前端可删除任意 topic/reply、关闭任意 listing。修复登录回跳支持字符串 `state.from` 和 location-like object；修复 `.env.development` 空 `VITE_TRPC_URL` 导致 tRPC 404；首页补 `h2.sr-only` 解决 axe heading order 报错。验证：`pnpm typecheck` 17/17、`pnpm test`（API 38 + Web 22）、`pnpm --filter @cardhub/web build` 通过；Playwright 实测 admin/alice 登录、topic 举报、`/reports` 队列、卡牌详情、交易页均无控制台错误。commit pending.

- [x] **Phase 0 · 部署迁移**（2026-10-16）：从 Zeabur 迁移到阿里云香港 VPS。Docker Compose + 共享 Caddy、GHCR 不可变镜像、staging 自动 / prod 手动部署与自动回滚（#37、#43、#49）；Web 运行时 `/config.js` 注入 `TRPC_URL`，API 限流信任一跳代理（#38、#40）；catalog / demo seed 拆分（#39）；限流集成测试与 tRPC 限流错误格式（#42、#46）；Sentry environment（#45、#47）；tRPC 响应保留 `Vary: Origin`（#48）；OSS 异地备份（#44）。
- [x] **功能梳理**（2026-10-17）：融合仓库内与仓库外历史文档，新增 [README.md](README.md)（文档索引与冲突裁决）、[feature-inventory.md](feature-inventory.md)（功能全景）、[development-backlog.md](development-backlog.md)（接力任务池），本文同步修订。

> M0–M7 与 Phase 0 之后，任务进度统一记录在 development-backlog.md §2，不再往本节追加。
