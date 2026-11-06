# CH-225 §4 25-2/25-4/25-6 (/trade/new). Local vite only, fake local session.
# tRPC GET answered from local fixtures; every non-GET (listings.publish, any mutation) gets a local 405.
# Nothing is published, nothing reaches staging.
import sys,json,asyncio,glob,urllib.parse
from playwright.async_api import async_playwright
BASE=sys.argv[1]; OUT=sys.argv[2]; TAG=sys.argv[3]
AXE=glob.glob('/workspace/wt-ch225/node_modules/.pnpm/axe-core@*/node_modules/axe-core/axe.min.js')[0]
USER={'id':'u1','username':'alice','role':'user','passwordChangeRecommended':False,'bannedAt':None}
def data(p): return {'auth.me':USER,'notifications.unreadCount':{'count':0}}.get(p)
DOM="""()=>[...document.querySelectorAll('main button[role=combobox]')].map(b=>{const c=getComputedStyle(b);return {name:b.closest('label')?.querySelector('span')?.textContent,ariaInvalid:b.getAttribute('aria-invalid'),describedby:b.getAttribute('aria-describedby'),borderColor:c.borderTopColor,rect:b.getBoundingClientRect().toJSON()}})"""
async def main():
  out=open(f'{OUT}/{TAG}.jsonl','w')
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for w in (375,1440):
      for lang in ('zh-CN','en-US'):
        ctx=await b.new_context(viewport={'width':w,'height':900},locale=lang)
        await ctx.add_init_script(f"localStorage.setItem('cardhub:locale','{lang}');localStorage.setItem('cardhub:session',JSON.stringify({{token:'local-fake',user:{json.dumps(USER)}}}))")
        log=[]
        async def h(route):
          req=route.request; procs=urllib.parse.urlparse(req.url).path.split('/trpc/')[1].split(',')
          log.append({'m':req.method,'procs':procs})
          if req.method!='GET': return await route.fulfill(status=405)
          await route.fulfill(status=200,content_type='application/json',body=json.dumps([{'result':{'data':data(p)}} for p in procs]))
        await ctx.route('**/trpc/**',h)
        async def other(route):
          if route.request.method!='GET': log.append({'m':route.request.method,'url':route.request.url}); return await route.fulfill(status=405)
          await route.continue_()
        await ctx.route(lambda u:'/trpc/' not in u,other)
        pg=await ctx.new_page(); await pg.goto(f'{BASE}/trade/new')
        await pg.wait_for_selector('main button[role=combobox]',timeout=60000); await pg.wait_for_timeout(1000)
        await pg.evaluate("()=>{document.activeElement?.blur();window.scrollTo(0,0)}")
        await pg.screenshot(path=f'{OUT}/{TAG}_valid_{w}_{lang[:2]}.png',full_page=True)
        d=await pg.evaluate(DOM); await pg.add_script_tag(path=AXE)
        v=await pg.evaluate("async()=>(await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))}))")
        nonget=[x for x in log if x['m']!='GET']
        r={'tag':TAG,'w':w,'lang':lang,'selects':d,'axeWcag':v,'nonGet':nonget,'trpc':log}
        out.write(json.dumps(r,ensure_ascii=False)+'\n'); print(TAG,w,lang,[(x['name'],x['ariaInvalid'],x['borderColor']) for x in d],[x['id'] for x in v],nonget,flush=True)
        await ctx.close()
    await b.close()
asyncio.run(main())
