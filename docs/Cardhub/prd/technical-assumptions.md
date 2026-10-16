# 技术假设 (Technical Assumptions)

> 以下是立项时的技术假设，已过时。实际技术栈为 NestJS + tRPC + Prisma（后端）、MobX + TanStack Query（前端状态），详见 [../handoff-context.md](../handoff-context.md) §2 与 [../README.md](../README.md#历史文档与当前实现的冲突裁决)。

- **代码仓库与架构:**
  - **仓库结构:** 采用 **Monorepo** 结构，使用 **PNPM + Turborepo**进行管理。
  - **服务架构:** MVP 阶段采用**单体服务 (Monolith)** 架构。
- **后端技术栈:**
  - **语言:** **Rust**
  - **数据库:** **PostgreSQL**
  - **缓存:** **Redis**
- **前端技术栈:**
  - **核心框架:** **React**
  - **构建工具:** **Vite**
  - **语言:** **TypeScript**
  - **UI 与样式:** **shadcn/ui** + **TailwindCSS** + **原生 CSS**
  - **状态管理:** **Zustand** (全局状态) + **SWR** (请求状态)
