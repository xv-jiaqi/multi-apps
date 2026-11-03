# CH-221 §4 21-7/21-8/21-9 (/forum/new). Local vite preview only; GET tRPC from fixtures,
# every non-GET (incl. forum.topics.create) gets a local 405 -- nothing is posted, nothing reaches staging.
import sys,json,asyncio
src=open(__file__.replace('probe-ch221-new.py','probe-scroll-region.py')).read().split('async def main')[0]
TAG=sys.argv[3]
exec(src)
USER={'id':'u1','username':'qa_user','role':'user','passwordChangeRecommended':False,'bannedAt':None}
BANNED={**USER,'bannedAt':'2026-10-27T00:00:00.000Z'}
CUR={'u':USER}
_data=data
def data(p):
  if p=='auth.me': return CUR['u']
  return _data(p)
async def ctxu(b,w,lang):
  ctx=await ctxfor(b,w,lang)
  await ctx.add_init_script(f"localStorage.setItem('cardhub:session',JSON.stringify({{token:'local-fake',user:{json.dumps(CUR['u'])}}}))")
  return ctx
DOM="""()=>({title:(()=>{const h=document.querySelector('main h1, main h3');const c=getComputedStyle(h);return {tag:h.tagName,text:h.textContent,fontSize:c.fontSize,lineHeight:c.lineHeight,fontWeight:c.fontWeight,letterSpacing:c.letterSpacing,height:h.getBoundingClientRect().height}})(),
 h1:[...document.querySelectorAll('h1')].map(h=>({text:h.textContent,tabindex:h.getAttribute('tabindex'),cls:h.className})),
 headings:[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>h.tagName+':'+h.textContent.trim().slice(0,30))})"""
HO="async()=>(await axe.run(document,{runOnly:{type:'rule',values:['page-has-heading-one','heading-order']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))}))"
async def main():
  out=open(f'{OUT}/{TAG}.jsonl','w')
  async with async_playwright() as p:
    b=await p.chromium.launch()
    runs=[('normal',w,l) for w in (375,1440) for l in ('zh-CN','en-US')]+[('banned',375,'zh-CN')]
    for s,w,lang in runs:
      CUR['u']=BANNED if s=='banned' else USER
      ctx=await ctxu(b,w,lang); pg=await ctx.new_page()
      await pg.clock.set_fixed_time('2026-11-03T00:00:00Z')
      await pg.goto(f"{BASE}/forum/new")
      await pg.wait_for_selector('main h1, main h3',timeout=20000)
      await pg.wait_for_selector('text=返回论坛' if s=='banned' else 'textarea',timeout=20000); await pg.wait_for_timeout(800)
      await pg.evaluate("()=>{document.activeElement?.blur();window.scrollTo(0,0)}")
      await pg.screenshot(path=f"{OUT}/{TAG}_{s}_{w}_{lang[:2]}.png",full_page=True)
      d=await pg.evaluate(DOM); v=await axe(pg); ho=await pg.evaluate(HO)
      prev=None
      if s=='normal':
        await pg.locator('textarea').last.fill('# x\n## y')
        await pg.get_by_role('button',name='预览' if lang=='zh-CN' else 'Preview',exact=True).click()
        await pg.wait_for_timeout(500)
        prev=await pg.evaluate("()=>({h1:document.querySelectorAll('h1').length,headings:[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>h.tagName+':'+h.textContent.trim().slice(0,30))})")
        prev['axeHeadingRules']=await pg.evaluate(HO)
      nonget=[x for x in ctx.reqlog if x['m']!='GET']
      r={'tag':TAG,'scenario':s,'w':w,'lang':lang,**d,'axeWcag':v,'axeHeadingRules':ho,'preview':prev,'nonGet':nonget}
      out.write(json.dumps(r,ensure_ascii=False)+'\n'); print(TAG,s,w,lang,d['title'],len(d['h1']),[x['id'] for x in v],[x['id'] for x in ho],prev,nonget,flush=True)
      await ctx.close()
    await b.close()
asyncio.run(main())
