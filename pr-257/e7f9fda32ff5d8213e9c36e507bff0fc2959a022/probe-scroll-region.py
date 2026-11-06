# CH-220 v1.3 20-2/20-3/20-4/20-6/20-7/20-8. Local vite only. Mock tRPC: GET answered from fixtures;
# the only non-GET faked locally is admin.catalog.import (dry-run preview); every other non-GET gets 405.
import asyncio,glob,json,sys,urllib.parse
from playwright.async_api import async_playwright
BASE=sys.argv[1]; OUT=sys.argv[2]
AXE=(glob.glob('/workspace/wt-ch220-221/node_modules/.pnpm/axe-core@*/node_modules/axe-core/axe.min.js') or glob.glob('/workspace/repos/*/node_modules/.pnpm/axe-core@*/node_modules/axe-core/axe.min.js'))[0]
ADMIN={'id':'admin','username':'qa-admin','role':'admin','passwordChangeRecommended':False,'bannedAt':None}
LONG='很长的说明文字'*6
AUDIT=[{'id':f'a{i}','createdAt':'2026-10-27T01:02:00.000Z','action':'USER_BAN','actorId':'admin','actorUsername':'mod','targetType':'USER','targetId':'u1','targetLabel':'alice','targetUserId':'u1','targetUsername':'alice','reason':LONG} for i in range(3)]
USERS=[{'id':f'u{i}','username':f'alice{i}','email':f'alice{i}@cardhub.test','role':'user','createdAt':'2026-03-02T00:00:00.000Z','bannedAt':None,'bannedBy':None,'counts':{'topics':1,'replies':2,'comments':3,'listings':4}} for i in range(3)]
SER=[{'id':'s2','slug':'forge-of-titans','title':'泰坦熔炉','description':None,'coverUrl':None,'cardCount':2,'commentCount':0,'createdAt':'2026-01-01T00:00:00.000Z','updatedAt':'2026-05-02T08:00:00.000Z'}]
CATS=[{'slug':'pokemon','name':'宝可梦','seriesCount':3,'sortOrder':1},{'slug':'ygo','name':'游戏王','seriesCount':1,'sortOrder':2}]
CARDS=[{'id':f'k{i}','slug':f'card-{i}','name':f'卡牌 {i}','rarity':'rare','imageUrl':None,'parallelName':None,'printRun':None,'parallelOfId':None,'cardNumber':str(i),'number':str(i),'subset':None,'attributes':{}} for i in (1,2)]
REL=[{'id':'r1','title':'春季补充包','releaseDate':'2026-12-06','datePrecision':'DAY','region':'CN','series':{'slug':'forge-of-titans','title':'泰坦熔炉'},'seriesId':'s2','categoryId':None,'category':None,'note':LONG,'sourceUrl':None,'createdAt':'2026-01-01T00:00:00.000Z','updatedAt':'2026-01-01T00:00:00.000Z'}]
BODY="正文。\n\n| 列一 | 列二 | 列三 | 列四 |\n|---|---|---|---|\n| "+' | '.join(['很长很长的单元格内容'*2]*4)+" |\n\n```\nconst qa = 'code block with a very long line that should scroll inside its own container ..........';\n```\n"
CARD={'id':'c1','slug':'aurora-knight','name':'极光骑士','description':'黎明降临。','imageUrl':None,'rarity':'rare','seriesSlug':'forge-of-titans','seriesTitle':'泰坦熔炉','cardNumber':None,'attributes':{},'printRun':None,'parallelName':None,'isParallel':False,'base':None,'subset':None,'body':BODY,'adjacent':{'prev':None,'next':None},'variants':[]}
IMPORT=[{'row':{'row':i,'type':'series','slug':f'series-with-a-long-slug-{i}','name':'天穹黎明'+LONG},'status':'create','errors':[]} for i in range(3)]
def data(p):
  return {'auth.me':ADMIN,'notifications.unreadCount':{'count':0},
   'admin.audit.list':{'items':AUDIT,'nextCursor':None},'admin.users.list':{'items':USERS,'total':3,'nextCursor':None},
   'admin.series.list':{'items':SER},'admin.categories.list':{'items':CATS},
   'series.bySlug':{**SER[0],'cards':CARDS,'subsets':[],'category':None,'categoryId':None,'releaseDate':None},
   'admin.releases.list':{'items':REL,'nextCursor':None},'cards.bySlug':CARD,
   'listings.byCard':[],'collection.byCard':None,
   'comments.listForCard':[],'comments.listForSeries':{'items':[],'nextCursor':None}}.get(p)
