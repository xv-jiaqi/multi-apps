"""CH-238 preview-column screenshots.

Local `pnpm dev:web` on :5173. Playwright intercepts every tRPC call and every
non-GET request (Spec CH-238 §10-6). Preview rows are the same fixture as the
unit tests (ptcg-sc-30th values, omitted, will-clear, 64-char slug, long card
number). This script does not read .env and does not touch staging.
"""
from __future__ import annotations

import asyncio
import json
import os
from urllib.parse import urlparse

from playwright.async_api import Route, async_playwright

OUT = '/workspace/wt-ch238-ui/tmp-ch238/shots'
AXE = '/workspace/axe-local/node_modules/axe-core/axe.min.js'
BASE = 'http://localhost:5173/admin/catalog/import'
USER = {"id": "admin", "email": "admin@example.com", "username": "admin", "role": "admin"}
SESSION = {"token": "mock", "user": USER}
LOC = {'zh': 'zh-CN', 'en': 'en-US'}
VP = {
    1440: dict(viewport={'width': 1440, 'height': 900}),
    375: dict(
        viewport={'width': 375, 'height': 900},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
    ),
}

LONG_SLUG = 'a-very-long-card-slug-used-to-check-wrapping-at-the-sixty-four-x'
LONG_SUBSET = 'a-very-long-subset-slug-that-hits-the-sixty-four-character-limit'
LONG_NUM = 'SV-PROMO-0001-2026-CN'

CH238_IMPORT = [
    {
        "slug": "ptcg-sc-30th",
        "title": "30周年庆典",
        "categorySlug": "ptcg-sc",
        "releaseDate": "2026-09-16",
        "cards": [
            {
                "slug": "ptcg-sc-30th-001",
                "name": "蛋蛋",
                "rarity": "common",
                "subsetSlug": "main",
                "cardNumber": "001",
            }
        ],
    },
    {"slug": "demo-omit", "title": "省略示例", "categorySlug": "ptcg-sc"},
    {
        "slug": "demo-clear",
        "title": "清空示例",
        "cards": [
            {
                "slug": "demo-clear-card",
                "name": "清空示例",
                "rarity": "common",
                "subsetSlug": "main",
                "cardNumber": "",
            },
            {
                "slug": LONG_SLUG,
                "name": "长值示例",
                "rarity": "common",
                "subsetSlug": LONG_SUBSET,
                "cardNumber": LONG_NUM,
            },
        ],
    },
]

CH238_ROWS = [
    {
        "row": {
            "row": 1,
            "type": "series",
            "slug": "ptcg-sc-30th",
            "name": "30周年庆典",
            "categorySlug": "ptcg-sc",
            "releaseDate": "2026-09-16",
        },
        "status": "updated",
        "errors": [],
    },
    {
        "row": {
            "row": 2,
            "type": "card",
            "slug": "ptcg-sc-30th-001",
            "name": "蛋蛋",
            "seriesSlug": "ptcg-sc-30th",
            "subsetSlug": "main",
            "cardNumber": "001",
        },
        "status": "unchanged",
        "errors": [],
    },
    {
        "row": {
            "row": 3,
            "type": "series",
            "slug": "demo-omit",
            "name": "省略示例",
            "categorySlug": "ptcg-sc",
        },
        "status": "updated",
        "errors": [],
    },
    {
        "row": {
            "row": 4,
            "type": "card",
            "slug": "demo-clear-card",
            "name": "清空示例",
            "seriesSlug": "demo-clear",
            "subsetSlug": "main",
            "cardNumber": "",
        },
        "status": "updated",
        "errors": [],
    },
    {
        "row": {
            "row": 5,
            "type": "card",
            "slug": LONG_SLUG,
            "name": "长值示例",
            "seriesSlug": "demo-clear",
            "subsetSlug": LONG_SUBSET,
            "cardNumber": LONG_NUM,
        },
        "status": "error",
        "errors": [{"path": "series[2].cards[1].cardNumber", "code": "TOO_LONG"}],
    },
]

