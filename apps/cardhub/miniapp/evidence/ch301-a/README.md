# CH-301 A 截图证据（Taro H5，375 宽）

- 构建：`TRPC_URL=http://127.0.0.1:4999/trpc pnpm --filter @cardhub/miniapp miniapp:h5`，静态服务 `dist/h5`。
- 拍摄：Playwright Chromium，视口 375×812，DPR 2，中文 `*-zh-375.png`、英文 `*-en-375.png`。语言写入 `cardhub:locale`。
- 数据：拦截 `/trpc/*` 返回固定数据。成功、空、失败（500，响应里带一段假的数据库报错原文，用来确认页面不显示原文）、`NOT_FOUND`、加载中（请求不返回）。
- 图片：`https://img.cardhub.test/*` 返回条纹 PNG；`broken` 返回 404（回退渐变）；`http://` 与 `gradient:` 不发请求，直接渐变。
- `report.json`：每张图的请求列表、正文文字、对比度取样（文字色对最近的不透明底色）、最大横向宽度、关键点击区高度。
- 以下在 H5 上是模拟实现，要在微信开发者工具或真机补拍：tabBar 原生栏、导航栏标题与返回、页面栈上限、Toast、`Image` 的 `aspectFit` / `aspectFill` 与 https 加载。
