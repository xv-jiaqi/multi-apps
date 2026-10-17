# Cardhub 功能全景（现状基线）

> 基线：`main` @ `origin/main`（2026-10-17，CH-001/002/003 打磨后）。
>
> 本文只记录**代码里已经存在的能力**和**已核实的缺口**。待做事项与验收标准在 [development-backlog.md](development-backlog.md)，编号形如 `CH-xxx`。业内站点里哪些能力要借、哪些明确不做，见 [industry-benchmark.md](industry-benchmark.md)。完成任务后请同步修改本文对应条目的状态，否则本文会与代码脱节。

图例：✅ 已实现　🟡 部分实现（有接口无界面，或存在已知缺口）　❌ 未实现

---

## 1. 现状概述

Cardhub 定位为“维基式卡牌知识库 + 社区”。PRD 的 MVP（Epic 1–3：系列/卡牌浏览、搜索、账户、卡牌评论）以及 Phase 2 的论坛、交易信息板、举报系统都已在 Web 端落地。生产环境已从 Zeabur 迁移到阿里云香港的一台 VPS，并通过 GitHub Actions 发布。

当前最影响产品完整度的缺口：

1. **内容只能通过 seed 写入**：没有内容管理后台，知识库无法日常维护（CH-107）。
2. **卡牌没有真实图片**：数据里全是 `gradient:` 占位符，前端只渲染渐变色块（CH-105）。
3. **举报处理闭环已完成**：管理员可在队列中标记已处理，或删除 / 关闭被举报内容并处理相关待处理举报。
4. **部分已有接口没有界面**：话题编辑（CH-103）。
5. **小程序只覆盖 MVP**：论坛、交易、举报均未接入（CH-301）。

对标之后新出现、代码里仍然不存在的能力，不在下面各表展开成新模块：平行版本（CH-213）、资讯（CH-214）、发售日历（CH-215）、用户自报价格（CH-313，确认前不做）、赛事与卡组（CH-314，确认前不做）。收藏进度写在 CH-203，交易品相写在 CH-104。

## 2. 运行环境

| 环境 | Web                          | API（tRPC）                             | 发布方式                                                 |
| ---- | ---------------------------- | --------------------------------------- | -------------------------------------------------------- |
| 生产 | https://card-hub.app         | https://api.card-hub.app/trpc           | 手动触发 `deploy.yml`（`production` Environment 需审批） |
| 预发 | https://staging.card-hub.app | https://api-staging.card-hub.app/trpc   | main 上 CI + 镜像构建成功后自动部署                      |
| 本地 | http://localhost:5173        | http://localhost:4000/trpc（Vite 代理） | `pnpm db:up && pnpm db:migrate && pnpm dev`              |

部署拓扑：阿里云香港 Ubuntu 24.04 VPS → 共享 Caddy（自动 HTTPS、反向代理）→ `cardhub-prod` 与 `cardhub-staging` 两个 Docker Compose project（各自包含 api / web / Postgres 16 / Redis 7）。镜像在 GHCR，标签为不可变的 `sha-<完整 commit>`。数据库每日 `pg_dump`，可选上传阿里云 OSS（香港）做异地备份。完整运维手册见 [deploy/README.md](../../deploy/README.md)。

生产与预发只运行 catalog seed（3 个系列 / 9 张演示卡牌，中文），不创建 demo 账号。

## 3. 功能模块

### 3.1 卡牌目录（系列 / 卡牌）

