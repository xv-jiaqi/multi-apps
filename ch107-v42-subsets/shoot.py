"""CH-107 v4.2 §7.4/§7.8 (AC7-3) screenshots: local vite :5173, tRPC mocked by Playwright route
(the #279 API response shape for a new series with 21 subsets). Not staging."""
import asyncio, json, os
from urllib.parse import urlparse
from playwright.async_api import async_playwright

OUT = '/workspace/slc-pr/shots'
AXE = '/workspace/axe-local/node_modules/.pnpm/axe-core@4.11.4/node_modules/axe-core/axe.min.js'
BASE = 'http://localhost:5173/admin/catalog/import'
USER = {"id": "admin", "email": "admin@example.com", "username": "admin", "role": "admin"}
SESSION = {"token": "mock", "user": USER}
LOC = {'zh': 'zh-CN', 'en': 'en-US'}
VP = {1440: dict(viewport={'width': 1440, 'height': 900}),
      375: dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True)}

AC73 = [
  {"slug": "neighbour", "title": "正常系列"},
  {"slug": "subsets-21", "title": "二十一个子集",
   "subsets": [{"slug": f"s-{i+1}", "name": f"子集 {i+1}", "kind": "BASE" if i == 0 else "INSERT", "sortOrder": i} for i in range(21)]},
]
# Same as apps/cardhub/api/test/catalog-import-hardening.e2e-spec.ts "36-4: a new series listing 21 subsets".
ROWS = [
  {"row": {"row": 1, "type": "series", "slug": "neighbour", "name": "正常系列"}, "status": "created", "errors": []},
  {"row": {"row": 2, "type": "series", "slug": "subsets-21", "name": "二十一个子集"}, "status": "error",
   "errors": [{"path": "series[1].subsets", "code": "TOO_MANY_SUBSETS"}]},
]
DATA = {"auth.me": USER, "notifications.unreadCount": {"count": 0}, "admin.catalog.import": ROWS}

async def trpc(route):
    procs = urlparse(route.request.url).path.split('/trpc/')[1].split(',')
    body = [{"result": {"data": DATA.get(p)}} for p in procs]
    await route.fulfill(status=200, body=json.dumps(body), content_type='application/json')

results = []

async def shot(b, name, w, lang, act):
    ctx = await b.new_context(**VP[w])
    await ctx.add_init_script(f"localStorage.setItem('cardhub:locale','{LOC[lang]}');"
                              f"localStorage.setItem('cardhub:session', {json.dumps(json.dumps(SESSION))});")
    await ctx.route('**/trpc/**', trpc)
    pg = await ctx.new_page()
    await pg.goto(BASE, wait_until='networkidle')
    await pg.wait_for_selector('#import-json')
    await act(pg, lang)
    await pg.evaluate('window.scrollTo(0, 0)')
    await pg.wait_for_timeout(400)
    path = f'{OUT}/{name}-{w}-{lang}.png'
    await pg.screenshot(path=path, full_page=True)
    await pg.add_script_tag(path=AXE)
    axe = await pg.evaluate("async () => (await axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,n:v.nodes.length,t:v.nodes.slice(0,3).map(x=>x.target.join(' '))}))")
    facts = await pg.evaluate("""() => {
      const se = document.scrollingElement;
      const btn = [...document.querySelectorAll('button')].find(b => ['导入','Import'].includes(b.textContent.trim()));
      return { noHscroll: se.scrollWidth <= se.clientWidth, htmlLang: document.documentElement.lang,
        importDisabled: btn ? btn.disabled : null, importDescribedby: btn ? btn.getAttribute('aria-describedby') : null,
        blocked: document.getElementById('import-blocked')?.textContent ?? null,
        hasCode: document.body.innerText.includes('TOO_MANY_SUBSETS'),
        generic: /出错了|Something went wrong/.test(document.body.innerText),
        focused: document.activeElement?.textContent?.slice(0, 60) ?? null };
    }""")
    results.append(dict(name=name, w=w, lang=lang, file=os.path.basename(path), axe=axe, **facts))
    await ctx.close()

async def preview(pg, lang):
    await pg.fill('#import-json', json.dumps(AC73, ensure_ascii=False, indent=2))
    await pg.get_by_role('button', name='预览' if lang == 'zh' else 'Preview', exact=True).click()
    await pg.wait_for_selector('#import-blocked')

async def preview_all(pg, lang):
    await preview(pg, lang)
    await pg.get_by_role('radio', name='全部' if lang == 'zh' else 'All').check(force=True)

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for w in (1440, 375):
            for lang in ('zh', 'en'):
                await shot(b, '01-too-many-subsets', w, lang, preview)
                await shot(b, '02-too-many-subsets-all', w, lang, preview_all)
        await b.close()
    json.dump(results, open(f'{OUT}/results.json', 'w'), ensure_ascii=False, indent=1)
    for r in results:
        print(r['file'], 'axe', len(r['axe']), r['axe'] or '', {k: r[k] for k in ('noHscroll','htmlLang','importDisabled','importDescribedby','blocked','hasCode','generic')})

asyncio.run(main())
