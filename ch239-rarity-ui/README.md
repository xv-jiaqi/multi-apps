# CH-239 系列页官方稀有度码筛选 UI 截图与 axe

- 分支 xiangzi/ch239-rarity-ui，UI 代码 head 021e60b（Design BLOCK 修复后全部重拍）；本机 vite（:5239）+ 本机 API（:4239，含 #292 的 baseRarityCodes）+ 本机库 cardhub_ch239ui。不碰 staging。
- **平行卡是本地模拟数据**（目前库里没有平行卡）：`ch239-ui-seed.sql`——30th 001 加平行「镜面闪」，官方码 MA（只在平行卡上）；124 加平行「金框」SAR 限量 99；另加无官方码的旧品类系列、空系列，以及 10 字长码系列 `sim-long-code-set`（码「超级稀有特别插画平行」，Spec v1.3 §10-10）。
- 脚本 `shoot.py`（01–13）和 `shoot_long.py`（14–16，另记触发器几何：箭头是否在框内、值是否被截断）（Playwright Chromium + axe-core 4.11.4，标签 wcag2a/2aa/21a/21aa/22aa）。加载态和错误态只拦 `cards.listBySeries` / `cards.bySlug`，其余走真 API。
- 共 64 张（16 场景 × 1440/375 × zh/en）；axe 违规 **0**；页面横向滚动 0 张。逐张结果见 `results.json`（含 URL、触发器文字、选项列表、是否空态；14/15 含 `triggerGeom`）。

| 场景 | 说明 | 1440 zh | 1440 en | 375 zh | 375 en |
|---|---|---|---|---|---|
| 01-success-options | 30th 成功态，平行开关关，展开稀有度选项（不含只在平行卡上的 MA） | [png](01-success-options-1440-zh.png) | [png](01-success-options-1440-en.png) | [png](01-success-options-375-zh.png) | [png](01-success-options-375-en.png) |
| 02-filtered-sar | ?rarityCode=SAR 筛选后，磁贴名称行显示 SAR 徽章（375 展开筛选面板） | [png](02-filtered-sar-1440-zh.png) | [png](02-filtered-sar-1440-en.png) | [png](02-filtered-sar-375-zh.png) | [png](02-filtered-sar-375-en.png) |
| 03-parallels-on-options | ?parallels=1 展开选项，MA 按 rarityCodes 顺序出现 | [png](03-parallels-on-options-1440-zh.png) | [png](03-parallels-on-options-1440-en.png) | [png](03-parallels-on-options-375-zh.png) | [png](03-parallels-on-options-375-en.png) |
| 04-parallel-only-old-link | 旧链接 ?rarityCode=MA、开关关：保留码和 parallels，空态「没有符合条件的卡牌」+「清除筛选」，触发器显示 MA | [png](04-parallel-only-old-link-1440-zh.png) | [png](04-parallel-only-old-link-1440-en.png) | [png](04-parallel-only-old-link-375-zh.png) | [png](04-parallel-only-old-link-375-en.png) |
| 05-toggle-off-keeps-code | ?rarityCode=MA&parallels=1 后用户关开关：rarityCode 保留、parallels 删除，同一空态 | [png](05-toggle-off-keeps-code-1440-zh.png) | [png](05-toggle-off-keeps-code-1440-en.png) | [png](05-toggle-off-keeps-code-375-zh.png) | [png](05-toggle-off-keeps-code-375-en.png) |
| 06-invalid-sar-cleaned | ?rarityCode=sar（大小写不符）被 replace 清掉，不出空态 | [png](06-invalid-sar-cleaned-1440-zh.png) | [png](06-invalid-sar-cleaned-1440-en.png) | [png](06-invalid-sar-cleaned-375-zh.png) | [png](06-invalid-sar-cleaned-375-en.png) |
| 07-loading | 首次加载（拦住 cards.listBySeries 不应答）：骨架，两个稀有度 Select 都不渲染（§1） | [png](07-loading-1440-zh.png) | [png](07-loading-1440-en.png) | [png](07-loading-375-zh.png) | [png](07-loading-375-en.png) |
| 08-error | cards.listBySeries 返回 500：列表 ErrorBox role=alert（系列头正常） | [png](08-error-1440-zh.png) | [png](08-error-1440-en.png) | [png](08-error-375-zh.png) | [png](08-error-375-en.png) |
| 09-empty-series | 空系列（模拟 sim-empty-set） | [png](09-empty-series-1440-zh.png) | [png](09-empty-series-1440-en.png) | [png](09-empty-series-375-zh.png) | [png](09-empty-series-375-en.png) |
| 10-legacy-4tier | 无官方码系列（模拟 sim-legacy-set）+ ?rarityCode=SAR：URL 清掉，4 档选项 | [png](10-legacy-4tier-1440-zh.png) | [png](10-legacy-4tier-1440-en.png) | [png](10-legacy-4tier-375-zh.png) | [png](10-legacy-4tier-375-en.png) |
| 11-detail-sar | 详情页 ptcg-sc-30th-124：标题旁 SAR 中性徽章，属性区「稀有度」行保留 | [png](11-detail-sar-1440-zh.png) | [png](11-detail-sar-1440-en.png) | [png](11-detail-sar-375-zh.png) | [png](11-detail-sar-375-en.png) |
| 12-detail-symbol | 详情页 ptcg-sc-cbb6-01-07：标题旁 ★★★（读屏「三星」） | [png](12-detail-symbol-1440-zh.png) | [png](12-detail-symbol-1440-en.png) | [png](12-detail-symbol-375-zh.png) | [png](12-detail-symbol-375-en.png) |
| 13-detail-legacy | 详情页 sim-legacy-1：无官方码，仍是 4 档徽章 | [png](13-detail-legacy-1440-zh.png) | [png](13-detail-legacy-1440-en.png) | [png](13-detail-legacy-375-zh.png) | [png](13-detail-legacy-375-en.png) |
| 14-long-code-trigger | 10 字长码已选：1440 `w-40` 触发器单行截断，箭头在框内（`chevronInside:true`，`valueTruncated:true`）；375 `w-full` 不截断；DOM 和读屏是完整码 | [png](14-long-code-trigger-1440-zh.png) | [png](14-long-code-trigger-1440-en.png) | [png](14-long-code-trigger-375-zh.png) | [png](14-long-code-trigger-375-en.png) |
| 15-long-code-options | 展开选项：长码折行完整显示 | [png](15-long-code-options-1440-zh.png) | [png](15-long-code-options-1440-en.png) | [png](15-long-code-options-375-zh.png) | [png](15-long-code-options-375-en.png) |
| 16-detail-long-code | 详情页 sim-long-2：长码徽章 `max-w-24 truncate`，`title` 为完整码 | [png](16-detail-long-code-1440-zh.png) | [png](16-detail-long-code-1440-en.png) | [png](16-detail-long-code-375-zh.png) | [png](16-detail-long-code-375-en.png) |