| 能力                     | 状态 | 入口                  | 接口                                | 说明                                                                                                                                                                                                                                      |
| ------------------------ | ---- | --------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 系列列表（封面、卡牌数） | ✅   | `/series`             | `series.list`                       | 接口支持 `page/pageSize`，前端只取第一页（默认 20 条）；无排序、无筛选                                                                                                                                                                    |
| 系列详情 + 卡牌网格      | ✅   | `/series/:seriesSlug` | `series.bySlug`                     | 一次返回全部卡牌；无系列内搜索、排序、分页（CH-202）                                                                                                                                                                                      |
| 卡牌详情（属性、稀有度） | ✅   | `/cards/:cardSlug`    | `cards.bySlug`                      | `attributes` 是扁平 JSON，键名原样显示（`cost`/`attack`…），未本地化（CH-202）                                                                                                                                                            |
| 稀有度                   | ✅   | 各列表与详情          | `Card.rarity`                       | `common / rare / epic / legendary`，标签写在 `rarity-badge.tsx`（Web）和 `@repo/ui-mini`（小程序）                                                                                                                                        |
| 卡牌 / 系列图片          | 🟡   | 全站图位              | `Card.imageUrl` / `Series.coverUrl` | Web / Tauri 已支持 https 真实图片：加载中固定灰底、加载完淡入、坏链或 `gradient:` 回退原渐变；卡牌详情用 63:88 contain，其余卡图按 63:88 cover，系列封面按 2:1 或现有背景容器 cover。现有 seed 仍是 `gradient:...`，小程序同步留给 CH-301 |
| 分类 / 年份 / 类型浏览   | ❌   | —                     | —                                   | PRD §3.2/§3.3、UI 规范“分类列表页”要求（CH-201）。平行版本与限量编号见 CH-213                                                                                                                                                             |
| 内容维护                 | 🟡   | —                     | `seed:catalog`                      | 只能修改 `apps/cardhub/api/src/scripts/seed-data.ts` 后重跑 seed；seed 按 slug upsert 会覆盖同名记录（CH-107）                                                                                                                            |
| 面包屑                   | ✅   | 所有深层页面          | —                                   |                                                                                                                                                                                                                                           |

### 3.2 搜索

| 能力                              | 状态 | 入口      | 接口           | 说明                                                                                                       |
| --------------------------------- | ---- | --------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| 卡牌名模糊搜索（不区分大小写）    | ✅   | `/search` | `cards.search` | Postgres `ILIKE '%q%'`，最多 50 条，前端 250ms 防抖；`@@index([name])` 是 btree，对 `%q%` 无加速（CH-106） |
| Header 常驻搜索框 / 下拉建议      | ❌   | —         | —              | PRD Story 2.5 AC1 与 UI 规范主导航要求“醒目位置的搜索框”，目前只有导航链接（CH-106）                       |
| 搜索系列、描述，按稀有度/系列筛选 | ❌   | —         | —              | CH-106                                                                                                     |

### 3.3 账户与会话

| 能力                         | 状态 | 入口                 | 接口            | 说明                                                                                                                        |
| ---------------------------- | ---- | -------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 注册（邮箱 + 用户名 + 密码） | ✅   | `/register`          | `auth.register` | bcryptjs 10 轮；邮箱或用户名重复返回 `CONFLICT`                                                                             |
| 登录（邮箱或用户名）         | ✅   | `/login`             | `auth.login`    | 邮箱转小写匹配，**用户名区分大小写**；登录后按 `location.state.from` 回跳                                                   |
| 会话恢复                     | ✅   | 全局 `AuthBootstrap` | `auth.me`       | 启动时用本地 token 拉取最新 `role`；返回 `UNAUTHORIZED` 自动登出。`auth.me` 用 **input** 传 token，而不是读请求头（CH-212） |
| 登出                         | ✅   | Header               | —               | 只清本地存储，服务端不吊销 token                                                                                            |
| 角色                         | ✅   | —                    | `User.role`     | `user` / `admin`。admin 目前只能直接改库或由 demo seed 创建                                                                 |
| 个人中心                     | ✅   | `/me`                | `users.me`      | 概览显示资料和本人话题 / 回帖 / 评论 / 交易意向计数；交易意向计数使用包含已关闭的新字段 `listingTotalCount`                 |
| 资料编辑、改密码、找回密码   | ❌   | —                    | —               | CH-212 / CH-310                                                                                                             |

Token：JWT（HS256，`JWT_EXPIRES_IN` 默认 7 天），无 refresh token，Web 存在 `localStorage['cardhub:session']`，小程序存在 `Taro.setStorageSync`。

### 3.4 卡牌评论

