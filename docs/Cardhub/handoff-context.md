# Cardhub Monorepo · 接手 Agent 速读

> 这份文档专为接手本仓库的 AI Agent 准备。粒度是"开机即跑"——读完不需要再问"用什么栈/为什么这么配/为什么 miniapp 锁 React 18"。

最后更新：2026-05-03（M0 完成）。每个后续 milestone 完成后，请同步更新本文 §10 "已完成 milestone" 小节。

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

PRD 写"后端 Rust + Axum + SQLx"和"前端 Zustand + SWR"。实际选型已和用户确认改为：

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
├── docker/             docker-compose.yml + Dockerfile.api（多阶段）
├── docs/Cardhub/       PRD + 本文档（必读：prd/epics.md, ui&ux-specification.md）
└── .github/workflows/  ci + 占位的 release 流水线
```

## 4. 已完成功能（PRD Epic 1-3 全部落地）

完整 commit 历史：

```
2554c29 feat(api): user auth + comments for Cardhub PRD Epic 3
16662ed feat(api): wire Cardhub PRD Epic 2 — series & cards via tRPC
fd39b7b feat(web): static browse experience for Cardhub PRD Epic 1 stories 1.4 / 1.5
8fc9da4 chore: bootstrap multi-apps monorepo with Cardhub skeletons
```

### Web 端路由（[apps/cardhub/web/src/pages/](../../apps/cardhub/web/src/pages/)）

- `/` 首页（hero + 热门系列 + 统计卡）
- `/series` 系列列表
- `/series/:slug` 系列详情（封面 + 卡牌列表）
- `/cards/:slug` 卡牌详情（图片占位 + 属性 + 评论区）
- `/search` 全局搜索（debounce 250ms）
- `/login` `/register` 认证
- `/forum` 论坛话题列表（cursor 分页 / infinite scroll）（M6）
- `/forum/new` 发布新话题（authed，5 min 编辑窗口）（M6）
- `/forum/:slug` 话题详情（Markdown 正文 + 回帖）（M6）
- `*` 404

### tRPC AppRouter（[apps/cardhub/api/src/trpc/trpc.service.ts](../../apps/cardhub/api/src/trpc/trpc.service.ts)）

```
health.ping
series.list / series.bySlug
cards.bySlug / cards.search
auth.register / auth.login / auth.me
comments.listForCard (public) / comments.create (authedProcedure)
forum.topics.list / forum.topics.bySlug                       (public, M6)
forum.topics.create / forum.topics.update / forum.topics.delete (authed, M6)
forum.replies.list                                            (public, M6)
forum.replies.create / forum.replies.delete                   (authed, M6)
```

### 数据库

- Schema：[apps/cardhub/api/prisma/schema.prisma](../../apps/cardhub/api/prisma/schema.prisma) — `User / Series / Card / Comment / Topic / Reply` 6 张表（M6 起）。
- Seed：[apps/cardhub/api/prisma/seed.ts](../../apps/cardhub/api/prisma/seed.ts) — 2 用户（alice / admin）/ 3 系列 / 9 卡牌。运行 `pnpm --filter @cardhub/api db:seed`。
- Migrations：`20260501165944_init` → `20260502184922_add_user_role_and_forum`（M6）。

### 测试账号

M6 起 seed 预置了两个账号（`pnpm --filter @cardhub/api db:seed` 自动 upsert）：

| username | email              | password    | role  | 用途                                                   |
| -------- | ------------------ | ----------- | ----- | ------------------------------------------------------ |
| `alice`  | alice@cardhub.test | password123 | user  | 普通用户，发帖 / 评论 / 发布交易意向                   |
| `admin`  | admin@cardhub.test | admin123!   | admin | 论坛删任意 topic / reply、查看 `reports.list` 举报队列 |

> ⚠️ 这两个是 demo 凭据，**永远不要复用到生产**。生产环境 seed 时务必先注释掉或换密码。

## 5. 开发命令速查

| 用途                | 命令                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| 一次起 web + api    | `pnpm dev`                                                                |
| 仅 api              | `pnpm dev:api`                                                            |
| 仅 web              | `pnpm dev:web`                                                            |
| Tauri 桌面          | `pnpm dev:native`                                                         |
| 小程序              | `pnpm dev:miniapp`                                                        |
| 共享包 watcher      | `pnpm dev:packages`                                                       |
| 起 Postgres + Redis | `pnpm db:up` / `pnpm db:down`                                             |
| 应用迁移            | `pnpm db:migrate`（**注意交互式，CI/script 用 `prisma migrate deploy`**） |
| 灌种子数据          | `pnpm --filter @cardhub/api db:seed`                                      |
| 全仓 typecheck      | `pnpm typecheck`                                                          |
| 全仓 lint           | `pnpm lint`                                                               |

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

tRPC 的 `createContext` 由 [apps/cardhub/api/src/trpc/context.ts](../../apps/cardhub/api/src/trpc/context.ts) 的 `makeCreateContext(authService)` 在 main.ts 启动时构造。新增需要 ctx 的依赖时，从 Nest 容器拿出来传给 factory，**不要**在 router 里直接 import 单例。

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

## 6.13 Sentry 守卫式初始化（M2.5）

API 端 [main.ts](../../apps/cardhub/api/src/main.ts) 与 Web 端 [main.tsx](../../apps/cardhub/web/src/main.tsx) 都用 `if (DSN)` 守卫包住 `Sentry.init()`，**dev 留空 DSN 时不上报、不增加任何运行时开销**。当 `SENTRY_DSN` / `VITE_SENTRY_DSN` 设置后：

- API：`SentryExceptionFilter` 全局拦截 5xx；tRPC `onError` 仅上报 `INTERNAL_SERVER_ERROR`（避免 `BAD_REQUEST` / `UNAUTHORIZED` 噪音）。
- Web：`ErrorBoundary` 的 `onError` 调 `Sentry.captureException`。

不要把 DSN 写进 `.env.example`；走 Render env group / Cloudflare Pages env。

## 6.15 Safe-area 不要 padding 整个 body（M4）

iOS Tauri / iOS Safari 的"刘海屏"通过 `env(safe-area-inset-*)` 暴露内边距。**不要**在 `<body>` 上加 `padding-top`，因为 `SiteHeader` 是 `position: sticky; top: 0`——一旦 body 有 padding，sticky 会贴到 padding 后的位置，刘海上方留出一条颜色条带，体验丑。

正确做法（已落地在 [globals.css](../../apps/cardhub/web/src/styles/globals.css)）：CSS vars `--safe-area-{top,right,bottom,left}` + utility 类 `.app-safe-top` / `.app-safe-x` / `.app-safe-bottom`。

- SiteHeader（sticky）→ `.app-safe-top`：背景延伸到刘海，内容下沉。
- PageShell `<main>` → `.app-safe-x .app-safe-bottom`：横屏 iPhone 的左右切角 + 底部 home indicator。
- 桌面 / Android（无刘海）→ `env(...)` fallback `0px`，零成本 no-op。

## 6.16 Taro 小程序集成踩坑（M5）

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

## 6.14 Tauri-aware tRPC URL（M2.5 + M4）

[apps/cardhub/web/src/lib/trpc.tsx](../../apps/cardhub/web/src/lib/trpc.tsx) 的 `resolveTrpcUrl()` 五条决策路径：

1. Vite 浏览器 dev → `/trpc`（vite proxy 转发）。
2. Vite 浏览器 prod → `VITE_TRPC_URL` 注入。
3. Tauri Desktop（检测 `__TAURI_INTERNALS__`）→ `VITE_TRPC_URL_TAURI`。
4. Tauri **Android 模拟器** + dev → `http://10.0.2.2:4000/trpc`（**M4 关键**：Android emulator loopback 不是 `localhost`）。
5. Tauri iOS Simulator → 模拟器和 host 同网络，走第 3 条用 `localhost:4000`。

