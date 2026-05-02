# multi-apps

个人多端应用 monorepo。首个业务应用 **Cardhub** 同时覆盖 **Web / Desktop / iOS / Android / 小程序** 五端。架构与命名预留了未来叠加更多独立应用的空间。

## 多端矩阵

| 端                                     | 实现                           | UI 来源                     |
| -------------------------------------- | ------------------------------ | --------------------------- |
| Web                                    | Vite + React 19                | `@repo/ui-web`（shadcn/ui） |
| Desktop（Win/mac/Linux）               | Tauri v2 WebView 加载 Web 产物 | 同 Web                      |
| iOS                                    | Tauri v2（iOS 目标）           | 同 Web                      |
| Android                                | Tauri v2（Android 目标）       | 同 Web                      |
| 小程序（微信/支付宝/抖音/百度/QQ）+ H5 | Taro 4 + React                 | `@repo/ui-mini`             |

> **"一次编写"的真相**：Web + Desktop + iOS + Android 是同一份 React 代码；小程序的业务逻辑、tRPC 调用、MobX store、zod schema、i18n 与其他端共享，但 UI 必须用 Taro 组件重写一层（小程序不支持 DOM/shadcn）。

## 技术栈（全部使用最新稳定版）

- **前端**：React 19 · TypeScript 6 · Vite 8 · TailwindCSS 4 · shadcn/ui · MobX 6 · SWR 2 · React Router 7 · tRPC v11 client
- **桌面/移动**：Tauri v2 · Rust stable
- **小程序/H5**：Taro 4 · React · Sass
- **后端**：NestJS 11 · tRPC v11（Express 中间件）· Prisma 6 · PostgreSQL 16 · Redis 7 · JWT
- **工具链**：Turborepo 2 · PNPM 10 · ESLint 10 · Prettier 3 · Husky 9 · lint-staged 16 · commitlint 20 · GitHub Actions · Docker

## 目录结构

```text
multi-apps/
├── apps/
│   └── cardhub/
│       ├── web/          # Vite + React Web 端
│       ├── native/       # Tauri v2：Desktop + iOS + Android 同一个项目
│       ├── miniapp/      # Taro 4：微信/支付宝/抖音/百度/QQ 小程序 + H5
│       └── api/          # NestJS + tRPC + Prisma 后端
├── packages/
│   ├── ui-web/           # shadcn/ui 组件（Web/Native 复用）
│   ├── ui-mini/          # Taro 组件封装（小程序复用）
│   ├── design-tokens/    # 五端共享设计令牌（Tailwind preset + Taro scss）
│   ├── trpc-contract/    # AppRouter 类型桥
│   ├── shared/           # 跨端业务常量 / zod / i18n / 工具
│   ├── stores/           # MobX store（跨端复用）
│   ├── config-ts/        # TS 配置预设（base/react/node/nest/taro）
│   ├── config-eslint/    # ESLint flat config 预设
│   └── config-prettier/  # Prettier 预设
├── docker/               # docker-compose + API Dockerfile
├── docs/                 # PRD / UI 规范等业务文档
└── .github/workflows/    # CI + 多端发布流水线
```

## 环境准备

| 工具                 | 版本       | 用途                   |
| -------------------- | ---------- | ---------------------- |
| Node.js              | ≥ 22 LTS   | 全栈                   |
| pnpm                 | ≥ 10       | 包管理                 |
| Docker Desktop       | 任意较新版 | 本地 Postgres + Redis  |
| Rust (rustup stable) | ≥ 1.77     | Tauri Desktop / Mobile |
| Xcode                | 最新       | iOS（仅 macOS）        |
| Android Studio + NDK | 最新       | Android                |
| 微信开发者工具       | 最新       | 微信小程序预览         |

## 快速开始

```bash
# 1. 安装依赖（首次 3~5 分钟）
pnpm install

# 2. 启动 Postgres + Redis
pnpm db:up

# 3. 生成 Prisma 客户端 + 执行迁移
pnpm db:generate
pnpm db:migrate

# 4. 日常开发：API + Web 并行
pnpm dev
```

> `pnpm dev` 只启动 **Web + API** 两个最常用的进程。Tauri Native 和 Taro 小程序请用下面的独立命令开启——同时跑它们会和 `pnpm dev` 抢 5173 端口。

## 常用命令

### 启动开发

| 目标                               | 命令                                                      |
| ---------------------------------- | --------------------------------------------------------- |
| Web + API（日常联调）              | `pnpm dev`                                                |
| 仅 Web                             | `pnpm dev:web`                                            |
| 仅后端 API（NestJS）               | `pnpm dev:api`                                            |
| Desktop / iOS / Android（Tauri）   | `pnpm dev:native`                                         |
| 微信小程序（`taro --watch weapp`） | `pnpm dev:miniapp`                                        |
| H5                                 | `pnpm dev:miniapp:h5`                                     |
| 支付宝小程序                       | `pnpm dev:miniapp:alipay`                                 |
| 共享包增量 watcher（可选）         | `pnpm dev:packages`                                       |
| 初始化 Android / iOS 工程          | `pnpm --filter @cardhub/native android:init` · `ios:init` |

> 修改了 `packages/*` 的源码后，如果不想手动 `pnpm build`，另开一个终端跑 `pnpm dev:packages`，让 tsc 增量编译到 `dist/`。

