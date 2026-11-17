"""CH-239 UI screenshots + axe (Spec CH-239 v1.2).

Local `vite` on :5239 proxying /trpc to a local API on :4239 (branch
xiangzi/ch239-rarity-ui, DB cardhub_ch239ui = ptcg-sc 7 series + simulated
data from /workspace/ch239-ui-seed.sql: two 30th parallels — 001 镜面闪 with
the parallel-only code MA, 124 金框 with SAR — a legacy series without codes,
and an empty series). Loading and error states intercept cards.listBySeries /
cards.bySlug only. Never touches staging.
"""
from __future__ import annotations

import asyncio
import json
import os
import urllib.parse
from urllib.parse import urlparse

from playwright.async_api import Route, async_playwright

OUT = '/workspace/ch239-ui-shots/out-long'
AXE = '/workspace/axe-local/node_modules/axe-core/axe.min.js'
BASE = 'http://127.0.0.1:5239'
LOC = {'zh': 'zh-CN', 'en': 'en-US'}
VP = {
    1440: dict(viewport={'width': 1440, 'height': 900}),
    375: dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True),
}
results: list[dict] = []


def procs(url: str) -> list[str]:
    path = urlparse(url).path
    return path.split('/trpc/', 1)[1].split(',') if '/trpc/' in path else []


async def attach(ctx, mode: str | None):
    async def handler(route: Route) -> None:
        names = procs(route.request.url)
        target = [n for n in names if n in ('cards.listBySeries', 'cards.bySlug')]
        if mode == 'hold' and target:
            return  # never answer: frozen loading state
        if mode == 'error' and target:
            # Only the targeted procedures fail; the rest of the batch keeps the real API answer.
            real = await route.fetch()
            data = await real.json()
            err = {'error': {'message': 'mock', 'code': -32603,
                   'data': {'code': 'INTERNAL_SERVER_ERROR', 'httpStatus': 500, 'path': None}}}
            if isinstance(data, list):
                data = [err if n in ('cards.listBySeries', 'cards.bySlug') else item for n, item in zip(names, data)]
            else:
                data = err
            await route.fulfill(status=500 if not isinstance(data, list) or len(names) == 1 else 207,
                                body=json.dumps(data), content_type='application/json')
            return
        await route.continue_()
    await ctx.route('**/trpc/**', handler)


async def open_filters(page, width):
    if width == 375:
        btn = page.locator('button[aria-controls="series-filters"]')
        if await btn.count():
            await btn.click()
            await page.wait_for_timeout(200)


async def open_rarity(page, lang):
    trigger = page.get_by_role('combobox', name='稀有度' if lang == 'zh' else 'Rarity')
    await trigger.focus()
    await page.keyboard.press('Enter')
    await page.wait_for_selector('[role="listbox"]')
    await page.wait_for_timeout(300)


async def shot(browser, name, path, width, lang, mode=None, act=None, wait=None, full=False):
    ctx = await browser.new_context(**VP[width])
    await ctx.add_init_script("localStorage.setItem('cardhub:locale'," + json.dumps(LOC[lang]) + ');')
    await attach(ctx, mode)
    page = await ctx.new_page()
    await page.goto(BASE + path, wait_until='domcontentloaded')
    if wait:
        await page.wait_for_selector(wait, timeout=20000)
    else:
        await page.wait_for_timeout(1500)
    await page.wait_for_timeout(600)
    if act:
        await act(page, width, lang)
    await page.wait_for_timeout(500)
    file = f'{name}-{width}-{lang}.png'
    await page.screenshot(path=f'{OUT}/{file}', full_page=full)
    await page.add_script_tag(path=AXE)
    axe = await page.evaluate("""async () => (await axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,n:v.nodes.length,t:v.nodes.slice(0,3).map(x=>x.target.join(' '))}))""")
    facts = await page.evaluate("""() => {
      const se = document.scrollingElement;
      const trig = [...document.querySelectorAll('[role=combobox]')].find(t => { const l = document.querySelector('label[for="'+t.id+'"]'); return l && /稀有度|Rarity/.test(l.textContent); });
      const opts = [...document.querySelectorAll('[role=option]')].map(o => o.textContent.trim());
      const a = document.activeElement;
      return { url: decodeURIComponent(location.pathname + location.search), htmlLang: document.documentElement.lang,
        noHscroll: se.scrollWidth <= se.clientWidth, scrollWidth: se.scrollWidth,
        rarityTrigger: trig ? trig.textContent.trim() : null, options: opts,
        noMatch: /没有符合条件的卡牌|No cards match/.test(document.body.innerText),
        status: [...document.querySelectorAll('[role=status]')].map(s => s.textContent.trim()).filter(Boolean),
        active: a ? (a.tagName + ' ' + (a.textContent || '').trim().slice(0, 30)) : null,
        triggerGeom: trig ? (() => { const r = trig.getBoundingClientRect(); const svg = trig.querySelector('svg').getBoundingClientRect();
          const inner = trig.querySelector('span > span'); 
          return { triggerW: Math.round(r.width), chevronInside: svg.left >= r.left - 0.5 && svg.right <= r.right + 0.5,
                   valueTruncated: inner ? inner.scrollWidth > inner.clientWidth : null, valueText: inner ? inner.textContent : null }; })() : null };
    }""")
    results.append(dict(name=name, w=width, lang=lang, file=file, axe=axe, **facts))
    await ctx.close()


GRID = 'ul.grid li a'


async def act_options(page, width, lang):
    await open_filters(page, width)
    await open_rarity(page, lang)


async def act_filters(page, width, lang):
    await open_filters(page, width)


async def act_toggle_off(page, width, lang):
    await open_filters(page, width)
    await page.locator('#series-parallels').click()
    await page.wait_for_timeout(1200)


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for width in (1440, 375):
            for lang in ('zh', 'en'):
                s = '/series/sim-long-code-set'
                q = '?rarityCode=' + urllib.parse.quote('超级稀有特别插画平行')
                await shot(browser, '14-long-code-trigger', s + q, width, lang, wait=GRID, act=act_filters)
                await shot(browser, '15-long-code-options', s + q, width, lang, wait=GRID, act=act_options)
                await shot(browser, '16-detail-long-code', '/cards/sim-long-2', width, lang, wait='h1')
        await browser.close()
    with open(f'{OUT}/results.json', 'w') as fh:
        json.dump(results, fh, ensure_ascii=False, indent=1)
    bad = 0
    for r in results:
        n = len(r['axe'])
        bad += 1 if n else 0
        print(r['file'], 'geom', r.get('triggerGeom'), 'axe', n, r['axe'] or '', r['url'], 'hscrollOK' if r['noHscroll'] else 'HSCROLL', r['htmlLang'], 'trigger=', r['rarityTrigger'], 'noMatch=', r['noMatch'])
    print('axe-violating shots:', bad)


asyncio.run(main())
