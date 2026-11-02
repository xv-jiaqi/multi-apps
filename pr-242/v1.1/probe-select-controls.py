import asyncio,json,sys,urllib.parse
from playwright.async_api import async_playwright
J="(s)=>{const t=document.querySelector(s);const c=t.getAttribute('aria-controls');return {expanded:t.getAttribute('aria-expanded'),controls:c,targetExists:c?!!document.getElementById(c):null}}"
async def m():
  async with async_playwright() as pw:
    b=await pw.chromium.launch(); ctx=await b.new_context(viewport={'width':1440,'height':900})
    async def h(route):
      procs=urllib.parse.urlparse(route.request.url).path.split('/trpc/')[1].split(',')
      out=[{'result':{'data':{'items':[{'id':'c','slug':'p','name':'P','description':None,'sortOrder':1,'seriesCount':0}]}}} if p=='categories.list' else {'result':{'data':{'items':[],'nextCursor':None}}} if p.endswith('.list') else {'result':{'data':None}} for p in procs]
      await route.fulfill(status=200,content_type='application/json',body=json.dumps(out))
    await ctx.route('**/trpc/**',h); pg=await ctx.new_page()
    for path,sel in [('/calendar','#calendar-category'),('/series','#series-category')]:
      await pg.goto(sys.argv[1]+path); await pg.wait_for_selector(sel+':not([disabled])',timeout=60000)
      a=await pg.evaluate(J,sel); await pg.locator(sel).focus(); await pg.keyboard.press('Enter'); await pg.wait_for_selector('[role=listbox]')
      o=await pg.evaluate(J,sel); o['listboxId']=await pg.evaluate("()=>document.querySelector('[role=listbox]').id")
      await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300); c=await pg.evaluate(J,sel)
      print(path,'initial',a,'| open',o,'| afterEsc',c)
    await b.close()
asyncio.run(m())