### 构建与发布

| 目标                          | 命令                                           |
| ----------------------------- | ---------------------------------------------- |
| 构建微信小程序                | `pnpm --filter @cardhub/miniapp miniapp:weapp` |
| 构建 H5 版本                  | `pnpm --filter @cardhub/miniapp miniapp:h5`    |
| 构建 Desktop bundle           | `pnpm --filter @cardhub/native build`          |
| Prisma Studio                 | `pnpm db:studio`                               |
| 全仓 Lint / Typecheck / Build | `pnpm lint` / `pnpm typecheck` / `pnpm build`  |

### 版本与 React 版本说明

- `@cardhub/web` / `@cardhub/native` 使用 **React 19**。
- `@cardhub/miniapp` 锁在 **React 18**——Taro 4.2 尚不兼容 React 19 的 `exports` 字段与新 reconciler。
- `@types/react` / `@types/react-dom` 通过 [pnpm-workspace.yaml](pnpm-workspace.yaml) 的 `overrides` 统一到 19，避免 miniapp 与 web 之间出现 `ReactNode` 类型冲突。

## 测试

| 目标             | 命令                                  |
| ---------------- | ------------------------------------- |
| 全仓测试         | `pnpm test`                           |
| 仅 API（jest）   | `pnpm --filter @cardhub/api test`     |
| API 含覆盖率     | `pnpm --filter @cardhub/api test:cov` |
| 仅 Web（vitest） | `pnpm --filter @cardhub/web test`     |
| Web 含覆盖率     | `pnpm --filter @cardhub/web test:cov` |

- API 单元测试位于 `apps/cardhub/api/src/**/*.spec.ts`，集成测试位于 `apps/cardhub/api/test/**/*.e2e-spec.ts`。
- Web 测试位于 `apps/cardhub/web/src/**/*.{test,spec}.{ts,tsx}`，setup 在 `apps/cardhub/web/test/setup.ts`。
- 覆盖率门槛：全局 60% / `auth/*` 80%，CI 不达标会失败。
- 运行 e2e 时记得用独立的测试库：

  ```bash
  DATABASE_URL="postgresql://cardhub:cardhub@localhost:5432/cardhub_test?schema=public" \
  pnpm --filter @cardhub/api prisma migrate reset --force --skip-seed
  ```

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) 在每次 push / PR 跑：

1. `pnpm install --frozen-lockfile`
2. Prisma generate + `prisma migrate deploy`（用 service container 起的 Postgres 16）
3. `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm test`
4. 并行：`pnpm audit --prod --audit-level high`

[`.github/dependabot.yml`](.github/dependabot.yml) 每周一开 minor/patch 升级 PR（npm 与 GitHub Actions 各一组）。

## 部署

Cardhub MVP 推荐 Render（API + Postgres）+ Upstash（Redis）+ Sentry（错误监控）的组合（具体在 M2.5 落地）。

- API 镜像：[`docker/Dockerfile.api`](docker/Dockerfile.api) 是多阶段构建，启动时跑 `prisma migrate deploy && node dist/main.js`。
- Web：`pnpm --filter @cardhub/web build` 输出 `apps/cardhub/web/dist/`，可托管到任何静态站（Vercel / Cloudflare Pages / Render Static）。
- 多端 tRPC URL：通过 `VITE_TRPC_URL` 在 dev / staging / prod 切换；Tauri / Android emulator 各自的特殊路由见 [`docs/Cardhub/handoff-context.md`](docs/Cardhub/handoff-context.md)。

## tRPC 端到端类型安全

1. 后端在 `apps/cardhub/api/src/trpc/trpc.service.ts` 定义 `appRouter`，其类型导出为 `AppRouter`。
2. `apps/cardhub/api/src/trpc/app-router.ts` 仅做类型转发。
3. `packages/trpc-contract` 通过 `import type` 引用上面的文件，给所有客户端一个稳定的"仅类型"导入点。
4. Web / Native 使用 `@trpc/react-query` + `httpBatchLink`；Miniapp 使用 `@trpc/client` + `httpLink` + `Taro.request` 适配的 `fetch`。

修改后端 procedure 后，所有五端立刻获得新的类型推导。

## 如何新增一个应用（例如 `foobar`）

1. 新建 `apps/foobar/` 目录，按需创建 `web/native/miniapp/api` 子目录。
2. 每个子项目的 `package.json` 使用 `@foobar/<name>` 命名，并按需引用共享包 `@repo/*`。
3. 若与 Cardhub 共享域模型，考虑把 Prisma schema 提升到 `packages/db`。
4. 在 `turbo.json` 的 `tasks` 中无需改动——glob 会自动覆盖；CI 也会自动纳入。

## 与 Cardhub 业务文档的关系

项目本身的业务 PRD、史诗、UI 规范在 [`docs/Cardhub/`](docs/Cardhub/)。本 monorepo 的代码设计对齐 `docs/Cardhub/prd/epics.md` 中的 Epic 1 基础设施故事（1.1 / 1.2 / 1.3），但出于技术栈统一性覆盖了"后端 Rust"的原始假设——改为 NestJS + tRPC + Prisma。

## 许可

Private. All rights reserved.
