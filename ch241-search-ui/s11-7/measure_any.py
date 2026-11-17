import sys, urllib.parse
sys.path.insert(0, '/workspace/cardhub/qa/scripts')
from cut7_search import FIRST_ROW_JS
from playwright.sync_api import sync_playwright
cases=[(q,w,h,m,l) for q in ['ex -皮卡丘','皮卡丘'] for (w,h,m) in [(375,812,True),(320,700,True),(1440,900,False)] for l in ['zh','en']]
with sync_playwright() as p:
    b=p.chromium.launch()
    for q,w,h,m,lang in cases:
        kw={"viewport":{"width":w,"height":h}}
        if m: kw.update({"device_scale_factor":2,"is_mobile":True,"has_touch":True})
        ctx=b.new_context(**kw); ctx.add_init_script(f"localStorage.setItem('cardhub:locale','{'zh-CN' if lang=='zh' else 'en-US'}')")
        pg=ctx.new_page(); held=[]
        pg.route("**/trpc/**", lambda r: held.append(r) if 'search.global' in r.request.url else r.continue_())
        pg.goto("http://localhost:5241/search?q="+urllib.parse.quote(q)); pg.wait_for_timeout(800)
        a=pg.evaluate(FIRST_ROW_JS)
        for r in held: r.continue_()
        pg.unroute("**/trpc/**"); pg.wait_for_selector('main a[href^="/cards/"]'); pg.wait_for_timeout(400)
        d=pg.evaluate(FIRST_ROW_JS)
        print(q,w,lang,'delta',round(d['firstRowTop']-a['firstRowTop']),d['heading'])
        ctx.close()
    b.close()