REGION="""el=>{const r=el.getBoundingClientRect();const id=el.getAttribute('aria-labelledby');
 const clip=[];let a=el.parentElement;while(a&&a!==document.documentElement){const s=getComputedStyle(a);
  if(s.overflowX!=='visible'||s.overflowY!=='visible'){const q=a.getBoundingClientRect();
   const pad=4;if(r.left-pad<q.left||r.right+pad>q.right||r.top-pad<q.top||r.bottom+pad>q.bottom)clip.push(a.tagName+'.'+a.className.slice(0,40))}a=a.parentElement}
 return {role:el.getAttribute('role'),tabindex:el.getAttribute('tabindex'),labelledby:id,label:el.getAttribute('aria-label'),
  name:id?document.getElementById(id)?.textContent.trim():el.getAttribute('aria-label'),
  scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,focusVisible:el.matches(':focus-visible'),
  boxShadow:getComputedStyle(el).boxShadow,clippedBy:clip}}"""
async def tab_to(pg,loc,limit=120):
  await pg.evaluate("()=>{document.activeElement?.blur();window.scrollTo(0,0)}")
  h=await loc.element_handle()
  for i in range(limit):
    await pg.keyboard.press('Tab')
    if await pg.evaluate("e=>document.activeElement===e",h): return i+1
  return None
PAGES=[('/admin/audit','audit','#admin-audit-title'),('/admin/users','users','#admin-users-title'),
 ('/admin/catalog','catalog-series','#admin-series-title'),('/admin/catalog/categories','catalog-categories','#admin-categories-title'),
 ('/admin/catalog/series/forge-of-titans','series-detail','#admin-series-detail-title'),('/admin/releases','releases','#admin-releases-title'),
 ('/admin/catalog/import','import',None),('/cards/aurora-knight','card-detail',None)]
async def ctxfor(b,w,lang,hold=None):
  ctx=await b.new_context(viewport={'width':w,'height':900},locale=lang)
  await ctx.add_init_script(f"localStorage.setItem('cardhub:locale','{lang}');localStorage.setItem('cardhub:session',JSON.stringify({{token:'local-fake',user:{json.dumps(ADMIN)}}}))")
  log=ctx.reqlog=[]
  async def h(route):
    req=route.request; procs=urllib.parse.urlparse(req.url).path.split('/trpc/')[1].split(',')
    log.append({'m':req.method,'procs':procs})
    if req.method!='GET':
      if procs==['admin.catalog.import']: return await route.fulfill(status=200,content_type='application/json',body=json.dumps([{'result':{'data':IMPORT}}]))
      return await route.fulfill(status=405)
    if hold and any(p in hold['procs'] for p in procs): await hold['ev'].wait()
    await route.fulfill(status=200,content_type='application/json',body=json.dumps([{'result':{'data':data(p)}} for p in procs]))
  await ctx.route('**/trpc/**',h); return ctx
async def axe(pg):
  await pg.add_script_tag(path=AXE)
  return await pg.evaluate("async()=>(await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))}))")