| 能力                         | 状态 | 入口       | 接口                   | 说明                                                                                                          |
| ---------------------------- | ---- | ---------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| 查看评论（最新 50 条，倒序） | ✅   | 卡牌详情页 | `comments.listForCard` | 无分页                                                                                                        |
| 发表评论（≤ 500 字）         | ✅   | 卡牌详情页 | `comments.create`      | 需登录；按 IP 限流 30 次 / 小时                                                                               |
| 删除评论（本人 / 管理员）    | ✅   | 卡牌详情页 | `comments.delete`      | Web / Tauri 使用行内二次确认；成功后显示可见状态提示并聚焦提示，失败后焦点回到删除按钮。小程序同步留到 CH-301 |
| 举报评论                     | ✅   | 评论旁     | `reports.create`       | 自己的评论不显示举报按钮                                                                                      |
| 系列页评论                   | ❌   | —          | —                      | PRD FR4 要求“卡牌和系列介绍页面”都能评论（CH-101）                                                            |
| 评论回复                     | ❌   | —          | —                      | 历史架构文档设计了 `parent_comment_id`（CH-204）                                                              |

### 3.5 论坛

| 能力                              | 状态 | 入口           | 接口                   | 说明                                                                                                                                                                |
| --------------------------------- | ---- | -------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 话题列表（cursor 分页、加载更多） | ✅   | `/forum`       | `forum.topics.list`    | 按 `createdAt desc, id desc` 排序；**`pinned` 不参与排序**；摘要直接截取原始 Markdown（CH-103）                                                                     |
| 发布话题（Markdown + 预览）       | ✅   | `/forum/new`   | `forum.topics.create`  | slug = 标题英文化 + 6 位随机后缀（中文标题会退化成 `topic-xxxxxx`）                                                                                                 |
| 话题详情 + Markdown 渲染          | ✅   | `/forum/:slug` | `forum.topics.bySlug`  | `react-markdown` + `remark-gfm` + `rehype-sanitize`，禁止 `dangerouslySetInnerHTML`                                                                                 |
| 编辑话题（发布后 5 分钟内）       | 🟡   | —              | `forum.topics.update`  | 接口和窗口校验都有，**没有界面**（CH-103）                                                                                                                          |
| 删除话题（本人 / 管理员）         | ✅   | 话题详情       | `forum.topics.delete`  | Web / Tauri 使用行内二步确认；成功后返回列表并显示可聚焦的删除提示；级联删除回帖                                                                                   |
| 回帖（Markdown）                  | ✅   | 话题详情       | `forum.replies.create` |                                                                                                                                                                     |
| 回帖翻页                          | ✅   | `/forum/:slug` | `forum.replies.list`   | 详情页先渲染 `bySlug` 内联的前 20 条；有 `replyNextCursor` 时可点击“加载更多回帖”继续按正序追加；首个后续页加载中显示忙态，失败重试中禁用按钮，新回帖可见高亮并聚焦 |
| 删除回帖（本人 / 管理员）         | ✅   | 回帖旁         | `forum.replies.delete` | Web / Tauri 使用行内二步确认；成功后本地更新已展开分页、游标和回帖数，避免分页收回或 refetch 使用已删除游标                                                         |
| 置顶                              | 🟡   | —              | `Topic.pinned`         | 字段存在，没有设置接口和界面（CH-103）                                                                                                                              |
| 版块 / 标签                       | ❌   | —              | —                      | 长期需求，暂未排期                                                                                                                                                  |

### 3.6 交易信息板（仅撮合信息，站外交易）

| 能力                                    | 状态 | 入口                                    | 接口               | 说明                                                                                   |
| --------------------------------------- | ---- | --------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| 意向列表（出/求筛选、按卡牌 slug 筛选） | ✅   | `/trade`                                | `listings.list`    | 只显示 `OPEN`；卡牌显示为 slug 而不是卡名。品相、语言、版本备注和价格筛选也在 CH-104   |
| 发布意向                                | ✅   | `/trade/new`（卡牌页可带 `?cardSlug=`） | `listings.publish` | 需要手填卡牌 slug；价格可空（显示“面议”）；货币 ISO 4217，默认 CNY；最多 4 个外链图片  |
| 卡牌页内意向（最多 5 条）               | ✅   | 卡牌详情页                              | `listings.byCard`  |                                                                                        |
| 关闭意向（本人 / 管理员）               | ✅   | 列表项                                  | `listings.close`   | 幂等                                                                                   |
| 我的意向（含已关闭）                    | ✅   | `/me#me-listings`                       | `listings.mine`    | `/me` 上混合显示 OPEN / CLOSED，可用行内两步确认关闭；卡名待 CH-104 合并后由 slug 切换 |
| 图片展示                                | 🟡   | 列表项                                  | —                  | 只显示为外链文字，不渲染缩略图（CH-104）                                               |
| 免责声明                                | ✅   | 列表页 + 发布页                         | —                  |                                                                                        |
| 联系方式可见性                          | —    | —                                       | —                  | 目前匿名访客也能看到联系方式，是否改为登录可见待用户决策（CH-104）                     |