新增 `.env.development` / `.env.staging` / `.env.production` 三套；构建时按 `vite build --mode <mode>` 选用。

**注意**：Vite 会把 `.env.development` 里的 `VITE_TRPC_URL=` 注入为空字符串，不是
`undefined`。`resolveTrpcUrl()` 必须先 `trim()` 并把空字符串归一成 `undefined`，否则
`httpBatchLink` 会把 `auth.login` 这类请求发到 `http://localhost:5173/auth.login?batch=1`
而不是 `/trpc/auth.login?batch=1`，登录 / 注册会直接 404。

## 7. 路线图（剩余 milestone）

完整计划在 [.cursor/plans/cardhub-roadmap-execution_9360876c.plan.md](../../.cursor/plans/cardhub-roadmap-execution_9360876c.plan.md)（plan v2，已合入审视反馈）。摘要：

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
| **M2.5**  | Render/Fly/Railway 部署、Sentry 前后端、Postgres/Redis 托管、Dockerfile 启动跑 migrate deploy、VITE_TRPC_URL 多环境策略、部署运行手册                                                                                                    |
| **M3**    | `cargo tauri icon` 生成图标、Tauri 感知 trpc URL（`__TAURI_INTERNALS__`）、CORS 校验、本地 dmg 构建、native README                                                                                                                       |
| **M4**    | `tauri ios init` / `android init`、Android emulator 用 `10.0.2.2`、iOS Simulator 用 localhost、真机用 staging URL、`viewport-fit=cover` + `safe-area-inset`                                                                              |
| **M5**    | 微信白名单 + HTTPS（前置）、app.tsx 挂 store + Taro storage driver、注册 7 个页面、ui-mini 扩组件（Field/Empty/Skeleton/Link）、SCSS 渐变变量                                                                                            |
| **M6**    | Prisma 加 `User.role` + Topic + Reply、5min 编辑窗口、admin 删任意、Markdown body（react-markdown + rehype-sanitize）、cursor 分页                                                                                                       |
| **M7**    | Prisma Listing（含 currency / imageUrls）+ Report 表、举报系统、`/trade` + 卡牌页内列表、强 disclaimer                                                                                                                                   |