SUCCESS_IMPORT = [
    {
        "slug": "shot-ok",
        "title": "截图系列",
        "categorySlug": "ptcg-sc",
        "releaseDate": "2026-09-16",
        "cards": [
            {
                "slug": "shot-ok-001",
                "name": "截图卡",
                "rarity": "rare",
                "subsetSlug": "main",
                "cardNumber": "001",
            }
        ],
    }
]

SUCCESS_ROWS = [
    {
        "row": {
            "row": 1,
            "type": "series",
            "slug": "shot-ok",
            "name": "截图系列",
            "categorySlug": "ptcg-sc",
            "releaseDate": "2026-09-16",
        },
        "status": "created",
        "errors": [],
    },
    {
        "row": {
            "row": 2,
            "type": "card",
            "slug": "shot-ok-001",
            "name": "截图卡",
            "seriesSlug": "shot-ok",
            "subsetSlug": "main",
            "cardNumber": "001",
        },
        "status": "created",
        "errors": [],
    },
]


def trpc_procedures(url: str) -> list[str]:
    path = urlparse(url).path
    if '/trpc/' not in path:
        return []
    return path.split('/trpc/', 1)[1].split(',')


async def fulfill_trpc(route: Route, rows: list[dict]) -> None:
    data = {
        'auth.me': USER,
        'notifications.unreadCount': {'count': 0},
        'search.global': {'items': []},
        'admin.catalog.import': rows,
    }
    procs = trpc_procedures(route.request.url)
    if not procs:
        procs = ['unknown']
    body = [{'result': {'data': data.get(proc)}} for proc in procs]
    await route.fulfill(status=200, body=json.dumps(body), content_type='application/json')


def attach_routes(ctx, rows: list[dict], hang_import: bool = False, import_error: bool = False):
    async def handler(route: Route) -> None:
        url = route.request.url
        method = route.request.method
        if '/trpc/' in urlparse(url).path:
            procs = trpc_procedures(url)
            if hang_import and any(p == 'admin.catalog.import' or p.startswith('admin.catalog.import') for p in procs):
                return
            if import_error and any(p.startswith('admin.catalog.import') for p in procs):
                body = json.dumps(
                    {
                        'error': {
                            'message': 'mock',
                            'code': -32603,
                            'data': {'code': 'INTERNAL_SERVER_ERROR', 'httpStatus': 500},
                        }
                    }
                )
                await route.fulfill(status=500, body=body, content_type='application/json')
                return
            await fulfill_trpc(route, rows)
            return
        if method != 'GET':
            await route.fulfill(status=204, body='')
            return
        await route.continue_()

    return ctx.route('**/*', handler)


results: list[dict] = []


async def shot(browser, name: str, width: int, lang: str, act, rows=None, hang_import=False, import_error=False, full=True):
    if rows is None:
        rows = CH238_ROWS
    ctx = await browser.new_context(**VP[width])
    await ctx.add_init_script(
        "localStorage.setItem('cardhub:locale'," + json.dumps(LOC[lang]) + ');'
        "localStorage.setItem('cardhub:session'," + json.dumps(json.dumps(SESSION)) + ');'
    )
    await attach_routes(ctx, rows, hang_import=hang_import, import_error=import_error)
    page = await ctx.new_page()
    await page.goto(BASE, wait_until='networkidle')
    await page.wait_for_selector('#import-json')
    await act(page, lang)
    await page.wait_for_timeout(400)
    path = f'{OUT}/{name}-{width}-{lang}.png'
    await page.screenshot(path=path, full_page=full)
    await page.add_script_tag(path=AXE)
    axe = await page.evaluate(
        """async () => (await axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,n:v.nodes.length,t:v.nodes.slice(0,3).map(x=>x.target.join(' '))}))"""
    )
    facts = await page.evaluate(
        """() => {
          const root = document.documentElement;
          const se = document.scrollingElement;
          const table = document.querySelector('table');
          const cardSection = [...document.querySelectorAll('section')].find(s => s.getAttribute('aria-labelledby') === 'import-preview-title' && s.className.includes('sm:hidden'));
          const status = document.querySelector('[role="status"]');
          const headers = table ? [...table.querySelectorAll('th')].map(th => th.textContent.trim()) : [];
          const hasScope = table ? [...table.querySelectorAll('th')].every(th => th.getAttribute('scope') === 'col') : null;
          return {
            htmlLang: root.lang,
            noHscroll: se ? se.scrollWidth <= se.clientWidth : null,
            docNoHscroll: root.scrollWidth === root.clientWidth,
            scrollWidth: root.scrollWidth,
            clientWidth: root.clientWidth,
            tableHiddenClass: table ? table.closest('.hidden') !== null && table.closest('.sm\\\\:block, .sm\\\\:block') !== undefined : null,
            tableWrapper: table && table.parentElement ? table.parentElement.parentElement.className : null,
            cardCount: cardSection ? cardSection.querySelectorAll('li').length : 0,
            statusRole: status ? status.getAttribute('role') : null,
            headers,
            hasScope,
            omitted: document.body.innerText.includes('省略（保留）') || document.body.innerText.includes('Omitted (kept)'),
            willClear: document.body.innerText.includes('将清空') || document.body.innerText.includes('Will clear'),
            notApplicableVisible: false,
          };
        }"""
    )
    results.append(dict(name=name, w=width, lang=lang, file=os.path.basename(path), axe=axe, **facts))
    await ctx.close()