### 3.7 举报与管理

| 能力                                          | 状态 | 入口                                 | 接口                                                                                                      | 说明                                                                                                                                                                         |
| --------------------------------------------- | ---- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 举报话题 / 回帖 / 评论 / 意向                 | ✅   | 各内容旁“举报”                       | `reports.create`                                                                                          | 校验目标存在；每用户 24 小时最多 10 次                                                                                                                                       |
| 举报队列（待处理 / 已处理筛选，附目标上下文） | ✅   | `/reports`（Header 仅对 admin 显示） | `reports.list`                                                                                            | 每次请求都重新查库校验 admin 身份；目标已删除时 `target` 为 `null`；交易意向目标返回可选 `cardName` 并在 Web 显示卡名与本地化开放/关闭状态；已处理条目显示处理人、时间和说明 |
| 处理举报（标记已处理）                        | ✅   | `/reports`                           | `reports.resolve`                                                                                         | 记录处理人、处理时间和可选说明；重复处理幂等                                                                                                                                 |
| 删除 / 关闭被举报内容并处理                   | ✅   | `/reports`                           | `reports.resolve`                                                                                         | `TOPIC` / `REPLY` / `COMMENT` 删除，`LISTING` 关闭；同一目标其它待处理举报一并处理                                                                                           |
| 管理员删除 / 关闭任意内容                     | 🟡   | 原页面 + `/reports`                  | `comments.delete` / `forum.topics.delete` / `forum.replies.delete` / `listings.close` / `reports.resolve` | 卡牌详情页可用 `comments.delete` 删除评论；`/reports` 可删除被举报评论并处理举报                                                                                             |
| 封禁用户、用户管理、操作审计                  | ❌   | —                                    | —                                                                                                         | CH-209                                                                                                                                                                       |

### 3.8 国际化

| 能力                      | 状态 | 说明                                                                                               |
| ------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| 界面双语（zh-CN / en-US） | ✅   | 字典在 `packages/shared/src/i18n/index.ts`；Header 切换，`localStorage` 持久化，同步 `<html lang>` |
| 内容多语言                | ❌   | Series / Card 只有单语字段（CH-312）                                                               |
| API 错误信息              | 🟡   | 后端 `TRPCError.message` 硬编码中文，英文界面也显示中文（CH-211）                                  |

### 3.9 体验与无障碍

| 能力                                       | 状态 | 说明                                                                                                            |
| ------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------- |
| 响应式布局 + 移动端汉堡菜单                | ✅   |                                                                                                                 |
| skip-to-content、focus-visible、aria 标注  | ✅   | 开发模式下 `@axe-core/react` 自动扫描                                                                           |
| 路由懒加载 + 双层 ErrorBoundary            | ✅   |                                                                                                                 |
| 加载 / 错误 / 空状态、骨架屏               | ✅   |                                                                                                                 |
| 刘海屏 safe-area + 页面横向留白            | ✅   | `.app-safe-top / .app-safe-x / .app-safe-bottom`；`.app-safe-x` 同时保证页面最小横向留白（< sm 16px，sm+ 24px） |
| 页面级 `<title>` / description             | 🟡   | 页面 `<title>` 已按 `{页面名} · Cardhub` 设置；description 留给 CH-207                                          |
| 首页精选分类、最新系列横滑、页脚、入场动效 | ❌   | UI 规范与历史 AI 前端指令要求（CH-205）                                                                         |
| 收藏、分享                                 | ❌   | CH-203（含集齐进度）                                                                                            |
| 深色模式                                   | ❌   | CH-305                                                                                                          |

### 3.10 平台与运维

