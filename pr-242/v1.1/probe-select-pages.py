# CH-219 v1.1 19-6 + review: /series/<slug> (CountText aria-live, 3 Selects) and /trade/new.
# Local vite only; mock tRPC answers GET, any non-GET gets 405. Fake session is local-only.
import asyncio,glob,json,sys,urllib.parse
from playwright.async_api import async_playwright
BASE=sys.argv[1]; OUT=sys.argv[2] if len(sys.argv)>2 else None
AXE=glob.glob('/workspace/repos/*/node_modules/.pnpm/axe-core@*/node_modules/axe-core/axe.min.js')[0]
SLUG='celestial-dawn'
SERIES={'id':'s1','slug':SLUG,'title':'天穹黎明','description':'黎明。','coverUrl':None,'releaseDate':None,'categoryId':'c',
  'category':{'slug':'p','name':'P'},'subsets':[{'slug':'base','name':'Base'},{'slug':'promo','name':'Promo'}],
  'cards':[],'cardCount':2}
CARDS=[{'id':f'k{i}','slug':f'card-{i}','name':f'Card {i}','number':f'00{i}','rarity':'rare','imageUrl':None,'parallelOfId':None,
  'subset':{'slug':'base','name':'Base'},'attributes':{}} for i in (1,2)]
USER={'id':'u-local','username':'qa-local','role':'user','passwordChangeRecommended':False,'bannedAt':None}
def data(p):
  if p=='series.bySlug': return SERIES
  if p=='cards.listBySeries': return {'items':CARDS,'page':1,'pageSize':60,'total':2,'seriesTotal':2,'parallelCount':0,'sort':'number','attributeLabels':{}}
  if p=='auth.me': return USER
  if p=='notifications.unreadCount': return {'count':0}
  if p.startswith('comments.'): return []
  if p.endswith('.list') or p.endswith('ForSeries') or p.endswith('ForCard') or p.endswith('byCard'): return {'items':[],'nextCursor':None}
  return None
LIVE="()=>[...document.querySelectorAll('[aria-live]')].map(e=>({live:e.getAttribute('aria-live'),inRoot:document.getElementById('root').contains(e),inert:!!e.closest('[inert]')}))"
CNT="()=>document.querySelectorAll('[inert]').length"
async def m():
  async with async_playwright() as pw:
    b=await pw.chromium.launch()
    for w,lang in [(1440,'zh-CN'),(375,'zh-CN'),(1440,'en-US'),(375,'en-US')]:
      ctx=await b.new_context(viewport={'width':w,'height':900},locale=lang)
      await ctx.add_init_script(f"localStorage.setItem('cardhub:locale','{lang}');localStorage.setItem('cardhub:session',JSON.stringify({{token:'local-fake',user:{json.dumps(USER)}}}))")
      async def h(route):
        if route.request.method!='GET': return await route.fulfill(status=405)
        procs=urllib.parse.urlparse(route.request.url).path.split('/trpc/')[1].split(',')
        await route.fulfill(status=200,content_type='application/json',body=json.dumps([{'result':{'data':data(p)}} for p in procs]))
      await ctx.route('**/trpc/**',h); pg=await ctx.new_page()
      for path,name in [(f'/series/{SLUG}','series-slug'),('/trade/new','trade-new')]:
        await pg.goto(BASE+path); await pg.wait_for_selector('button[role=combobox]',state='attached',timeout=20000); await pg.wait_for_timeout(600)
        if path.startswith('/series/') and w<640: await pg.locator('button[aria-controls=series-filters]').click()
        n=await pg.locator('button[role=combobox]').count()
        for i in range(n):
          trig=pg.locator('button[role=combobox]').nth(i)
          if not await trig.is_visible(): continue
          label=await trig.evaluate("e=>e.id||e.closest('label')?.querySelector('span')?.textContent||''")
          r={'path':path,'w':w,'lang':lang,'select':i,'label':label,'liveRegions':await pg.evaluate(LIVE),'inertBefore':await pg.evaluate(CNT)}
          await trig.focus(); await pg.keyboard.press('Enter')
          await pg.wait_for_function("()=>document.activeElement?.closest('[role=listbox]')"); await pg.wait_for_timeout(400)
          r['inertWhileOpen']=await pg.evaluate(CNT)
          r['rootInert']=await pg.evaluate("()=>document.getElementById('root').hasAttribute('inert')")
          r['liveWhileOpen']=await pg.evaluate(LIVE)
          r['focusableOutsideNotInert']=await pg.evaluate("()=>[...document.querySelectorAll('#root a[href],#root button:not([disabled]),#root input,#root textarea')].filter(e=>!e.closest('[inert]')).length")
          if OUT and i==0: await pg.screenshot(path=f"{OUT}/open_{name}_{w}_{lang[:2]}.png")
          await pg.add_script_tag(path=AXE)
          r['axe']=await pg.evaluate("async()=>(await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))}))")
          tabs=[]
          for _ in range(5): await pg.keyboard.press('Tab'); tabs.append(await pg.evaluate("()=>!!document.activeElement.closest('[role=listbox]')"))
          await pg.keyboard.press('Shift+Tab'); tabs.append(await pg.evaluate("()=>!!document.activeElement.closest('[role=listbox]')"))
          r['tabStaysInListbox']=all(tabs)
          await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
          r['inertAfterEsc']=await pg.evaluate(CNT)
          r['escToTrigger']=await trig.evaluate("e=>document.activeElement===e")
          if OUT and i==0: await pg.screenshot(path=f"{OUT}/closed_{name}_{w}_{lang[:2]}.png")
          await pg.keyboard.press('Tab'); r['tabAfterClose']=await pg.evaluate("()=>{const a=document.activeElement;return {tag:a.tagName,inRoot:document.getElementById('root').contains(a)}}")
          print(json.dumps(r,ensure_ascii=False),flush=True)
      await ctx.close()
    await b.close()
asyncio.run(m())