完整工作量预估：14-21 天单人节奏（M3-M5 与 M6-M7 并行可压到 9-12 天）。

## 7.5 部署运行手册（M2.5 落地）

### 7.5.1 一次性配置（Render，强烈推荐）

1. **创建 Postgres 16**：Render Dashboard → New + → PostgreSQL（免费档 500MB）。记下 `Internal Database URL`。
2. **创建 Redis（Upstash）**：[Upstash console](https://console.upstash.com) → Create Database（免费档 10k cmd/day）。拿到 `Endpoint` / `Port` / `Password`。
3. **创建 Web Service**：Render → New + → Web Service：
   - Repository：连接到本仓库（先 push 到 GitHub）。
   - Runtime：**Docker**。
   - Dockerfile Path：`docker/Dockerfile.api`。
   - Build Context：仓库根（`./`）。
   - Branch：`main`。
4. **Environment Group**（一次性挂上去）：
   ```
   NODE_ENV=production
   PORT=4000
   DATABASE_URL=<Render Postgres Internal URL>
   REDIS_HOST=<Upstash endpoint>
   REDIS_PORT=<Upstash port>
   REDIS_PASSWORD=<Upstash password>
   JWT_SECRET=<openssl rand -hex 32>
   JWT_EXPIRES_IN=7d
   CORS_ORIGIN=https://card-hub.app,https://staging.card-hub.app,tauri://localhost,https://tauri.localhost
   GIT_SHA=<deployed git sha>
   BUILD_TIME=<ISO-8601 build timestamp>
   SENTRY_DSN=<sentry.io project DSN>
   SENTRY_TRACES_SAMPLE_RATE=0.1
   ```
5. **Health check**：Render Health Check Path 设为 `/health`。响应包含 `gitSha` / `buildTime`；DB 不可达时 HTTP 503，部署流水线可校验 `gitSha` 等于当前发布 SHA。
6. **触发首次部署**：Render 自动跑 Docker build → 启动时 `npx prisma migrate deploy && node dist/main.js`。**首次部署一定带空 DB**，migration 会自动创建表。

### 7.5.1b Zeabur（Docker + 自定义域，例如 card-hub.app）

与 Render **二选一**即可（数据库仍可自建 Postgres / Upstash Redis）。

**API**

1. Zeabur Project → New Service → **Docker**，连接本仓库、`main` 分支。
2. Dockerfile 选仓库根 **`Dockerfile.api`**（或与 [`Dockerfile.api`](../../Dockerfile.api) 注释一致的平台变量，例如 `ZBPACK_DOCKERFILE_NAME=api`——以 Zeabur 当前文档为准）。
3. **运行时变量**对齐 §7.5.1：`DATABASE_URL`、`REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`、`JWT_SECRET`、`JWT_EXPIRES_IN`、`GIT_SHA`、`BUILD_TIME`、`CORS_ORIGIN`（生产 API：`https://card-hub.app`；预发 API：`https://staging.card-hub.app`；如实际启用 `www` 再追加 `https://www.card-hub.app`）、可选 `SENTRY_*`。`SENTRY_DSN` 配置后 release 使用 `GIT_SHA`。
4. 镜像 **构建阶段**已执行 `db:generate` + `turbo build`；`pnpm deploy` 产物目录内会再执行一次 `prisma generate`，避免运行时缺少 `.prisma/client`。**启动阶段**仍为 `prisma migrate deploy && node dist/main.js`。

**Web**

1. 再建 Docker Service，使用仓库根 **`Dockerfile.web`**（或平台等价：`ZBPACK_DOCKERFILE_NAME=web`）。
2. **运行时变量**注入 `TRPC_URL`（完整 URL，必须带 `/trpc` 后缀）：生产 `TRPC_URL=https://api.card-hub.app/trpc`，预发 `TRPC_URL=https://api-staging.card-hub.app/trpc`。容器 entrypoint 会在 nginx 启动前生成 `/config.js`；缺失或不匹配 `^https?://[^[:space:]"\\]+/trpc$` 时直接 `exit 1`，避免部署成功但请求全打到无代理的同源 `/trpc`。旧的 `BUILDTIME_VITE_TRPC_URL` 仅保留为非 Docker 静态托管 fallback，不要在统一 Docker 镜像中设置。
3. 在 Zeabur / DNS 将生产 Web 绑定到 `card-hub.app`，预发 Web 绑定到 `staging.card-hub.app`；API 分别绑定 `api.card-hub.app` / `api-staging.card-hub.app`。

**Web runtime config 手动检查**：

```bash
tmpdir=$(mktemp -d)
CARDHUB_CONFIG_FILE="$tmpdir/config.js" TRPC_URL=https://api-staging.card-hub.app/trpc \
  sh apps/cardhub/web/docker-entrypoint.d/10-cardhub-runtime-config.sh
cat "$tmpdir/config.js"
CARDHUB_CONFIG_FILE="$tmpdir/bad.js" TRPC_URL=https://api-staging.card-hub.app \
  sh apps/cardhub/web/docker-entrypoint.d/10-cardhub-runtime-config.sh # must exit 1
```

**安全**：仓库根 [`.dockerignore`](../../.dockerignore) 排除 `**/.env`，避免本地密钥被打进镜像；密钥只在平台「运行时变量」填写。

### 7.5.2 部署 Web 前端

任选其一：

- **Cloudflare Pages**（推荐，全球 CDN）：
  ```bash
  pnpm --filter @cardhub/web build  # 默认 production mode
  # 把 apps/cardhub/web/dist 推到 Pages（cf wrangler 或 GitHub Action）
  ```
  Pages 项目设置：Build command `pnpm --filter @cardhub/web build`、Output directory `apps/cardhub/web/dist`。静态托管没有容器 entrypoint 时，可用 `VITE_TRPC_URL=https://api.card-hub.app/trpc` 作为构建时 fallback；Docker 部署不要设置它。
- **Render Static Site**：New + → Static Site，Build cmd 同上，Publish Dir `apps/cardhub/web/dist`，Env 同上。
- **Zeabur Docker**：见 §7.5.1b，`Dockerfile.web` + 运行时变量 `TRPC_URL`。

### 7.5.3 回滚 / 查日志

- **回滚**：Render → Service → Deploys → 在历史版本上点 `Rollback`。Prisma migration 不会自动回滚，DB schema 改动要走 `prisma migrate resolve` 手动操作。
- **查日志**：Render → Service → Logs（实时 tail）；Sentry → Issues 看异常聚合。
- **进容器**：Render → Service → Shell（付费档才有）。免费档用 `render psql <db-id>` 接 DB。

### 7.5.4 本地验证生产构建

不需要真部署也能跑一遍生产链路：

```bash
docker build -f docker/Dockerfile.api -t cardhub-api:test .
docker run --rm -p 4000:4000 \
  -e DATABASE_URL=postgresql://cardhub:cardhub@host.docker.internal:5432/cardhub \
  -e JWT_SECRET=test-only \
  -e CORS_ORIGIN=http://localhost:5173 \
  cardhub-api:test
```

### 7.5.5 ⚠️ 用户必须手动完成的步骤

代码侧 ready，下列步骤需要账号 / 凭证才能上线，AI agent **不能代办**：

1. 注册 [Render](https://render.com) 账号 → 关联 GitHub repo。
2. 注册 [Upstash](https://upstash.com) 账号 → 创建 Redis db。
3. 注册 [Sentry](https://sentry.io) 账号 → 创建 `cardhub-api` + `cardhub-web` 两个 project，把 DSN 填进 Render env 和 Pages env。
4. 注册 [Cloudflare](https://cloudflare.com) 账号（如选 Pages） → 连接 GitHub。
5. 域名：生产 Web/API 分别使用 `card-hub.app` / `api.card-hub.app`，预发 Web/API 分别使用 `staging.card-hub.app` / `api-staging.card-hub.app`。在服务商侧绑定域名后按其指引配置 DNS。
6. 推送代码到 GitHub remote：`git push origin main`。
7. 若走 **Zeabur**：注册控制台账号 → 创建 Project → 按 §7.5.1b 创建 API/Web 两个 Docker Service → 在域名服务商完成 DNS（或使用 Zeabur 购买的域名解析）。

## 8. 接手 Agent 工作建议

### 8.1 入口节奏

- **先读 PRD 再动手**：每个 Story 在 [prd/epics.md](prd/epics.md) 都有明确 ACs，按 AC 验收。
- **每个阶段任务**：跑 `pnpm typecheck && pnpm lint`，能跑端到端就用 cursor-ide-browser MCP 走一遍真实页面，再 `git commit`。
- **不要做太碎的中间提交**：plan v2 的 milestone 划分粒度合理，一个 milestone 一个 commit。

### 8.2 每次改动后必须做

- 改 **共享包源码** → `pnpm --filter ./packages/<name> build`，否则 NestJS 跑的是旧 dist。
- 改 **i18n 字典** → 重启 vite 并清 `apps/cardhub/web/node_modules/.vite` 缓存。
- 改 **Prisma schema** → `prisma migrate dev --name xxx`（**带 --name**，不带会阻塞）。
- 改 **trpc-contract 间接依赖的类型**（即任何 router 输入输出）→ `pnpm --filter @repo/trpc-contract build`，否则 web 端 tsc 拿到旧 .d.ts。
- **根目录 `pnpm build`**：Turbo 已排除 `@cardhub/native`（桌面壳单独构建）；Zeabur / Docker / CI 走 api + web + 小程序包即可。

### 8.3 验证清单

| 类型                  | 命令                                            |
| --------------------- | ----------------------------------------------- |
| typecheck             | `pnpm typecheck`                                |
| lint                  | `pnpm lint`                                     |
| 测试                  | `pnpm test`（M1 后才有意义）                    |
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

## 9. Backlog（不进 milestone，但记下别忘）

- **PWA / Service Worker**：Tauri 已覆盖离线，优先级低。
- **Playwright E2E**：M1 的 vitest+RTL+supertest 已覆盖核心路径，MVP 够。
- **changesets 自动 release notes**：版本/changelog 管理。
- **multi-apps 仓库的"如何新增第二个 app"模板文档**。
- **微信 AppID 注册 + 服务器域名白名单上线审核流程**（M5 代码侧就绪，账号 + 备案 + 审核需用户手动；详见 miniapp README + §6.16）。
- **微信 `wx.login` / 开放数据 / 订阅消息**：PRD 外。
- **API trpc-panel / 类型可视化**。
- **第三种 i18n 语言**（当前自写 `t()` 够 MVP；超过 3 种考虑 i18next）。
- **Tauri 自动更新**（`tauri-plugin-updater`）。
- **Tauri 桌面离线模式**（`tauri-plugin-sql` SQLite 缓存）。
- **真机 TestFlight / Google Play 上架流程**。
- **自建图片上传管线**（M7 暂用外链 URL）。
- **论坛版块 / 标签系统**。
- **站内消息 / 通知**。
- **评论 @mention**。

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

> 每完成一个 milestone，请：
>
> 1. 把方框打勾，加日期 + commit hash。
> 2. 在第 4 节"已完成功能"或第 6 节"踩坑清单"补充新发现。
> 3. 如有 backlog 项被启用，从第 9 节移除并写进对应 milestone。
