# CH-224 §4 24-1/24-2/24-4/24-5 (/login, /register). Local vite only, anonymous (no session).
# tRPC GET answered from local fixtures; every non-GET (auth.login, auth.register, any mutation) gets a local 405.
# Nothing is submitted, nothing reaches staging.
import sys,json,asyncio,glob,urllib.parse
from playwright.async_api import async_playwright
BASE=sys.argv[1]; OUT=sys.argv[2]; TAG=sys.argv[3]
AXE=glob.glob('/workspace/wt-ch224/node_modules/.pnpm/axe-core@*/node_modules/axe-core/axe.min.js')[0]
def data(p): return {'notifications.unreadCount':{'count':0}}.get(p)
async def ctxfor(b,w,lang,notice=None):
  ctx=await b.new_context(viewport={'width':w,'height':900},locale=lang)
  init=f"localStorage.setItem('cardhub:locale','{lang}');localStorage.removeItem('cardhub:session');"
  if notice: init+=f"if(location.pathname==='/login'&&!sessionStorage.getItem('n')){{sessionStorage.setItem('n','1');history.replaceState({{usr:{{notice:'{notice}'}},key:'qa',idx:0}},'')}}"
  await ctx.add_init_script(init)
  log=ctx.reqlog=[]
  async def h(route):
    req=route.request; procs=urllib.parse.urlparse(req.url).path.split('/trpc/')[1].split(',')
    log.append({'m':req.method,'procs':procs})
    if req.method!='GET': return await route.fulfill(status=405)
    await route.fulfill(status=200,content_type='application/json',body=json.dumps([{'result':{'data':data(p)}} for p in procs]))
  await ctx.route('**/trpc/**',h)
  async def other(route):
    if route.request.method!='GET': log.append({'m':route.request.method,'url':route.request.url}); return await route.fulfill(status=405)
    await route.continue_()
  await ctx.route(lambda u: '/trpc/' not in u, other)
  return ctx
DOM="""()=>({title:(()=>{const h=document.querySelector('main h1, main h3');const c=getComputedStyle(h);return {tag:h.tagName,text:h.textContent,cls:h.className,fontSize:c.fontSize,lineHeight:c.lineHeight,fontWeight:c.fontWeight,letterSpacing:c.letterSpacing,rect:h.getBoundingClientRect().toJSON()}})(),
 h1:[...document.querySelectorAll('h1')].map(h=>({text:h.textContent,tabindex:h.getAttribute('tabindex'),cls:h.className})),
 headings:[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>h.tagName+':'+h.textContent.trim().slice(0,30)),
 status:(()=>{const s=document.querySelector('main [role=status]');return s?{text:s.textContent,focused:document.activeElement===s,afterTitle:!!(document.querySelector('main h1, main h3').compareDocumentPosition(s)&4)}:null})(),
 docTitle:document.title})"""
HO="async()=>(await axe.run(document,{runOnly:{type:'rule',values:['page-has-heading-one','heading-order']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))}))"
WC="async()=>(await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))}))"
async def main():
  out=open(f'{OUT}/{TAG}.jsonl','w')
  async with async_playwright() as p:
    b=await p.chromium.launch()
    runs=[(pg,'normal',w,l) for pg in ('login','register') for w in (375,1440) for l in ('zh-CN','en-US')]
    runs+=[('login','signedOutAll',w,l) for w in (375,1440) for l in ('zh-CN','en-US')]
    for page,s,w,lang in runs:
      ctx=await ctxfor(b,w,lang,'signedOutAll' if s=='signedOutAll' else None); pg=await ctx.new_page()
      await pg.goto(f"{BASE}/{page}")
      await pg.wait_for_selector('main h1, main h3',timeout=60000); await pg.wait_for_selector('form input',timeout=60000)
      if s=='signedOutAll': await pg.wait_for_selector('main [role=status]',timeout=60000)
      await pg.wait_for_timeout(800)
      d=await pg.evaluate(DOM)  # read focus before blur
      if s=='normal': await pg.evaluate("()=>{document.activeElement?.blur();window.scrollTo(0,0)}")
      await pg.screenshot(path=f"{OUT}/{TAG}_{page}_{s}_{w}_{lang[:2]}.png",full_page=True)
      await pg.add_script_tag(path=AXE); ho=await pg.evaluate(HO); v=await pg.evaluate(WC)
      nonget=[x for x in ctx.reqlog if x['m']!='GET']
      r={'tag':TAG,'page':page,'scenario':s,'w':w,'lang':lang,**d,'axeHeadingRules':ho,'axeWcag':v,'nonGet':nonget,'trpc':ctx.reqlog}
      out.write(json.dumps(r,ensure_ascii=False)+'\n'); print(TAG,page,s,w,lang,{k:d['title'][k] for k in ('tag','text','fontSize','lineHeight','fontWeight','letterSpacing')},len(d['h1']),d['status'],[x['id'] for x in ho],[x['id'] for x in v],nonget,flush=True)
      await ctx.close()
    await b.close()
asyncio.run(main())
