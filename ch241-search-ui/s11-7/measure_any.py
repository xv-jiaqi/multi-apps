import sys, urllib.parse
sys.path.insert(0, '/workspace/cardhub/qa/scripts')
from cut7_search import FIRST_ROW_JS
from playwright.sync_api import sync_playwright
paths=[('皮卡丘',''),('皮卡丘','&page=2'),('ex -皮卡丘',''),('ex -皮卡丘','&page=3'),('皮卡丘 OR 喷火龙',''),('皮卡丘 OR 周年','&page=2')]
vps=[(1440,900,False),(1350,940,False),(640,900,False),(375,812,True),(320,700,True)]
worst=0
with sync_playwright() as p:
    b=p.chromium.launch()
    for q,extra in paths:
      for w,h,m in vps:
        for lang in ['zh-CN','en-US']:
            kw={"viewport":{"width":w,"height":h}}
            if m: kw.update({"device_scale_factor":2,"is_mobile":True,"has_touch":True})
            ctx=b.new_context(**kw); ctx.add_init_script(f"localStorage.setItem('cardhub:locale','{lang}')")
            pg=ctx.new_page(); held=[]
            pg.route("**/trpc/**", lambda r: held.append(r) if 'search.global' in r.request.url else r.continue_())
            pg.goto("http://localhost:5241/search?q="+urllib.parse.quote(q)+extra); pg.wait_for_timeout(800)
            a=pg.evaluate(FIRST_ROW_JS)
            for r in held: r.continue_()
            pg.unroute("**/trpc/**"); pg.wait_for_selector('main a[href^="/cards/"]'); pg.wait_for_timeout(400)
            d=pg.evaluate(FIRST_ROW_JS)
            top=pg.evaluate("() => !!document.querySelector('nav[aria-label=\"顶部分页\"], nav[aria-label=\"Top pagination\"]')?.offsetParent")
            ser=pg.evaluate("() => !!document.getElementById('sr-series')")
            delta=round(d['firstRowTop']-a['firstRowTop'])
            if not ser: worst=max(worst,abs(delta))
            print(f"{q}{extra} | {w} | {lang} | {a['firstRowTop']:.0f}->{d['firstRowTop']:.0f} | delta {delta} | topNav {top} | series {ser} | {d['heading']} | firstHeadingDigit {a['headingHasDigit']}")
            ctx.close()
    b.close()
print('max |delta| without series section:', worst)
