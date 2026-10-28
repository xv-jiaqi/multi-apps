# §3.1 incomplete 节点的像素对比度

head `a02cacf38ebcdfa86d5537e8dfef40d816923704`。axe-core 4.11.4，runOnly 为 wcag2a、wcag2aa、wcag21a、wcag21aa、wcag22aa。重跑时间 2026-10-28T13:32:25.589Z 至 2026-10-28T13:33:38.720Z。

文字像素取文字区域内最接近计算色、并且和背后背景不同的像素。背景像素是把这段文字设成透明后，同一坐标的像素。比值用 WCAG 相对亮度。

| 节点 | 视口 | messageKey | 文字色 | 背景色 | 比值 |
| --- | --- | --- | --- | --- | --- |
| #1 pages/reports-list.tsx:121 子链接 text-brand-600 | zh-1440 | bgGradient | rgb(37, 99, 235) | rgb(252, 252, 252) | 5.04 |
| #1 pages/reports-list.tsx:121 子链接 text-brand-600 | zh-375 | bgOverlap | rgb(37, 99, 235) | rgb(245, 242, 245) | 4.65 |
| #1 pages/reports-list.tsx:121 子链接 text-brand-600 | en-1440 | bgGradient | rgb(37, 99, 235) | rgb(252, 252, 252) | 5.04 |
| #1 pages/reports-list.tsx:121 子链接 text-brand-600 | en-375 | bgOverlap | rgb(37, 99, 235) | rgb(238, 244, 250) | 4.67 |
| #2 pages/reports-list.tsx:131 | zh-1440 | bgGradient | rgb(82, 82, 82) | rgb(252, 252, 252) | 7.62 |
| #2 pages/reports-list.tsx:131 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(245, 243, 246) | 7.08 |
| #2 pages/reports-list.tsx:131 | en-1440 | bgGradient | rgb(82, 82, 82) | rgb(252, 252, 252) | 7.62 |
| #2 pages/reports-list.tsx:131 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(238, 245, 250) | 7.1 |
| #3 pages/reports-list.tsx:192 | zh-1440 | bgGradient | rgb(82, 82, 82) | rgb(252, 252, 252) | 7.62 |
| #3 pages/reports-list.tsx:192 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(229, 240, 248) | 6.75 |
| #3 pages/reports-list.tsx:192 | en-1440 | bgGradient | rgb(82, 82, 82) | rgb(252, 252, 252) | 7.62 |
| #3 pages/reports-list.tsx:192 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(224, 241, 251) | 6.75 |
| #4 pages/reports-list.tsx:370 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(250, 250, 250) | 7.49 |
| #4 pages/reports-list.tsx:370 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(250, 250, 250) | 7.49 |
| #5 pages/trade-list.tsx:589 | zh-1440 | bgGradient | rgb(82, 82, 82) | rgb(250, 250, 250) | 7.49 |
| #5 pages/trade-list.tsx:589 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(236, 243, 248) | 6.97 |
| #5 pages/trade-list.tsx:589 | en-1440 | bgGradient | rgb(82, 82, 82) | rgb(249, 250, 250) | 7.47 |
| #5 pages/trade-list.tsx:589 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(238, 245, 248) | 7.09 |
| #6 pages/series-list.tsx:82 | zh-1440 | bgGradient | rgb(82, 82, 82) | rgb(252, 252, 252) | 7.62 |
| #6 pages/series-list.tsx:82 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(247, 239, 243) | 6.92 |
| #6 pages/series-list.tsx:82 | en-1440 | bgGradient | rgb(82, 82, 82) | rgb(252, 252, 252) | 7.62 |
| #6 pages/series-list.tsx:82 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(247, 239, 243) | 6.92 |
| #7 pages/series-detail.tsx:179 | zh-1440 | bgGradient | rgb(82, 82, 82) | rgb(253, 253, 253) | 7.68 |
| #7 pages/series-detail.tsx:179 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(253, 248, 248) | 7.43 |
| #7 pages/series-detail.tsx:179 | en-1440 | bgGradient | rgb(82, 82, 82) | rgb(253, 253, 253) | 7.68 |
| #7 pages/series-detail.tsx:179 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(253, 248, 248) | 7.43 |
| #8 pages/card-detail.tsx:57 | zh-1440 | bgGradient | rgb(82, 82, 82) | rgb(253, 253, 253) | 7.68 |
| #8 pages/card-detail.tsx:57 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(253, 248, 248) | 7.43 |
| #8 pages/card-detail.tsx:57 | en-1440 | bgGradient | rgb(82, 82, 82) | rgb(253, 253, 253) | 7.68 |
| #8 pages/card-detail.tsx:57 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(253, 248, 248) | 7.43 |
| #9 pages/card-detail.tsx:134 | zh-1440 | bgGradient | rgb(82, 82, 82) | rgb(253, 253, 253) | 7.68 |
| #9 pages/card-detail.tsx:134 | zh-375 | bgGradient | rgb(82, 82, 82) | rgb(247, 249, 250) | 7.4 |
| #9 pages/card-detail.tsx:134 | en-1440 | bgGradient | rgb(82, 82, 82) | rgb(253, 253, 253) | 7.68 |
| #9 pages/card-detail.tsx:134 | en-375 | bgGradient | rgb(82, 82, 82) | rgb(247, 249, 250) | 7.4 |
| #10 pages/forum-list.tsx:108 | zh-1440 | bgGradient | rgb(82, 82, 82) | rgb(252, 252, 252) | 7.62 |
| #10 pages/forum-list.tsx:108 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(238, 241, 247) | 6.91 |
| #10 pages/forum-list.tsx:108 | en-1440 | bgGradient | rgb(82, 82, 82) | rgb(252, 252, 252) | 7.62 |
| #10 pages/forum-list.tsx:108 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(237, 243, 248) | 6.99 |
| #11 pages/forum-detail.tsx:507 | zh-1440 | bgGradient | rgb(82, 82, 82) | rgb(253, 253, 253) | 7.68 |
| #11 pages/forum-detail.tsx:507 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(253, 248, 248) | 7.43 |
| #11 pages/forum-detail.tsx:507 | en-1440 | bgGradient | rgb(82, 82, 82) | rgb(253, 253, 253) | 7.68 |
| #11 pages/forum-detail.tsx:507 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(253, 248, 248) | 7.43 |
| #12 pages/forum-detail.tsx:952 非高亮 bg-white/80 | zh-1440 | bgGradient | rgb(82, 82, 82) | rgb(254, 254, 254) | 7.75 |
| #12 pages/forum-detail.tsx:952 非高亮 bg-white/80 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(254, 250, 251) | 7.55 |
| #12 pages/forum-detail.tsx:952 高亮 bg-brand-50 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(239, 246, 255) | 7.18 |
| #12 pages/forum-detail.tsx:952 非高亮 bg-white/80 | en-1440 | bgGradient | rgb(82, 82, 82) | rgb(254, 254, 254) | 7.75 |
| #12 pages/forum-detail.tsx:952 非高亮 bg-white/80 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(250, 251, 253) | 7.55 |
| #12 pages/forum-detail.tsx:952 高亮 bg-brand-50 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(239, 246, 255) | 7.18 |
| #13 pages/forum-edit.tsx:145 | zh-1440 | bgGradient | rgb(82, 82, 82) | rgb(253, 253, 253) | 7.68 |
| #13 pages/forum-edit.tsx:145 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(253, 248, 248) | 7.43 |
| #13 pages/forum-edit.tsx:145 | en-1440 | bgGradient | rgb(82, 82, 82) | rgb(253, 253, 253) | 7.68 |
| #13 pages/forum-edit.tsx:145 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(253, 248, 248) | 7.43 |
| #14 components/admin/admin-gate.tsx:23 子链接 text-brand-600 | zh-1440 | bgGradient | rgb(37, 99, 235) | rgb(253, 253, 253) | 5.08 |
| #14 components/admin/admin-gate.tsx:23 子链接 text-brand-600 | zh-375 | bgOverlap | rgb(37, 99, 235) | rgb(253, 250, 250) | 4.98 |
| #14 components/admin/admin-gate.tsx:23 子链接 text-brand-600 | en-1440 | bgGradient | rgb(37, 99, 235) | rgb(253, 253, 253) | 5.08 |
| #14 components/admin/admin-gate.tsx:23 子链接 text-brand-600 | en-375 | bgOverlap | rgb(37, 99, 235) | rgb(253, 252, 252) | 5.05 |
| #15 components/admin/admin-gate.tsx:37 | zh-1440 | bgGradient | rgb(82, 82, 82) | rgb(253, 253, 253) | 7.68 |
| #15 components/admin/admin-gate.tsx:37 | zh-375 | bgOverlap | rgb(82, 82, 82) | rgb(253, 250, 250) | 7.53 |
| #15 components/admin/admin-gate.tsx:37 | en-1440 | bgGradient | rgb(82, 82, 82) | rgb(253, 253, 253) | 7.68 |
| #15 components/admin/admin-gate.tsx:37 | en-375 | bgOverlap | rgb(82, 82, 82) | rgb(253, 252, 252) | 7.63 |

