v1.3（2026-10-30）：只更新代码行号引用（me.tsx:120-153、me-skeleton.tsx:1-20），要求不变。v1.2 备份 rv142/CH-203-v1.2.bak.md
v1.2（2026-10-30）：按周扒皮定的 byCard / list state / 卡图 去掉降级。v1.1 备份 rv142/CH-203-v1.1.bak.md
v1.1（2026-10-30）：按 #186 实际 API（head 221cf0c）对齐：接口改为 collection.upsert / list / progress；/me 由「两块分开分页」改为单列表 +「全部 / 我有 / 想要」筛选（list 无状态过滤参数）；进度字段 owned / total，排序前端做；错误码按实际 zod 与 NOT_FOUND / 429 补全；详情页初始状态缺读接口，列入待定。v1 备份 rv142/CH-203-v1.bak.md
v1（2026-10-30）：定稿。JQ-Boss 10-29 21:48 批准 cut-3（「全部默认，按照你的建议」）。正文同 v0.2；API 合入后若字段名不同，再升 v1.1。v0.2 备份 rv142/CH-203-v0.2.bak.md
v0.2（2026-10-29）：草稿。按 JQ-Boss 裁定定待定 1–4：不加 +/-；「我有」「想要」按下态加 ✓（WCAG 1.4.1）；系列进度按完成度降序；集齐显示「已集齐」。cut-3 v1.0 定稿后升 v1。v0.1 备份 rv142/CH-203-v0.1.bak.md
v0.1（2026-10-29）：草稿。cut-3 仍是 v0.2 待批，批准后定稿 v1
> 版本：v1.3 · 作者：颜如玉 · 基线：main 1c70336 · 依据：cut-3 In 5 / AC3-7/8/9 / Out；backlog CH-203 · 适用：web、Tauri

# CH-203 收藏：我有 / 想要 / 分享，与「我的收藏」

接口以 PR #186（221cf0c）为准：`collection.upsert`（写）、`collection.list`（我的收藏，一个混合列表）、`collection.progress`（系列进度），均需登录。另有只新增的补充 PR（下称「byCard/state/卡图 PR」）：`collection.byCard({ cardSlug })` 返回 `{ ownedCount, wanted } | null`；`collection.list` 加 `state`（all / owned / wanted）；list 每项加卡图字段。字段名以 byCard/state/卡图 PR 为准，合入后核对。
上线顺序：/me（§3）现在就能做；详情页收藏条（§1、§2、§4、§5）等 byCard/state/卡图 PR 合入后再开工。模型 `CollectionItem { ownedCount 0–99, wanted }`；ownedCount=0 且 wanted=false 时后端删行。平行版本开关不做（cut-3 Out），进度分母 = 系列全部卡牌。

## §1 卡牌详情：收藏条
位置：`card-detail.tsx` 右栏，标题块（h1 + 系列链接）之后、「属性」Card 之前。一个 `<section aria-labelledby="collection-title">`，标题 `h2.sr-only`「我的收藏」。
控件顺序（DOM 与焦点顺序相同）：
1. 「我有」切换：`Button variant="outline" size="default"`，`aria-pressed`。按下态 `bg-brand-600 text-white`（同 default 变体），且文字前加 ✓ 图标（`aria-hidden="true"`），按下态不只靠颜色区分（WCAG 1.4.1）；文字本身不变。
2. 数量输入：仅「我有」按下时出现，紧跟其后；见 §2。
3. 「想要」切换：同 1，`aria-pressed`，按下态同样加 ✓。
4. 「分享」：`Button variant="ghost"`，见 §4。
- **1440（md 及以上）**：一行 `flex flex-wrap items-center gap-3`；「分享」用 `ms-auto` 靠右。
- **375**：两行。第一行「我有」+ 数量；第二行「想要」+「分享」，用 `grid grid-cols-2 gap-3`，按钮 `w-full`。容器 `min-w-0`，不出现横向滚动。
- 写入：`collection.upsert({ cardSlug, ownedCount, wanted })`，每次都传两个字段的完整当前值。返回 `{ outcome: "saved", item }` 时用 item 校正本地状态；`{ outcome: "removed" }` 时两个切换都回到未按下。
- 初始状态：由 `collection.byCard({ cardSlug })` 提供。返回 null = 两个切换都未按下、不显示数量；返回对象时 ownedCount>0 则「我有」按下并显示数量，wanted 决定「想要」。
- byCard 加载中：两个切换 `disabled`、未按下，各叠一块骨架，写法同 `me-skeleton.tsx:1-20`（`animate-pulse motion-reduce:animate-none`、`bg-neutral-200`、`rounded`，尺寸同按钮 `h-10`）。「分享」可用。
- byCard 失败：两个切换 `disabled`；条下方 `ErrorBox`「收藏状态加载失败」+ `RetryButton`「重试」，由 ErrorBox 播报（读屏可听到）；重试只重请求 byCard。「分享」可用。
- 切换为乐观更新；失败回滚到原状态并在条下方显示错误（§6）。
- 「我有」从未按到按下：数量设为 1。再次点按：数量设为 0；若此时「想要」也未按，整行删除（后端规则）。

