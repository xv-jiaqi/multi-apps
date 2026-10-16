# @cardhub/miniapp

Taro 4 + React 18 + TypeScript. One source tree compiles to WeChat / Alipay / TikTok / Baidu / QQ mini-programs, plus a plain H5 bundle. Web / Tauri / native Taro all share `@repo/shared`, `@repo/stores`, `@repo/trpc-contract`, `@repo/ui-mini`, and `@repo/design-tokens`.

## Build matrix

| Platform            | Command                                         | Output         |
| ------------------- | ----------------------------------------------- | -------------- |
| WeChat 微信小程序   | `pnpm --filter @cardhub/miniapp miniapp:weapp`  | `dist/weapp/`  |
| Alipay 支付宝小程序 | `pnpm --filter @cardhub/miniapp miniapp:alipay` | `dist/alipay/` |
| TikTok 抖音小程序   | `pnpm --filter @cardhub/miniapp miniapp:tt`     | `dist/tt/`     |
| Baidu 百度小程序    | `pnpm --filter @cardhub/miniapp miniapp:swan`   | `dist/swan/`   |
| QQ 小程序           | `pnpm --filter @cardhub/miniapp miniapp:qq`     | `dist/qq/`     |
| H5                  | `pnpm --filter @cardhub/miniapp miniapp:h5`     | `dist/h5/`     |

`pnpm --filter @cardhub/miniapp build` is a shortcut for the weapp target. All the `dev:*` scripts do the same thing with `--watch`.

## 业务路由

`src/app.config.ts` registers the seven pages wired up in M5:

```
pages/index/index             首页（热门系列 + 统计卡 + 登录状态摘要）
pages/series/list/index       系列列表
pages/series/detail/index     单个系列 + 其卡牌
pages/cards/detail/index      卡牌详情 + 评论区（登录态可发评论）
pages/search/index/index      搜索（本地 250ms debounce）
pages/auth/login/index        登录（identifier + password）
pages/auth/register/index     注册（email + username + password）
```

Navigation goes through `<Link to="/pages/..." />` from `@repo/ui-mini`, which wraps `Taro.navigateTo` / `redirectTo` / `switchTab` / `navigateBack`. Page params are read with `Taro.useRouter().params`.

## 状态与数据层

- **Stores**：`src/stores/root-store.ts` wires `LocaleStore` + `SessionStore` from `@repo/stores` with Taro storage drivers (`Taro.getStorageSync` / `setStorageSync` / `removeStorageSync`). Pages call `useStores()` (MobX context provider in `src/app.tsx`) to read state; `observer()` in `mobx-react-lite` keeps renders fresh.
- **tRPC**：`src/lib/trpc.ts` is a plain `createTRPCClient` (not the React-Query variant) configured with `httpLink` + a Taro.request adapter + an `authorization: Bearer <token>` headers callback that re-reads `rootStore.session.token` on every request. `TRPC_URL` is injected via `defineConstants` in `config/index.ts`, sourced from `process.env.TRPC_URL`; dev/prod switching is described below.
- **Gradients**：`src/lib/gradients.ts` mirrors the web version but returns a raw `linear-gradient(...)` CSS string for inline `style={{ background }}` usage (miniapp runtimes have no Tailwind JIT). The SCSS equivalents live in `packages/design-tokens/src/taro.scss` for future class-based styles.

## 本地预览（微信开发者工具）

1. `pnpm --filter @cardhub/miniapp dev` （watch mode → `dist/weapp/`）
2. Open **WeChat DevTools** → `Import Project`, pick `apps/cardhub/miniapp/` (the IDE reads `project.config.json`, which points `miniprogramRoot` at `dist/weapp/`).
3. `project.config.json` has `appid: touristappid` + `urlCheck: false`, so **tourist mode** is on by default. Toggle `Details → Local Settings → Don't verify legal domains` to hit `http://localhost:4000` without a WeChat Public-Platform whitelist.
4. Keep the API running in another tab: `pnpm dev:api` (or `docker compose` + `pnpm --filter @cardhub/api dev`).

## 多环境 tRPC URL

`config/index.ts` reads `process.env.TRPC_URL` at build time and bakes it into the bundle via `defineConstants.TRPC_URL`. Recommended invocations:

```bash
# Dev against a local API (default fallback).
pnpm --filter @cardhub/miniapp dev

# Point at the production API for a weapp build destined for a real device.
TRPC_URL=https://api.card-hub.app/trpc pnpm --filter @cardhub/miniapp miniapp:weapp

# Cut an H5 build for Cloudflare Pages / any static host.
TRPC_URL=https://api.card-hub.app/trpc pnpm --filter @cardhub/miniapp miniapp:h5
```