async def main():
  fa=open(f'{OUT}/axe.jsonl','w'); fr=open(f'{OUT}/regions.jsonl','w')
  async with async_playwright() as pw:
    b=await pw.chromium.launch()
    for w,lang in [(375,'zh-CN'),(375,'en-US'),(1440,'zh-CN'),(1440,'en-US')]:
      ctx=await ctxfor(b,w,lang); pg=await ctx.new_page()
      for path,name,h1 in PAGES:
        await pg.goto(BASE+path); await pg.wait_for_selector('main h1',timeout=20000)
        if name=='import':
          await pg.locator('summary').click()
          await pg.fill('#import-json',await pg.locator('details pre').inner_text())
          await pg.get_by_role('button',name='预览' if lang=='zh-CN' else 'Preview',exact=False).first.click()
          await pg.wait_for_selector('#import-preview-title')
        await pg.wait_for_selector('[role=region]',timeout=20000); await pg.wait_for_timeout(500)
        regs=pg.locator('main [role=region]'); n=await regs.count()
        await pg.evaluate("()=>{document.activeElement?.blur()}")
        ax=await axe(pg); fa.write(json.dumps({'page':name,'path':path,'w':w,'lang':lang,'violations':ax},ensure_ascii=False)+'\n')
        for i in range(n):
          loc=regs.nth(i); tabs=await tab_to(pg,loc); r=await loc.evaluate(REGION)
          r.update({'page':name,'w':w,'lang':lang,'idx':i,'tabsToReach':tabs})
          if w==375:
            before=await loc.evaluate('e=>e.scrollLeft')
            for _ in range(5): await pg.keyboard.press('ArrowRight')
            await pg.wait_for_timeout(200); mid=await loc.evaluate('e=>e.scrollLeft')
            for _ in range(5): await pg.keyboard.press('ArrowLeft')
            await pg.wait_for_timeout(200); r['scrollLeft']=[before,mid,await loc.evaluate('e=>e.scrollLeft')]
            await loc.evaluate('e=>e.scrollLeft=0')
          if (w,lang) in [(375,'zh-CN'),(1440,'en-US')]:
            await loc.scroll_into_view_if_needed(); bb=await loc.bounding_box()
            vw=w; y=max(bb['y']-24,0)
            await pg.screenshot(path=f"{OUT}/focus_{name}_{i}_{w}_{lang[:2]}.png",clip={'x':0,'y':y,'width':vw,'height':min(bb['height']+48,900-y)})
          fr.write(json.dumps(r,ensure_ascii=False)+'\n'); print(json.dumps(r,ensure_ascii=False)[:400],flush=True)
        print(name,w,lang,'axe',[v['id'] for v in ax],flush=True)
      fr.write(json.dumps({'nonGET':[x for x in ctx.reqlog if x['m']!='GET'],'w':w,'lang':lang},ensure_ascii=False)+'\n')
      await ctx.close()
    # 20-7 standalone skeletons, 20-8 inline skeleton rows: hold the list responses at 375.
    for lang in ['zh-CN','en-US']:
      for path,name,procs,kind in [('/admin/releases','releases',['admin.releases.list'],'skeleton'),
                                   ('/admin/catalog/series/forge-of-titans','series-detail',['admin.series.list','series.bySlug'],'skeleton'),
                                   ('/admin/catalog','catalog-series',['admin.series.list'],'skeleton'),
                                   ('/admin/audit','audit',['admin.audit.list'],'inline'),('/admin/users','users',['admin.users.list'],'inline')]:
        hold={'procs':procs,'ev':asyncio.Event()}; ctx=await ctxfor(b,375,lang,hold); pg=await ctx.new_page()
        await pg.goto(BASE+path); await pg.wait_for_selector('table[aria-busy=true]',timeout=20000); await pg.wait_for_timeout(400)
        frame=pg.locator('table[aria-busy=true]').locator('xpath=..')
        r={'check':'20-7' if kind=='skeleton' else '20-8','page':name,'lang':lang,'loading':await frame.evaluate(REGION)}
        await frame.evaluate('e=>{window.__frame=e}')
        await pg.screenshot(path=f"{OUT}/loading_{name}_375_{lang[:2]}.png")
        if kind=='inline':
          r['loadingAxe']=[v['id'] for v in await axe(pg)]
          hold['ev'].set(); await pg.wait_for_selector('table:not([aria-busy])'); await pg.wait_for_timeout(300)
          reg=pg.locator('main [role=region]').first
          r['loaded']=await reg.evaluate(REGION); r['sameElement']=await reg.evaluate('e=>e===window.__frame')
          await pg.screenshot(path=f"{OUT}/loaded_{name}_375_{lang[:2]}.png")
        else:
          r['regionsWhileLoading']=await pg.locator('main [role=region]').count()
          r['doc']=await pg.evaluate('()=>({scrollWidth:document.documentElement.scrollWidth,viewport:window.innerWidth})')
          r['pass']=r['doc']['scrollWidth']<=r['doc']['viewport'] and r['regionsWhileLoading']==0
          hold['ev'].set()
        fr.write(json.dumps(r,ensure_ascii=False)+'\n'); print(json.dumps(r,ensure_ascii=False)[:600],flush=True)
        await ctx.close()
    await b.close()
asyncio.run(main())