def preview_btn(page, lang):
    return page.get_by_role('button', name='预览' if lang == 'zh' else 'Preview', exact=True)


async def fill_import(page, data):
    await page.fill('#import-json', json.dumps(data, ensure_ascii=False, indent=2))


async def empty(page, lang):
    return


async def loading(page, lang):
    await fill_import(page, CH238_IMPORT)
    await preview_btn(page, lang).click()
    await page.wait_for_selector('[aria-busy="true"]')


async def parse_error(page, lang):
    await page.fill('#import-json', '[\n  {\n    "slug":\n  }\n]')
    await preview_btn(page, lang).click()
    await page.wait_for_selector('#import-json-error')


async def request_error(page, lang):
    await fill_import(page, CH238_IMPORT)
    await preview_btn(page, lang).click()
    await page.wait_for_selector('[role="alert"]')


async def preview_errors_only(page, lang):
    await fill_import(page, CH238_IMPORT)
    await preview_btn(page, lang).click()
    await page.wait_for_selector('#import-blocked')
    await page.locator('#import-preview-title').scroll_into_view_if_needed()


async def preview_all(page, lang):
    await preview_errors_only(page, lang)
    await page.get_by_role('radio', name='全部' if lang == 'zh' else 'All').check(force=True)
    await page.locator('#import-preview-title').scroll_into_view_if_needed()


async def success(page, lang):
    await fill_import(page, SUCCESS_IMPORT)
    await preview_btn(page, lang).click()
    await page.get_by_role('button', name='导入' if lang == 'zh' else 'Import', exact=True).click()
    await page.get_by_role('button', name='确认导入' if lang == 'zh' else 'Import now', exact=True).click()
    await page.wait_for_selector('#import-already')
    await page.evaluate('window.scrollTo(0,0)')


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for width in (1440, 375):
            for lang in ('zh', 'en'):
                await shot(browser, '01-empty', width, lang, empty, full=False)
                await shot(browser, '02-loading', width, lang, loading, hang_import=True, full=False)
                await shot(browser, '03-error-parse', width, lang, parse_error, full=False)
                await shot(browser, '04-error-500', width, lang, request_error, import_error=True, full=False)
                await shot(browser, '05-taxonomy-all', width, lang, preview_all)
                await shot(browser, '06-taxonomy-errors', width, lang, preview_errors_only)
                await shot(browser, '07-success', width, lang, success, rows=SUCCESS_ROWS)
        await browser.close()
    with open(f'{OUT}/results.json', 'w') as fh:
        json.dump(results, fh, ensure_ascii=False, indent=1)
    failed = 0
    for row in results:
        n = len(row['axe'])
        flag = 'OK' if n == 0 else 'AXE'
        if n:
            failed += 1
        print(
            row['file'],
            flag,
            n,
            row['axe'] or '',
            'lang',
            row['htmlLang'],
            'noHscroll',
            row['noHscroll'],
            'doc',
            row['docNoHscroll'],
            f"{row['scrollWidth']}x{row['clientWidth']}",
        )
    if failed:
        raise SystemExit(f'{failed} screenshots had axe violations')


asyncio.run(main())
