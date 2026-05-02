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
- `*` 404

### tRPC AppRouter（[apps/cardhub/api/src/trpc/trpc.service.ts](../../apps/cardhub/api/src/trpc/trpc.service.ts)）

```
health.ping
series.list / series.bySlug
cards.bySlug / cards.search
auth.register / auth.login / auth.me
comments.listForCard (public) / comments.create (authedProcedure)
```

### 数据库

- Schema：[apps/cardhub/api/prisma/schema.prisma](../../apps/cardhub/api/prisma/schema.prisma) — `User / Series / Card / Comment` 4 张表。
- Seed：[apps/cardhub/api/prisma/seed.ts](../../apps/cardhub/api/prisma/seed.ts) — 3 系列 / 9 卡牌。运行 `pnpm --filter @cardhub/api db:seed`。
- 唯一一份 migration：`20260501165944_init`。

### 测试账号

种子数据没有预置用户。本地手动注册一个：

- 用户名：`alice`
- 邮箱：`alice@cardhub.test`
- 密码：`password123`

或直接 curl：

```bash
curl -X POST http://localhost:4000/trpc/auth.register \
  -H "content-type: application/json" \
  -d '{"email":"alice@cardhub.test","username":"alice","password":"password123"}'
```

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
- **微信 `wx.login` / 开放数据**：PRD 外。
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

- [x] **M0**（2026-05-03）：本文档。commit `docs(docs): add Cardhub handoff context for downstream agents`。
- [ ] M1
- [ ] M2
- [ ] M2.5
- [ ] M3
- [ ] M4
- [ ] M5
- [ ] M6
- [ ] M7

> 每完成一个 milestone，请：
>
> 1. 把方框打勾，加日期 + commit hash。
> 2. 在第 4 节"已完成功能"或第 6 节"踩坑清单"补充新发现。
> 3. 如有 backlog 项被启用，从第 9 节移除并写进对应 milestone。
