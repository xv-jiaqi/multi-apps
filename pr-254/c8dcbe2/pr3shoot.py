# CH-305 step 2 shots: local pnpm dev servers, tRPC mocked from local fixtures; non-GET fulfilled locally.
import asyncio, json, glob, sys, urllib.parse
from playwright.async_api import async_playwright
OUT='/workspace/ch305/pr3'; D=json.load(open('fixtures.json')); FX=D['fx']; P=D['paths']
AXE=glob.glob('/workspace/wt-305-pr2/node_modules/.pnpm/axe-core@*/node_modules/axe-core/axe.min.js')[0]
USER={'id':'u-1','username':'qa_user','role':'user'}; ADMIN={'id':'u-2','username':'qa_admin','role':'admin'}
def empty(o):
    if isinstance(o,dict): return {k:([] if k=='items' else empty(v)) for k,v in o.items()}
    return o
def handler(mode,user):
    async def h(route):
        r=route.request; u=r.url
        if r.method!='GET':
            return await route.fulfill(status=200 if '/trpc/' in u else 204,content_type='application/json',body=json.dumps([{'result':{'data':None}}]) if '/trpc/' in u else '')
        if 'fake-api.local' in u:
            pu=urllib.parse.urlparse(u); procs=pu.path.split('/trpc/')[1].split(','); inp=json.loads(urllib.parse.parse_qs(pu.query).get('input',['{}'])[0])
            if mode=='loading' and procs!=['auth.me']: await asyncio.sleep(60); return
            if mode=='error' and procs!=['auth.me']:
                return await route.fulfill(status=500,content_type='application/json',body=json.dumps([{'error':{'json':{'message':'boom','code':-32603,'data':{'code':'INTERNAL_SERVER_ERROR','httpStatus':500,'path':p}}},'error_message':'boom'} for p in procs]).replace(',"error_message": "boom"',''))
            out=[]
            for i,p in enumerate(procs):
                if p=='auth.me': out.append({'result':{'data':user}}); continue
                m=FX.get(p,{}); k=json.dumps(inp.get(str(i)),sort_keys=True)
                v=m.get(k) or (next(iter(m.values())) if m else {'result':{'data':None}})
                out.append(empty(v) if mode=='empty' else v)
            return await route.fulfill(status=200,content_type='application/json',body=json.dumps(out))
        if u.startswith('http://127.0.0.1') or u.startswith('data:'): return await route.continue_()
        return await route.abort()
    return h
CASES=[('register','/register',None,'success'),('login','/login',None,'success'),
 ('forum-list','/forum',None,'success'),('forum-list-empty','/forum',None,'empty'),('forum-list-loading','/forum',None,'loading'),('forum-list-error','/forum',None,'error'),
 ('forum-detail',P['forum'],USER,'success'),('trade-publish','/trade/new',USER,'success'),('topic-new','/forum/new',USER,'success'),
 ('admin-series-new','/admin/catalog/series/new',ADMIN,'success'),('admin-category-new','/admin/catalog/categories/new',ADMIN,'success'),('admin-release-new','/admin/releases/new',ADMIN,'success'),('admin-import','/admin/catalog/import',ADMIN,'success')]
PROBE="""()=>{const hx=c=>{const m=c.match(/\\d+(\\.\\d+)?/g);return m?'#'+m.slice(0,3).map(x=>(+x).toString(16).padStart(2,'0')).join(''):c};
 const ctl=[...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select,[role=combobox]')].filter(e=>e.offsetParent);
 const mut=[...document.querySelectorAll('.text-muted')].filter(e=>e.offsetParent);
 return {controls:ctl.map(e=>hx(getComputedStyle(e).borderTopColor)),muted:[...new Set(mut.map(e=>hx(getComputedStyle(e).color)))],mutedN:mut.length}}"""
async def shot(b,base,tag,name,path,user,mode,w,lang,scheme):
    ctx=await b.new_context(viewport={'width':w,'height':900},device_scale_factor=1,is_mobile=w==375,service_workers='block',color_scheme=scheme)
    init=f"localStorage.setItem('cardhub:locale','{'zh-CN' if lang=='zh' else 'en-US'}');"
    if user: init+=f"localStorage.setItem('cardhub:session',{json.dumps(json.dumps({'token':'t','user':user}))});"
    if scheme=='dark': init+="document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('dark'));"
    await ctx.add_init_script(init); await ctx.route('**/*',handler(mode,user)); pg=await ctx.new_page()
    await pg.goto(base+path,timeout=90000); await pg.wait_for_timeout(3000 if mode!='error' else 6000)
    f=f"{OUT}/{name}_{tag}_{scheme}_{w}_{lang}.png"; await pg.screenshot(path=f,full_page=True)
    r={'shot':f.split('/')[-1],'url':pg.url.replace(base,''),'scheme':scheme,'htmlDark':await pg.evaluate("document.documentElement.classList.contains('dark')"),
       'prefersDark':await pg.evaluate("matchMedia('(prefers-color-scheme: dark)').matches"),'bodyBg':await pg.evaluate("getComputedStyle(document.body).backgroundColor"),**await pg.evaluate(PROBE)}
    sel='input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea'
    el=pg.locator(sel).locator('visible=true').first
    if tag=='pr' and mode=='success' and await el.count():
        await el.scroll_into_view_if_needed(); await el.focus(); await pg.wait_for_timeout(400)
        r['focus']=await el.evaluate("e=>{const s=getComputedStyle(e);return {fv:e.matches(':focus-visible'),border:s.borderTopColor,shadow:s.boxShadow}}")
        bb=await el.bounding_box(); clip={'x':0,'y':max(0,bb['y']-60),'width':w,'height':min(900,bb['height']+120)}
        ff=f"{OUT}/{name}_{tag}_{scheme}_focus_{w}_{lang}.png"; await pg.screenshot(path=ff,clip=clip); r['focusShot']=ff.split('/')[-1]
        await el.evaluate("e=>e.blur()")
        await pg.evaluate("s=>document.querySelectorAll(s).forEach(e=>e.setAttribute('aria-invalid','true'))",sel); await pg.wait_for_timeout(300)
        r['invalid']=await pg.evaluate("s=>[...new Set([...document.querySelectorAll(s)].filter(e=>e.offsetParent).map(e=>getComputedStyle(e).borderTopColor))]",sel)
        fi=f"{OUT}/{name}_{tag}_{scheme}_invalid_{w}_{lang}.png"; await pg.screenshot(path=fi,full_page=True); r['invalidShot']=fi.split('/')[-1]
        await pg.evaluate("s=>document.querySelectorAll(s).forEach(e=>e.removeAttribute('aria-invalid'))",sel)
    await pg.add_script_tag(path=AXE)
    r['axe']=await pg.evaluate("async()=>(await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa','wcag22aa']})).violations.map(v=>({id:v.id,n:v.nodes.length,t:v.nodes.slice(0,3).map(x=>x.target.join(' '))}))")
    await ctx.close(); return r
async def main():
    base,tag=sys.argv[1],sys.argv[2]; res=[]
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for c in CASES:
            for w in (1440,375):
                for lang in ('zh','en'):
                    for sc in ('light','dark'): res.append(await shot(b,base,tag,*c,w,lang,sc))
        await b.close()
    json.dump(res,open(f'{OUT}/{tag}-results.json','w'),ensure_ascii=False,indent=1)
asyncio.run(main())