## §2 数量输入
- `Input`（ui-web）`type="text" inputMode="numeric"`，`w-16 text-center`，`h-10`。
- 可见 label：在输入框左侧显示「数量」，`<label for>` 关联，`text-sm text-neutral-600`。
- 只接受 0–99 的整数。失焦或回车时提交；非法值不提交，原值保留，在条下方显示字段错误，`aria-invalid="true"` + `aria-describedby` 指向错误。
- 文案：前端本地校验失败用码 `collection_quantity`，新增 `error.field.collection_quantity`：zh「数量只能是 0 到 99 的整数」；en「Enter a whole number from 0 to 99.」。
- 后端 `collectionOwnedCountSchema`（int、min 0、max 99）不带自定义码，越界时返回 zod 通用码 too_small / too_big / invalid_type。前端收到这三个码且 path 为 `ownedCount` 时，同样显示 `collection_quantity` 的文案（CH-114 §5 映射表加这一行）。
- 输入 0 并提交 = 取消「我有」（同 §1 末条）。
- 不加 +/- 步进按钮（JQ-Boss 裁定）。

## §3 /me「我的收藏」
- 在 `me.tsx` 现有分区之后新增 `section id="me-collection"`，沿用分区 Card 和 h2 写法（`me.tsx:120-153`）。
- 内容两块，顺序：系列进度、收藏列表。
- **系列进度**（`collection.progress`，返回 `items: { seriesSlug, seriesTitle, owned, total }[]`，不分页）：后端按系列名排，前端重排为 owned/total 从高到低，相同按 seriesTitle（当前语言 `localeCompare`）。只列出用户有记录的系列；只有「想要」的系列显示「已有 0 / 共 N」。每行：seriesTitle（链接 `/series/:seriesSlug`，`text-brand-600 hover:underline wrap-anywhere`）+ 右侧「已有 {owned} / 共 {total}」（`text-sm text-neutral-600 tabular-nums`）。进度条 `h-2 rounded-full bg-neutral-200`，填充 `bg-brand-600`，`role="progressbar"` + `aria-valuenow={owned}` `aria-valuemin=0` `aria-valuemax={total}` + `aria-label`=系列名。owned 按卡计（后端已保证）。owned = total 且 total > 0 时追加「已集齐」，`text-neutral-600`。total = 0 不画进度条，只显示文字。
- **收藏列表**（`collection.list({ state, cursor, limit: 20 })`，按 updatedAt 倒序，「加载更多」用 `nextCursor`，为 null 时隐藏）：一个列表，顶部三个筛选按钮「全部 / 我有 / 想要」。
  - 筛选按钮：`Button variant="outline"` + `aria-pressed`，按下态 `bg-brand-600 text-white` 加 ✓（同 §1）；外层 `role="group"` + `aria-label`「筛选」。默认「全部」。
  - 筛选按 state 请求服务端：全部 = `all`、我有 = `owned`、想要 = `wanted`（含既有又想要的卡，以后端定义为准）。换筛选时丢弃已加载项，从第一页重新分页，显示 §6 的加载骨架；焦点留在所按的筛选按钮上。
  - 每行：缩略图 `aspect-[63/88] w-10` + 卡名（链接 `/cards/:cardSlug`）+ seriesTitle + 状态标签。标签为文字加 ✓ 图标（`aria-hidden`），`text-sm text-neutral-600`：「✓ 我有 ×{ownedCount}」（ownedCount ≥2 才显示 ×n）、「✓ 想要」，两者都有时两枚并排。不只靠颜色区分。
  - 缩略图：用现有 `CardThumb`（`components/card-thumb.tsx`，`src`=卡图字段、`slug`=cardSlug、`width="w-10"`），比例 63/88。卡图为 null、非 https 或加载失败时，沿用它内部 `Artwork` 的回退：显示按 slug 生成的占位图；装饰性，不读屏（卡名已在旁边）。不另写占位块。
