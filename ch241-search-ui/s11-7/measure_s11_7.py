import json, sys
from pathlib import Path
sys.path.insert(0, '/workspace/cardhub/qa/scripts')
from cut7_search import measure_s11_7_first_row_top
from playwright.sync_api import sync_playwright

class LocalHttp:
    urls = {"web": "http://localhost:5241"}

ev = Path('/workspace/cardhub/qa/evidence/ch241-search-ui/s11-7')
with sync_playwright() as p:
    browser = p.chromium.launch()
    def new_page(w, h, lang="zh", mobile=False):
        locale = "zh-CN" if lang.startswith("zh") else "en"
        kw = {"viewport": {"width": w, "height": h}}
        if mobile:
            kw.update({"device_scale_factor": 2, "is_mobile": True, "has_touch": True})
        ctx = browser.new_context(**kw)
        ctx.add_init_script(f"localStorage.setItem('cardhub:locale','{locale}')")
        return ctx, ctx.new_page()
    res = measure_s11_7_first_row_top(browser, LocalHttp(), ev, {}, new_page)
    browser.close()
(ev / 'result.json').write_text(json.dumps(res, ensure_ascii=False, indent=2))
for v in res['detail']['views']:
    print(v['viewport'], 'first', v.get('first_top'), 'done', v.get('done_top'), 'delta', v.get('delta_px'), 'ok', v['ok'], v.get('heading_first'), '->', v.get('heading_done'))
print('OK', res['ok'])