| 能力                                                              | 状态 | 说明                                                                                                                                    |
| ----------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`（db / redis / gitSha / buildTime，DB 异常返回 503） | ✅   | 部署脚本用 `gitSha` 校验上线版本；另有 `health.ping`                                                                                    |
| 写接口限流（express-rate-limit，按 IP）                           | ✅   | 内存存储，单实例足够；多实例需要 Redis store（CH-210）。`trust proxy` 只信任 1 跳（Caddy）                                              |
| helmet（API，CSP 关闭）+ CORS 白名单                              | ✅   | `CORS_ORIGIN` 逗号分隔。代码默认值包含 Tauri 来源，但 `deploy/.env.example` 的生产值只有 `https://card-hub.app`，会覆盖默认值（CH-303） |
| Sentry（API）                                                     | ✅   | 配置 `SENTRY_DSN` 才启用；只上报 5xx / `INTERNAL_SERVER_ERROR`                                                                          |
| Sentry（Web）                                                     | ✅   | Web 容器启动时从 `WEB_SENTRY_DSN` / `SENTRY_ENVIRONMENT` / `GIT_SHA` 生成运行时 `/config.js`；空 DSN 时不上报                           |
| 生产配置启动校验                                                  | ✅   | `NODE_ENV=production` 时启动前校验 `JWT_SECRET`（≥ 32 字符且不是占位值）与 `DATABASE_URL`；开发 / 测试保留现有默认值                    |
| Redis                                                             | 🟡   | 只用于健康检查 ping，未用于缓存（CH-210）                                                                                               |
| CI（lint / typecheck / build / test / audit / compose 校验）      | ✅   | `.github/workflows/ci.yml`                                                                                                              |
| 镜像构建、staging 自动部署、prod 手动部署、健康校验、失败自动回滚 | ✅   | `images.yml` / `deploy.yml` / `deploy/remote-deploy.sh`                                                                                 |
| 数据库备份（7 日 + 4 周，可选 OSS 异地）                          | ✅   | OSS 生命周期规则仍待 owner 配置（见 deploy/README.md 的 TODO）                                                                          |
| Web 安全响应头（CSP、nosniff、Referrer-Policy）                   | ❌   | nginx 只设置了缓存头（CH-309）                                                                                                          |
| 结构化日志 / request id                                           | ❌   | CH-307                                                                                                                                  |
| 产品指标（MAU、注册、留存、日评论数）                             | ❌   | 项目简报定义了 KPI，但没有任何埋点（CH-308）                                                                                            |

## 4. 多端覆盖矩阵

Desktop / iOS / Android 加载的是同一份 Web 产物，所以功能与 Web 一致；差异只在发布状态。小程序是用 Taro 重写的 UI，功能需要逐页补齐。

| 功能            | Web        | Desktop（Tauri）                      | iOS / Android（Tauri）                                               | 小程序 / H5（Taro）            |
| --------------- | ---------- | ------------------------------------- | -------------------------------------------------------------------- | ------------------------------ |
| 系列 / 卡牌浏览 | ✅         | ✅                                    | ✅                                                                   | ✅                             |
| 搜索            | ✅         | ✅                                    | ✅                                                                   | ✅                             |
| 登录 / 注册     | ✅         | ✅                                    | ✅                                                                   | ✅                             |
| 卡牌评论        | ✅         | ✅                                    | ✅                                                                   | 🟡 无举报入口                  |
| 论坛            | ✅         | ✅                                    | ✅                                                                   | ❌（CH-301）                   |
| 交易信息板      | ✅         | ✅                                    | ✅                                                                   | ❌（CH-301）                   |
| 举报 / 举报队列 | ✅         | ✅                                    | ✅                                                                   | ❌（CH-301）                   |
| 发布状态        | 生产已上线 | `release-native.yml` 手动出包，未签名 | iOS 需本机 `ios:init` 生成工程；Android 未初始化；均未上架（CH-304） | 未申请 AppID、未上线（CH-302） |

## 5. tRPC 接口清单

所有业务接口都挂在 `/trpc`，定义在 `apps/cardhub/api/src/modules/*/*.router.ts`，汇总在 `apps/cardhub/api/src/trpc/trpc.service.ts`。客户端通过 `@repo/trpc-contract` 获取 `AppRouter` 类型。

