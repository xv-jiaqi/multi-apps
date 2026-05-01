# @cardhub/miniapp

Taro 4 + React + TypeScript. One source tree compiles to:

| Platform            | Command                                         | Output         |
| ------------------- | ----------------------------------------------- | -------------- |
| WeChat 微信小程序   | `pnpm --filter @cardhub/miniapp miniapp:weapp`  | `dist/weapp/`  |
| Alipay 支付宝小程序 | `pnpm --filter @cardhub/miniapp miniapp:alipay` | `dist/alipay/` |
| TikTok 抖音小程序   | `pnpm --filter @cardhub/miniapp miniapp:tt`     | `dist/tt/`     |
| Baidu 百度小程序    | `pnpm --filter @cardhub/miniapp miniapp:swan`   | `dist/swan/`   |
| QQ 小程序           | `pnpm --filter @cardhub/miniapp miniapp:qq`     | `dist/qq/`     |
| H5                  | `pnpm --filter @cardhub/miniapp miniapp:h5`     | `dist/h5/`     |

Open `dist/weapp` in the WeChat DevTools to preview. `project.config.json` uses `appid: touristappid` (tourist mode) so you can preview without a registered AppID.

## Shared with other platforms

- `@repo/shared` — zod schemas, i18n, constants
- `@repo/stores` — MobX stores (session / locale)
- `@repo/trpc-contract` — `AppRouter` type for type-safe API calls
- `@repo/ui-mini` — Taro-specific UI primitives
- `@repo/design-tokens/taro.scss` — shared color / spacing tokens
