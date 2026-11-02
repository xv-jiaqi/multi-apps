# CH-114 §6: /this-page-does-not-exist at 1440/375 x zh/en — axe, a11y tree, reading order, Tab, screenshots.
import asyncio,glob,json,sys
from playwright.async_api import async_playwright
BASE=sys.argv[1]; OUT=sys.argv[2]
AXE=glob.glob('/workspace/repos/*/node_modules/.pnpm/axe-core@*/node_modules/axe-core/axe.min.js')[0]
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for lang in ['zh-CN','en-US']:
      for w in [1440,375]:
        ctx=await b.new_context(viewport={'width':w,'height':900},locale=lang)
        async def h(route):
          if route.request.method!='GET': return await route.fulfill(status=405)
          n=route.request.url.split('/trpc/')[1].split('?')[0].count(',')+1
          await route.fulfill(status=200,content_type='application/json',body=json.dumps([{'result':{'data':None}}]*n))
        await ctx.route('**/trpc/**',h); pg=await ctx.new_page()
        await pg.goto(BASE+'/this-page-does-not-exist'); await pg.wait_for_selector('main h1',timeout=20000); await pg.wait_for_timeout(500)
        await pg.evaluate("l=>localStorage.setItem('cardhub:locale',l)",lang)
        await pg.reload(); await pg.wait_for_selector('main h1',timeout=20000); await pg.wait_for_timeout(500)
        await pg.add_script_tag(path=AXE)
        r={'path':'/this-page-does-not-exist','w':w,'lang':lang}
        r['axe']=await pg.evaluate("async()=>(await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))}))")
        r['digits']=await pg.evaluate("()=>{const p=[...document.querySelectorAll('main p')].find(e=>e.textContent.trim()==='404');return p&&{tag:p.tagName,ariaHidden:p.getAttribute('aria-hidden'),color:getComputedStyle(p).color}}")
        r['h1']=await pg.evaluate("()=>[...document.querySelectorAll('h1')].map(e=>({text:e.textContent,color:getComputedStyle(e).color}))")
        r['contrast']=await pg.evaluate("""()=>{
          const cv=document.createElement('canvas').getContext('2d');
          const rgb=c=>{cv.fillStyle='#000';cv.fillStyle=c;cv.fillRect(0,0,1,1);return [...cv.getImageData(0,0,1,1).data].slice(0,3)};
          const L=a=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(a[0])+0.7152*f(a[1])+0.0722*f(a[2])};
          const ratio=(a,b)=>{const x=L(rgb(a)),y=L(rgb(b));return +((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2)};
          const bg=c=>{for(let e=c;e;e=e.parentElement){const b=getComputedStyle(e).backgroundColor;if(b&&b!=='rgba(0, 0, 0, 0)'&&b!=='transparent')return b}return '#fff'};
          const d=[...document.querySelectorAll('main p')].find(e=>e.textContent.trim()==='404');
          const h=document.querySelector('main h1'); const a=[...document.querySelectorAll('main a[href="/"]')].pop();
          const out={};for(const [k,e] of [['digits',d],['h1',h],['homeLink',a]]){const fg=getComputedStyle(e).color,b=bg(e);out[k]={fg:rgb(fg),bg:rgb(b),ratio:ratio(fg,b)}}
          const pb=bg(h); out.pageBg=rgb(pb); return out}""")
        r['headingsInMain']=await pg.evaluate("()=>document.querySelectorAll('main h1,main h2,main h3,main h4,main h5,main h6').length")
        snap=await pg.locator('main').aria_snapshot()
        r['mainAriaSnapshot']=snap; r['ariaMentions404']='404' in snap
        link=pg.locator('main a[href="/"]').last
        r['homeLink']={'text':await link.inner_text(),'color':await link.evaluate("e=>getComputedStyle(e).color+' on '+getComputedStyle(e).backgroundColor")}
        # Tab from the top of the page until the home link in main has focus (focus-visible path)
        await pg.evaluate("()=>{document.activeElement&&document.activeElement.blur();window.focus()}")
        tabs=0; hit=False
        for i in range(40):
          await pg.keyboard.press('Tab'); tabs+=1
          if await link.evaluate("e=>e===document.activeElement"): hit=True; break
        r['homeLinkTab']={'reached':hit,'tabs':tabs,'focusVisible':await link.evaluate("e=>e.matches(':focus-visible')"),
          'boxShadow':await link.evaluate("e=>getComputedStyle(e).boxShadow"),'outline':await link.evaluate("e=>{const c=getComputedStyle(e);return c.outlineStyle+' '+c.outlineWidth+' '+c.outlineColor}")}
        if hit: await pg.screenshot(path=f"{OUT}/not-found_focus_{w}_{lang[:2]}.png")
        await pg.evaluate("()=>document.activeElement&&document.activeElement.blur()")
        await pg.screenshot(path=f"{OUT}/not-found_{w}_{lang[:2]}.png",full_page=True)
        print(json.dumps(r,ensure_ascii=False)); await ctx.close()
    await b.close()
asyncio.run(main())