| Procedure              | 类型     | 权限                    | 输入                                                                      | 输出要点                                                                                      |
| ---------------------- | -------- | ----------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `health.ping`          | query    | 公开                    | —                                                                         | `status / timestamp / message / gitSha / buildTime`                                           |
| `series.list`          | query    | 公开                    | `{ page?=1, pageSize?=20(≤100) }`                                         | `{ items[{…, cardCount}], page, pageSize, total }`                                            |
| `series.bySlug`        | query    | 公开                    | `{ slug }`                                                                | 系列 + `cards[{ id, slug, name, rarity, imageUrl }]`                                          |
| `cards.bySlug`         | query    | 公开                    | `{ slug }`                                                                | 卡牌 + 扁平 `attributes` + `seriesSlug / seriesTitle`                                         |
| `cards.search`         | query    | 公开                    | `{ q(1–80), limit=20(≤50) }`                                              | `{ query, results[] }`                                                                        |
| `auth.register`        | mutation | 公开（限流）            | `{ email, username, password }`                                           | `{ token, user{ id, email, username, role } }`                                                |
| `auth.login`           | mutation | 公开（限流）            | `{ identifier, password }`                                                | 同上                                                                                          |
| `auth.me`              | query    | 公开（token 走 input）  | `{ token }`                                                               | `user`                                                                                        |
| `comments.listForCard` | query    | 公开                    | `{ cardSlug, limit=50(≤100) }`                                            | `[{ id, content, createdAt, user }]`                                                          |
| `comments.create`      | mutation | 登录（限流）            | `{ cardSlug, content }`                                                   | 新评论                                                                                        |
| `comments.delete`      | mutation | 作者或 admin            | `{ id }`                                                                  | `{ ok }`                                                                                      |
| `forum.topics.list`    | query    | 公开                    | `{ cursor?, limit=20(≤50) }`                                              | `{ items[TopicSummary], nextCursor }`                                                         |
| `forum.topics.bySlug`  | query    | 公开                    | `{ slug }`                                                                | `TopicSummary + replies(前 20) + replyNextCursor`                                             |
| `forum.topics.create`  | mutation | 登录（限流）            | `{ title, body }`                                                         | `TopicSummary`                                                                                |
| `forum.topics.update`  | mutation | 作者，发布后 5 分钟内   | `{ id, title, body }`                                                     | `TopicSummary`                                                                                |
| `forum.topics.delete`  | mutation | 作者或 admin            | `{ id }`                                                                  | `{ ok }`                                                                                      |
| `forum.replies.list`   | query    | 公开                    | `{ topicId, cursor?, limit }`                                             | `{ items, nextCursor }`（正序）                                                               |
| `forum.replies.create` | mutation | 登录（限流）            | `{ topicId, body }`                                                       | 新回帖                                                                                        |
| `forum.replies.delete` | mutation | 作者或 admin            | `{ id }`                                                                  | `{ ok }`                                                                                      |
| `listings.list`        | query    | 公开                    | `{ cursor?, limit, cardSlug?, kind? }`                                    | `{ items[Listing], nextCursor }`，仅 `OPEN`                                                   |
| `listings.byCard`      | query    | 公开                    | `{ cardSlug, limit=5(≤20) }`                                              | `Listing[]`，仅 `OPEN`                                                                        |
| `listings.mine`        | query    | 登录                    | `{ cursor?, limit }`                                                      | 含 `CLOSED`                                                                                   |
| `listings.publish`     | mutation | 登录（限流）            | `{ cardSlug, kind, price?, currency='CNY', imageUrls≤4, contact, note? }` | `Listing`（`price` 为两位小数字符串）                                                         |
| `listings.close`       | mutation | 作者或 admin            | `{ id }`                                                                  | `{ ok }`                                                                                      |
| `reports.create`       | mutation | 登录（限流 + 每日配额） | `{ targetType, targetId, reason }`                                        | `{ id, createdAt }`                                                                           |
| `reports.list`         | query    | admin                   | `{ cursor?, limit, status? }`                                             | `items[]` 含 `target` 上下文（目标已删除时为 `null`）、`resolvedAt`、`resolver`、`resolution` |
| `reports.resolve`      | mutation | admin                   | `{ id, action, resolution? }`                                             | `MARK_RESOLVED` 或 `REMOVE_TARGET`；删除 / 关闭目标时同步处理同目标待处理举报                 |
| `users.me`             | query    | 登录                    | —                                                                         | 资料 + `listingCount`（开放）/ `listingTotalCount`（含已关闭）/ 话题 / 回帖 / 评论计数        |
| `users.myTopics`       | query    | 登录                    | `{ pageCursor?, limit }`                                                  | 本人话题 cursor 分页；每条含 `slug / title / replyCount / createdAt`                          |
| `users.myComments`     | query    | 登录                    | `{ pageCursor?, limit }`                                                  | 本人评论 cursor 分页；每条含卡牌 slug、名称与 `imageUrl`                                      |