- 375：进度行系列名在上、「已有 X / 共 N」换到下一行左对齐；筛选三按钮 `grid grid-cols-3 gap-2`，`w-full`。

## §4 分享
- 有 `navigator.share` 且 `navigator.canShare({url})` 为真：调用系统面板，内容为卡名 + 当前卡牌地址。用户取消（AbortError）不提示。
- 否则：`navigator.clipboard.writeText(当前地址)`，成功后在条下方的 `role="status"` 区域显示「链接已复制」，3 秒后清空文字（区域本身常驻）。
- 复制也失败：同一区域显示「无法复制，请手动复制地址栏中的链接」。
- 焦点始终留在「分享」按钮上。未登录也可分享。

## §5 未登录
- 收藏条照常显示「我有」「想要」「分享」，均为未按下态，不显示数量。
- 点「我有」或「想要」：跳到登录页，带 `redirect` 回本卡（CH-102 现有写法），不弹层。
- 条下方一行提示「登录后可记录收藏」，`text-sm text-neutral-600`，「登录」是链接。
- `/me` 未登录行为不变（CH-102）。

## §6 状态
| 位置 | 状态 | 表现 |
|---|---|---|
| 详情收藏条 | 加载 | 页面由 CH-109 骨架覆盖；byCard 未返回时两个切换 `disabled`、未按下、叠骨架（§1） |
| 详情收藏条 | byCard 失败 | 切换 `disabled`；`ErrorBox`「收藏状态加载失败」+「重试」，读屏播报 |
| 详情收藏条 | 保存中 | 乐观更新，按钮不禁用，不加转圈 |
| 详情收藏条 | 保存失败 | 回滚；条下方 `ErrorBox` 文案按 CH-114 §2 映射，无重试按钮 |
| 详情收藏条 | 404（`NOT_FOUND`，卡已删除） | `error.app.NOT_FOUND`；回滚 |
| 详情收藏条 | 401 | `error.app.UNAUTHORIZED`，跳转登录同 §5 |
| 详情收藏条 | 429（每分钟 60 次） | `error.app.TOO_MANY_REQUESTS`「操作太频繁，请稍后再试」；回滚 |
| /me 收藏 | 加载 | 三行骨架，沿用 `me-skeleton.tsx:1-20`（`motion-reduce:animate-none`） |
| /me 收藏 | 空（无任何收藏） | 虚线框：「还没有收藏。在卡牌页点「我有」或「想要」开始记录」 |
| /me 收藏 | 切换筛选 | 列表换成三行骨架（同加载），筛选按钮保持可用 |
| /me 收藏 | 筛选结果为空 | 一行 `text-neutral-600`：「暂无」，不显示「加载更多」 |
| /me 收藏 | 加载更多失败 | 列表保留，按钮下方 `ErrorBox` + 「重试」 |
| /me 收藏 | progress 与 list 一个成功一个失败 | 各自独立显示错误与重试，不整块报错 |
| /me 收藏 | 错误 | `ErrorBox` + `RetryButton`；重试失败焦点落到 RetryButton（同 CH-204 §4） |

复制结果用条下方常驻的 `role="status"` 区域播报；保存错误用 `ErrorBox` 自带的播报方式；字段错误用 `aria-describedby` 关联，不重复播报。

## §7 token 与组件
- 颜色仅现有 token：brand-500（焦点环）、brand-600、neutral-200/500/600/900、red-700（ErrorBox）。不新增 accent。
- 组件：ui-web `Button`、`Input`、`Card`；web `ErrorBox`、`RetryButton`。
- 焦点：所有可交互元素 `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2`（G-1）。
- 只用 Tailwind v4 原生类；长文本 `wrap-anywhere` + `min-w-0`；不用 truncate、line-clamp、break-all、overflow-x-hidden。

