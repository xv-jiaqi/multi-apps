import json, urllib.parse
from playwright.sync_api import sync_playwright
AXE='/workspace/axe-local/node_modules/axe-core/axe.min.js'
out='/workspace/cardhub/qa/evidence/ch241-search-ui/extra'
with sync_playwright() as p:
    b=p.chromium.launch()
    for q in ['皮卡丘','ex -皮卡丘','zqxv不存在卡牌']:
        for lang in ['zh-CN','en-US']:
            ctx=b.new_context(viewport={'width':320,'height':700},device_scale_factor=2,is_mobile=True,has_touch=True)
            ctx.add_init_script(f"localStorage.setItem('cardhub:locale','{lang}')")
            pg=ctx.new_page(); pg.goto('http://localhost:5241/search?q='+urllib.parse.quote(q)); pg.wait_for_timeout(2500)
            sw=pg.evaluate('document.documentElement.scrollWidth')
            pg.add_script_tag(path=AXE)
            v=pg.evaluate("async () => (await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa','wcag22aa']})).violations.map(x=>x.id)")
            small=pg.evaluate("""() => [...document.querySelectorAll('main a, main button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.height<24||r.width<24)}).map(e=>e.textContent.trim().slice(0,20)+':'+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height))""")
            name=f"search-320-{'many' if 'ex' in q else ('empty' if '不存在' in q else 'success')}-{lang[:2]}.png"
            pg.screenshot(path=f'{out}/{name}')
            print(q,lang,'scrollWidth',sw,'axe',v,'small<24',small)
            ctx.close()
    b.close()