`#1` 和 `#14` 的 `p.text-neutral-600` 没有自身文字像素，计算色仍是 `rgb(82, 82, 82)`，对照 #f6f6f6 为 7.23。表里这两条是 incomplete 实际选中的子链接。

1440 的 `#4` 只读备注和 `#12` 高亮时间在 `color-contrast` 的 passes 里，不在 incomplete。实际背景也不是 #f6f6f6：

| 节点 | 视口 | 文字色 | 背景色 | 比值 | 背景 |
| --- | --- | --- | --- | --- | --- |
| #4 pages/reports-list.tsx:370 | zh-1440 | rgb(82, 82, 82) | rgb(250, 250, 250) | 7.49 | read-only:bg-neutral-50 |
| #12 pages/forum-detail.tsx:952 高亮 bg-brand-50 | zh-1440 | rgb(82, 82, 82) | rgb(239, 246, 255) | 7.18 | bg-brand-50 |
| #4 pages/reports-list.tsx:370 | en-1440 | rgb(82, 82, 82) | rgb(250, 250, 250) | 7.49 | read-only:bg-neutral-50 |
| #12 pages/forum-detail.tsx:952 高亮 bg-brand-50 | en-1440 | rgb(82, 82, 82) | rgb(239, 246, 255) | 7.18 | bg-brand-50 |