`process.env.TARO_APP_ENV` is available if you later want per-env constants; add branches inside `config/index.ts`'s `defineConstants` block.

## ⚠️ 上线前：微信服务器域名白名单（用户手动，agent 无法代办）

The WeChat runtime rejects `wx.request` / `Taro.request` to any URL not pre-registered on the WeChat Public Platform unless the IDE's local dev checkbox is turned off. Required steps to ship:

1. **Register a real WeChat AppID** at [mp.weixin.qq.com](https://mp.weixin.qq.com) (not `touristappid`). An ICP-filed 主体（公司/个体工商户/备案过的个人小程序类目）is required for most categories.
2. **Bind the server URL**：Public Platform → `开发管理` → `开发设置` → `服务器域名` → `request 合法域名`。Add the exact scheme + host (no path), e.g. `https://api.card-hub.app`. HTTPS is mandatory; raw IP / self-signed certs are rejected.
3. If you also use `uploadFile` / `downloadFile` / `socket`, add them in the matching fields.
4. **Update `project.config.json`**：replace `appid: touristappid` with your real AppID. Keep `urlCheck: false` off for prod-like preview; toggle it on when you want the DevTools to enforce the whitelist locally.
5. **Rebuild** against the production URL: `TRPC_URL=https://api.card-hub.app/trpc pnpm --filter @cardhub/miniapp miniapp:weapp`.
6. Submit the `dist/weapp/` bundle via DevTools → `上传` → 在 Public Platform → `版本管理` 走审核。

Real 扫码上线 needs WeChat review (usually 1-3 business days). Agent cannot execute this step.

## 端到端联调网络拓扑

- WeChat DevTools 里的小程序运行在 Chromium WebView，和宿主 macOS 在同一网络，所以 `http://localhost:4000` 直连可用（前提是 `Don't verify legal domains` 勾上）。
- 真机扫码预览时小程序跑在手机上，**你的 API 必须是公网 HTTPS**。用生产 `https://api.card-hub.app/trpc` 或预发 `https://api-staging.card-hub.app/trpc`，或本地跑 [ngrok](https://ngrok.com)/[cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 临时 HTTPS 出口。
- H5 目标和 web 一样，放到 Cloudflare Pages / Netlify / Render Static Site 都行。`dist/h5/index.html` + `dist/h5/css` + `dist/h5/js` 是静态资产。

## 共享包依赖

- `@repo/shared` — zod schemas（`loginInput` / `registerInput` / `commentInput`）、i18n（`t(locale, key)`）、`APP_NAME`、`SUPPORTED_LOCALES`
- `@repo/stores` — `LocaleStore` / `SessionStore` + pluggable storage driver 接口
- `@repo/trpc-contract` — `AppRouter` 类型；miniapp 的 tRPC client 全靠这个推导出 `series.list.query()` 等签名
- `@repo/ui-mini` — `PrimaryButton` / `SectionCard` / `Field` / `RarityBadge` / `Empty` / `Skeleton` / `Link` / `BreadcrumbsMini`
- `@repo/design-tokens/taro.scss` — color / spacing / gradient 变量；任何新卡牌 slug 的封面色都要在这里加一条 `$gradient-<slug>` 并在 `src/lib/gradients.ts` / `apps/cardhub/web/src/lib/gradients.ts` 同步

## 常见踩坑

- 改 `@repo/ui-mini` 或 `@repo/shared` 源码 → 先 `pnpm --filter @repo/<name> build`，否则 miniapp 拉的是旧 `dist/`。
- `pnpm --filter @cardhub/miniapp miniapp:h5` 必须存在 `src/index.html` 模板，否则 Taro 的 `html-webpack-plugin` 不会生成 `dist/h5/index.html`（Taro 源码里是 `fs.existsSync(template)` 的守卫）。本仓库的 `src/index.html` 正是为此准备的。
- 小程序渐变不能用 Tailwind utility；必须走 `gradientFor(slug)` 返回的 `linear-gradient(...)` 字符串 + inline style 或 SCSS 变量。
- 评论等 authed procedure 会走 `authorization: Bearer <token>` header，该 token 来自 `SessionStore`。`signIn()` 后 `Taro.setStorageSync('cardhub:session', ...)` 自动被 driver 持久化，切换页面 / 重启小程序都还在。
