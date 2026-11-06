# CH-221 §5 21-10/21-11/21-12 (/forum/:slug/edit). Local vite preview only; GET tRPC from fixtures,
# every non-GET (incl. forum.topics.update) gets a local 405 -- nothing is posted, nothing reaches staging.
import sys,json,asyncio
src=open(__file__.replace('probe-edit-h1.py','probe-scroll-region.py')).read().split('async def main')[0]
TAG=sys.argv[3]
exec(src)
from datetime import datetime, timedelta, timezone
USER={'id':'author-1','username':'author','role':'user','passwordChangeRecommended':False,'bannedAt':None}
NOW=datetime(2026,11,6,8,0,0,tzinfo=timezone.utc)
UNTIL=(NOW+timedelta(minutes=4)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
NOW_S=NOW.strftime('%Y-%m-%dT%H:%M:%S.000Z')
TOPIC={'id':'11111111-1111-4111-a111-111111111111','slug':'test-topic','title':'Original title','body':'Original body','pinned':False,'editedAt':None,'createdAt':NOW_S,'updatedAt':NOW_S,'editableUntil':UNTIL,'serverNow':NOW_S,'author':{'id':'author-1','username':'author'},'replyCount':0,'replies':[],'replyNextCursor':None}
_data=data
def data(p):
  if p=='auth.me': return USER
  if p=='forum.topics.bySlug': return TOPIC
  return _data(p)
async def ctxu(b,w,lang):
  ctx=await ctxfor(b,w,lang)
  await ctx.add_init_script(f"localStorage.setItem('cardhub:session',JSON.stringify({{token:'local-fake',user:{json.dumps(USER)}}}))")
  return ctx
DOM="""()=>({title:(()=>{const h=document.querySelector('main h1, main h3');const c=getComputedStyle(h);return {tag:h.tagName,text:h.textContent,fontSize:c.fontSize,lineHeight:c.lineHeight,fontWeight:c.fontWeight,letterSpacing:c.letterSpacing,height:h.getBoundingClientRect().height}})(),
 h1:[...document.querySelectorAll('h1')].map(h=>({text:h.textContent,tabindex:h.getAttribute('tabindex'),cls:h.className})),
 headings:[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>h.tagName+':'+h.textContent.trim().slice(0,30))})"""
HO="async()=>(await axe.run(document,{runOnly:{type:'rule',values:['page-has-heading-one','heading-order']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))}))"
async def main():
  out=open(f'{OUT}/{TAG}.jsonl','w')
  async with async_playwright() as p:
    b=await p.chromium.launch()
    runs=[('normal',w,l) for w in (375,1440) for l in ('zh-CN','en-US')]
    for s,w,lang in runs:
      ctx=await ctxu(b,w,lang); pg=await ctx.new_page()
      await pg.clock.set_fixed_time('2026-11-06T08:00:00Z')
      await pg.goto(f"{BASE}/forum/test-topic/edit")
      await pg.wait_for_selector('main h1, main h3',timeout=20000)
      await pg.wait_for_selector('textarea',timeout=20000); await pg.wait_for_timeout(800)
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