另有 NestJS REST 端点 `GET /health`（不经过 tRPC，跳过全局 Throttler）。

## 6. 数据模型

Schema：[apps/cardhub/api/prisma/schema.prisma](../../apps/cardhub/api/prisma/schema.prisma)。主键全部是 `String @default(uuid())`。

```mermaid
erDiagram
  User ||--o{ Comment : writes
  User ||--o{ Topic : posts
  User ||--o{ Reply : posts
  User ||--o{ Listing : publishes
  User ||--o{ Report : files
  Series ||--o{ Card : contains
  Card ||--o{ Comment : has
  Topic ||--o{ Reply : has

  User {
    string id PK
    string email UK
    string username UK
    string password
    string role
  }
  Series {
    string id PK
    string slug UK
    string title
    string description
    string coverUrl
  }
  Card {
    string id PK
    string slug UK
    string name
    string description
    string imageUrl
    string rarity
    json attributes
    string seriesId FK
  }
  Comment {
    string id PK
    string content
    string userId FK
    string cardId FK
  }
  Topic {
    string id PK
    string slug UK
    string title
    string body
    bool pinned
    string userId FK
  }
  Reply {
    string id PK
    string topicId FK
    string userId FK
    string body
  }
  Listing {
    string id PK
    string userId FK
    string cardSlug
    enum kind
    decimal price
    string currency
    string_array imageUrls
    string contact
    string note
    enum status
  }
  Report {
    string id PK
    string reporterId FK
    enum targetType
    string targetId
    string reason
    enum status
    datetime resolvedAt
    string resolvedById FK
    string resolution
  }
```

需要知道的建模约定：

- `User.role` 是自由字符串（`user` / `admin`），新增角色不需要迁移。
- `Listing.cardSlug` 是**软指针**，不是外键：目录重建或改名时不会连带删除用户发布的意向。
- `Report.targetType + targetId` 是多态指针，没有外键；目标被删后举报记录保留用于审计。已处理记录通过可空的 `resolvedAt`、`resolvedById` 和 `resolution` 保存处理信息；处理人被删除时保留举报记录并把处理人置空。
- 所有关联用户的外键都是 `onDelete: Cascade`。
- 迁移顺序：`20260501165944_init` → `20260502184922_add_user_role_and_forum` → `20260502185947_add_listings_and_reports` → `20261016185000_add_report_resolution`。

## 7. 页面清单

### 7.1 Web（同时供 Desktop / iOS / Android 使用）

| 路由                  | 页面文件                  | 访问控制                     |
| --------------------- | ------------------------- | ---------------------------- |
| `/`                   | `pages/home.tsx`          | 公开                         |
| `/series`             | `pages/series-list.tsx`   | 公开                         |
| `/series/:seriesSlug` | `pages/series-detail.tsx` | 公开                         |
| `/cards/:cardSlug`    | `pages/card-detail.tsx`   | 公开（评论、发布意向需登录） |
| `/search`             | `pages/search.tsx`        | 公开                         |
| `/login` `/register`  | `pages/login.tsx` 等      | 公开                         |
| `/forum`              | `pages/forum-list.tsx`    | 公开                         |
| `/forum/new`          | `pages/forum-new.tsx`     | 登录，未登录跳转 `/login`    |
| `/forum/:slug`        | `pages/forum-detail.tsx`  | 公开（回帖需登录）           |
| `/trade`              | `pages/trade-list.tsx`    | 公开                         |
| `/trade/new`          | `pages/trade-publish.tsx` | 登录，未登录显示登录提示     |
| `/reports`            | `pages/reports-list.tsx`  | admin                        |
| `/me`                 | `pages/me.tsx`            | 登录，未登录跳转 `/login`    |
| `*`                   | `pages/not-found.tsx`     | 公开                         |

