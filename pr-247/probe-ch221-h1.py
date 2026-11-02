# CH-221 v1.2 21-1/21-2/21-4/21-5/21-6. Local vite preview only; GET tRPC answered from fixtures,
# every non-GET (incl. tRPC mutations) gets a local 405 -- nothing reaches staging. Clock frozen for pixel diffs.
import sys,json,asyncio
src=open(__file__.replace('probe-ch221-h1.py','probe-scroll-region.py')).read().split('async def main')[0]
sys.argv=[sys.argv[0],sys.argv[1],sys.argv[2],sys.argv[3]]; TAG=sys.argv[3]
exec(src)
def topic(slug,title,body): return {'id':'00000000-0000-0000-0000-000000000001','slug':slug,'title':title,'body':body,'pinned':False,'editedAt':None,
 'createdAt':'2026-05-01T00:00:00.000Z','updatedAt':'2026-05-01T00:00:00.000Z','editableUntil':'2026-05-01T00:05:00.000Z',
 'serverNow':'2026-11-03T00:00:00.000Z','author':{'id':'u9','username':'ada'},'replyCount':1,'replies':[],'replyNextCursor':None}
def reply(body): return {'id':'2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5','body':body,'createdAt':'2026-05-02T00:00:00.000Z','author':{'id':'u8','username':'bob'}}
SC={'s1':(topic('qa-s1','标题层级样例','导语。\n\n## 小节\n\n内容。\n\n### 细节\n\n更多内容。'),reply('## 回复小节\n\n好的。')),
    's6':(topic('qa-s6','源 h1 样例','# x\n\n正文。'),reply('# x\n\n回复。'))}
CUR={}
_data=data
def data(p):
  t,r=SC[CUR['s']]
  if p=='forum.topics.bySlug': return {**t,'replies':[r]}
  if p=='forum.replies.list': return {'items':[r],'nextCursor':None}
  return _data(p)
DOM="""()=>({title:(()=>{const h=document.querySelector('main h1, main h3');const c=getComputedStyle(h);return {tag:h.tagName,fontSize:c.fontSize,lineHeight:c.lineHeight,fontWeight:c.fontWeight,letterSpacing:c.letterSpacing,height:h.getBoundingClientRect().height}})(),h1:[...document.querySelectorAll('h1')].map(h=>({text:h.textContent,tabindex:h.getAttribute('tabindex'),cls:h.className})),
 headings:[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>h.tagName+':'+h.textContent.trim().slice(0,30))})"""
async def main():
  out=open(f'{OUT}/{TAG}.jsonl','w')
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for s in ('s1','s6'):
      CUR['s']=s
      for w in (375,1440):
        for lang in ('zh-CN','en-US'):
          ctx=await ctxfor(b,w,lang); pg=await ctx.new_page()
          await pg.clock.set_fixed_time('2026-11-03T00:00:00Z')
          await pg.goto(f"{BASE}/forum/{SC[s][0]['slug']}"); await pg.wait_for_selector('#forum-replies-title',timeout=20000)
          await pg.wait_for_selector('text=bob',timeout=20000); await pg.wait_for_timeout(800)
          await pg.evaluate("()=>{document.activeElement?.blur();window.scrollTo(0,0)}")
          await pg.screenshot(path=f"{OUT}/{TAG}_{s}_{w}_{lang[:2]}.png",full_page=True)
          d=await pg.evaluate(DOM); v=await axe(pg)
          await pg.add_script_tag(path=AXE)
          ho=await pg.evaluate("async()=>(await axe.run(document,{runOnly:{type:'rule',values:['page-has-heading-one','heading-order']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))}))")
          nonget=[x for x in ctx.reqlog if x['m']!='GET']
          r={'tag':TAG,'scenario':s,'w':w,'lang':lang,**d,'axeWcag':v,'axeHeadingRules':ho,'nonGet':nonget}
          out.write(json.dumps(r,ensure_ascii=False)+'\n'); print(TAG,s,w,lang,d['title'],len(d['h1']),d['headings'],[x['id'] for x in v],[x['id'] for x in ho],flush=True)
          await ctx.close()
    await b.close()
asyncio.run(main())