## §8 文案（i18n `collection.*`）
| key | zh-CN | en-US |
|---|---|---|
| collection.title | 我的收藏 | My collection |
| collection.own | 我有 | I have it |
| collection.want | 想要 | Want |
| collection.share | 分享 | Share |
| collection.quantity | 数量 | Quantity |
| collection.progress | 已有 {owned} / 共 {total} | {owned} of {total} |
| collection.copied | 链接已复制 | Link copied |
| collection.copyFailed | 无法复制，请手动复制地址栏中的链接 | Couldn't copy. Copy the link from the address bar. |
| collection.signInHint | 登录后可记录收藏 | Sign in to track your collection. |
| collection.empty | 还没有收藏。在卡牌页点「我有」或「想要」开始记录 | Nothing here yet. Tap "I have it" or "Want" on a card page. |
| collection.sectionList / sectionProgress | 收藏的卡 / 系列进度 | Cards / Series progress |
| collection.filter / filterAll / filterOwned / filterWanted | 筛选 / 全部 / 我有 / 想要 | Filter / All / I have it / Want |
| collection.badgeOwned / badgeWanted | 我有 ×{count} / 想要 | Have ×{count} / Want |
| collection.statusLoadFailed | 收藏状态加载失败 | Couldn't load your collection status. |
| collection.retry | 重试 | Try again |
| collection.complete | 已集齐 | Complete |
| collection.none | 暂无 | None |
句式同 CH-114 §2：中文不加句号（多句时句内用句号），英文整句带句号；按钮和标题不带句号。

## §9 无障碍（WCAG 2.2 AA，底色 #f6f6f6 实测）
- 对比度：brand-600 文字 4.78；白字/brand-600 5.17；neutral-600 7.23；red-700 5.99；焦点环 brand-500 3.40（≥3 非文字）。neutral-500 4.39 不达标，不用于文字。
- 输入框边框：`border-neutral-500`（4.39，≥3）；不用 neutral-300（1.37）。进度条底 neutral-200 不承载信息，数值由文字给出。
- 点击目标：所有按钮和输入 ≥40px 高（h-10）；系列名链接行高 ≥24px（`py-1`）。
- 焦点顺序：我有 → 数量 → 想要 → 分享 → 登录提示链接。数量出现时不抢焦点；按「我有」后焦点留在按钮上。
- 播报：`role="status"`（复制结果）；切换状态靠 `aria-pressed`，✓ 图标 `aria-hidden` 不重复朗读；进度条 `role="progressbar"`。
- 输入框有可见 `<label>`，不只靠 placeholder。
- `prefers-reduced-motion`：进度条不加动画过渡。

## §10 平台
- Web：本规格。Tauri：与 web 相同（`navigator.share` 通常不可用，走复制）。
- 小程序：不涉及（cut-3 Out / backlog「本卡不做」）。
- 平行版本开关：不做，不留占位。

## §11 验收证据（AC3-9）
截图存 `qa/evidence/<pr>/design/`，staging，375 与 1440，zh 与 en：
1. 详情页：未登录；已登录未收藏（byCard=null）；我有×2 + 想要；byCard 加载骨架；byCard 失败 +「重试」（附读屏播报录屏或 axe/辅助树截图）；数量非法错误；保存失败 / 429 各 1。
2. 无系统分享面板（桌面 Chromium）点分享 → 「链接已复制」截图 + 读屏/axe 确认 status。
3. /me：空态、「全部 / 我有 / 想要」三种筛选各 1（各附 network 里 `state` 参数截图）、换筛选的骨架、筛选结果为空、卡图正常 1 张 + 卡图缺失/加载失败回退 1 张、有进度（「已有 1 / 共 N」，N 对照系列卡牌数）、加载骨架、错误态。
4. 每页 axe 0 违规；键盘走一遍焦点顺序录屏或截图。

## 待定
1. 字段名（byCard 返回、`state` 取值、卡图字段）以 byCard/state/卡图 PR 为准，合入后核对；不同则升 v1.3。
2. 「想要」筛选是否含既有又想要的卡，以 state=wanted 的后端实现为准，合入后核对。

已裁定（v1.2，周扒皮 / 张罗确认在 cut-3 范围）：补 byCard、list state、卡图；去掉前端筛选与占位块的降级写法。
已裁定（v0.2）：不加 +/-；按下态加 ✓；进度按完成度降序、同值按系列名；集齐显示「已集齐」。