页面文件都在 `apps/cardhub/web/src/` 下。除首页外均通过 `React.lazy` 懒加载。

### 7.2 小程序 / H5

注册在 `apps/cardhub/miniapp/src/app.config.ts`：首页、系列列表、系列详情、卡牌详情（含评论）、搜索、登录、注册，共 7 页。没有 tabBar。

## 8. 校验规则与限额

输入校验的唯一来源是 [packages/shared/src/zod/index.ts](../../packages/shared/src/zod/index.ts)，前端提交前用同一份 schema 做 `safeParse`。

| 字段                | 规则                                          |
| ------------------- | --------------------------------------------- |
| slug                | kebab-case，1–64 字符                         |
| 用户名              | 3–24 字符，`[A-Za-z0-9_-]`                    |
| 密码                | 8–128 字符                                    |
| 邮箱                | 合法邮箱，存储前 trim + 转小写                |
| 卡牌评论            | 1–500 字                                      |
| 话题标题 / 正文     | 1–120 字 / 1–10000 字                         |
| 回帖                | 1–5000 字                                     |
| 举报原因            | 4–500 字                                      |
| 交易联系方式 / 备注 | 2–200 字 / ≤ 500 字                           |
| 交易图片            | ≤ 4 个 URL                                    |
| 交易价格            | 0–9,999,999,999.99，四舍五入到 2 位小数；可空 |
| 货币                | `^[A-Z]{3}$`（ISO 4217）                      |
| cursor 分页 `limit` | 1–50，默认 20                                 |

限流（`apps/cardhub/api/src/bootstrap/rate-limiters.ts`，按 IP，超限返回 tRPC `TOO_MANY_REQUESTS`）：

| 名称               | 匹配的 procedure              | 窗口   | 上限 |
| ------------------ | ----------------------------- | ------ | ---- |
| `authMutation`     | `auth.register`、`auth.login` | 1 分钟 | 10   |
| `commentCreate`    | `comments.create`             | 1 小时 | 30   |
| `forumTopicCreate` | `forum.topics.create`         | 1 小时 | 5    |
| `forumReplyCreate` | `forum.replies.create`        | 1 小时 | 30   |
| `listingPublish`   | `listings.publish`            | 1 小时 | 10   |
| `reportCreate`     | `reports.create`              | 1 小时 | 20   |

另外：`reports.create` 在 procedure 内按用户限制 24 小时 10 次；NestJS 全局 Throttler（60 次/分钟/IP）只作用于 REST controller，`/health` 已豁免。

## 9. 已知缺陷与技术债

按对用户的影响排序，括号内是对应任务。

1. `Topic.pinned` 字段无效；`forum.topics.update` 有接口无界面（CH-103）。
2. 现有 seed 仍只有渐变占位图；真实图片需要 CH-107/CH-208 后填入 https URL，小程序渲染同步留给 CH-301。
3. 搜索索引对 `ILIKE '%q%'` 无效，数据量上来后会全表扫描（CH-106）。
4. API 错误信息只有中文（CH-211）。
5. 按 `deploy/.env.example` 配置的生产 `CORS_ORIGIN` 只包含 `https://card-hub.app`，Tauri 桌面 / 移动端（`tauri://localhost`、`https://tauri.localhost`、`http://tauri.localhost`）请求生产 API 会被 CORS 拦截；桌面端发布前必须处理（CH-303）。
6. `series` 路由没有单测；API e2e 只有占位文件；小程序与原生壳没有测试（CH-306）。

## 10. 测试基线

- API（Jest）：`apps/cardhub/api/src/**/*.spec.ts`，覆盖 auth、cards、comments、forum、listings、reports、health、限流代理、seed 脚本。覆盖率门槛：全局语句 60%、分支 50%；`auth/*` 语句 80%。
- Web（Vitest + RTL）：评论区组件、登录回跳、渐变映射、运行时配置脚本。
- CI 用 Postgres 16 service container 执行 `prisma migrate deploy` 后跑全量测试。
- 缺口：`series` 路由、小程序、原生壳、端到端流程（CH-306）。
