# Cardhub 文档索引

接手 Cardhub 开发的 Agent 从这里开始。本目录的文档分两类：**工程文档**描述代码现状与待办，随代码更新；**产品文档**记录最初的产品意图，内容已冻结，部分技术描述已过时。

## 阅读顺序

| 顺序 | 文档                                                                                                                   | 用途                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1    | 本文                                                                                                                   | 了解文档分工、信息源优先级、历史文档与代码的冲突如何裁决 |
| 2    | [handoff-context.md](handoff-context.md)                                                                               | 技术栈、目录结构、开发命令、踩坑清单（动手前必读）       |
| 3    | [feature-inventory.md](feature-inventory.md)                                                                           | 功能全景：已实现什么、缺什么、接口与数据模型             |
| 4    | [industry-benchmark.md](industry-benchmark.md)                                                                         | 业内对标：哪些能力要借，哪些明确不做，以及合规边界       |
| 5    | [development-backlog.md](development-backlog.md)                                                                       | 接力任务池：领取任务、验收标准、完成标准                 |
| 6    | [../../deploy/README.md](../../deploy/README.md)                                                                       | 生产 / 预发部署、回滚、备份（涉及部署时再读）            |
| 参考 | [prd.md](prd.md)、[prd/](prd/)、[project-brief.md](project-brief.md)、[ui&ux-specification.md](ui&ux-specification.md) | 产品目标、用户故事验收标准、设计原则                     |

## 信息源优先级

出现矛盾时按以下顺序取信，排在前面的为准：

1. **`main` 分支上的代码**（含 Prisma schema、zod schema、部署配置）。
2. 本目录的工程文档：handoff-context.md、feature-inventory.md、development-backlog.md。industry-benchmark.md 只解释规划取舍，不描述代码现状；它和 backlog 不一致时，以 backlog 里已经写明的验收标准为准。
3. [deploy/README.md](../../deploy/README.md)。
4. 本目录的产品文档：PRD、项目简报、UI/UX 规范。
5. 仓库外的历史设计稿 `/Users/xujiaqi/workspace/Cardhub/docs`（只存在于 owner 本机，云端 Agent 无法访问）。其中与仓库重复的 PRD、简报、UI 规范内容一致；仓库没有收录的 `fullstack-architecture.md`、`ai-frontend-development-prompts.md` 里仍有价值的设计意图，已经整理进 development-backlog.md 的 P2 任务，不需要再去翻原文件。

## 历史文档与当前实现的冲突裁决

以下冲突一律以当前仓库为准。接力开发时**不要**按左列的历史说法实现。

| 主题         | 历史文档的说法                                                                     | 当前仓库（以此为准）                                                                                                                                                 | 后续处理                                                                                 |
| ------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 后端技术栈   | Rust + Axum + SQLx，REST `/api/v1`                                                 | NestJS 11 + tRPC v11（Express 中间件）+ Prisma 6                                                                                                                     | 新接口一律写成 tRPC procedure，不引入 REST 业务接口                                      |
| 前端状态管理 | Zustand + SWR                                                                      | MobX 6 + TanStack Query 5（经 `@trpc/react-query`）                                                                                                                  | —                                                                                        |
| 仓库结构     | `apps/server`、`apps/web`、`packages/ui`、`packages/types` 等                      | `apps/cardhub/{api,web,native,miniapp}` + `packages/*`                                                                                                               | —                                                                                        |
| 部署平台     | 阿里云 OSS + DCDN、SAE / ACK、RDS、云 Redis、Terraform；之后曾用 Zeabur / Render   | 阿里云香港单台 Ubuntu VPS + Docker Compose + Caddy，镜像在 GHCR，GitHub Actions 发布；OSS 只用于异地备份                                                             | 不引入 Terraform / SAE；图片上传可用 OSS（CH-208）                                       |
| MVP 范围     | 论坛、交易、小程序、原生 App 不在 MVP 范围                                         | 论坛、交易信息板、举报已上线；Tauri 桌面 / 移动壳与 Taro 小程序工程已就绪                                                                                            | —                                                                                        |
| 评论范围     | PRD FR4：卡牌页和系列页都能评论                                                    | 只有卡牌页能评论                                                                                                                                                     | 补齐（CH-101）                                                                           |
| 评论结构     | 多态 `commentable_type/id` + `parent_comment_id` 评论树                            | `Comment` 可空 `cardId` / `seriesId`，单层 `parentId`（删父级级联删回复）。小程序只显示顶层                                                                          | 已落地（CH-101、CH-204）                                                                 |
| 内容数据模型 | `categories` 表、`i18n_texts` 长表、多态 `media` 表、`release_date`、`card_number` | Series / Card 为单语言字段，图片是 URL 字段，无分类、发售日期、编号                                                                                                  | 品类、子集、发售日期与卡号（CH-201），平行版本（CH-213）；内容多语言待用户决策（CH-312） |
| 认证         | JWT + Refresh Token                                                                | 只有 access token（默认 7 天）。`User.tokenVersion` + JWT `ver` 可吊销；顶栏退出仍只清本地                                                                           | 改密码 / 退出所有设备的页面仍是 CH-212；不做 refresh token                               |
| 健康检查     | `/health` 返回 `{"status":"ok"}`                                                   | 额外返回 uptime、db / redis 状态、gitSha、buildTime；数据库异常时 503。响应带 Server-Timing（`app`、`db`、`cache` 的耗时）。允许的 Origin 会带回 Timing-Allow-Origin | —                                                                                        |
| 富文本       | 卡牌详情“后台富文本编辑器生成的自由内容”                                           | 论坛使用 Markdown + rehype-sanitize                                                                                                                                  | 卡牌长描述同样用 Markdown（CH-206）                                                      |
| 品牌主色     | 深紫 `#6D28D9`                                                                     | `packages/design-tokens` 为蓝色系（`#2563eb` 一族）                                                                                                                  | 是否改色需用户决策（backlog D2）                                                         |
| 测试工具     | Jest、RTL、Testcontainers、Playwright                                              | API 用 Jest，Web 用 Vitest + RTL；CI verify 用 Postgres；Playwright 用户流程冒烟是独立 job `e2e-smoke`                                                               | 小程序与原生壳仍无测试                                                                   |
| 开发路线图   | handoff 曾引用 `.cursor/plans/cardhub-roadmap-execution_*.plan.md`                 | 该文件不在仓库中；其中 M0–M7 已全部完成                                                                                                                              | 由 development-backlog.md 取代                                                           |

## 文档维护约定

- 代码行为变化时，同一个 PR 内更新 feature-inventory.md 的对应条目。
- 领取 / 完成任务时更新 development-backlog.md §2 的状态列。
- 新发现的环境坑、框架限制写进 handoff-context.md §6。
- 产品文档（PRD、简报、UI 规范）保持原样，只在顶部加指向本文的说明；产品意图有变化时，由 owner 决定是否修订。
