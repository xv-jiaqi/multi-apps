import asyncio,glob,json,sys,urllib.parse
from playwright.async_api import async_playwright
BASE=sys.argv[1]
AXE=glob.glob('/workspace/repos/*/node_modules/.pnpm/axe-core@*/node_modules/axe-core/axe.min.js')[0]
AE="()=>{const a=document.activeElement;return a.tagName+(a.id?'#'+a.id:'')+' role='+a.getAttribute('role')+' inListbox='+!!a.closest('[role=listbox]')}"
async def m():
  async with async_playwright() as pw:
    b=await pw.chromium.launch()
    for w,lang in [(1440,'zh-CN'),(375,'zh-CN'),(1440,'en-US'),(375,'en-US')]:
      ctx=await b.new_context(viewport={'width':w,'height':900},locale=lang)
      await ctx.add_init_script(f"localStorage.setItem('cardhub:locale','{lang}')")
      async def h(route):
        if route.request.method!='GET': return await route.fulfill(status=405)
        procs=urllib.parse.urlparse(route.request.url).path.split('/trpc/')[1].split(',')
        out=[{'result':{'data':{'items':[{'id':'c','slug':'p','name':'P','description':None,'sortOrder':1,'seriesCount':0}]}}} if p=='categories.list' else {'result':{'data':{'items':[],'nextCursor':None}}} if p.endswith('.list') else {'result':{'data':None}} for p in procs]
        await route.fulfill(status=200,content_type='application/json',body=json.dumps(out))
      await ctx.route('**/trpc/**',h); pg=await ctx.new_page()
      for path,sel in [('/calendar','#calendar-category'),('/series','#series-category')]:
        await pg.goto(BASE+path); await pg.wait_for_selector(sel+':not([disabled])',timeout=20000)
        ib=await pg.evaluate("()=>document.querySelectorAll('[inert]').length")
        await pg.locator(sel).focus(); await pg.keyboard.press('Enter')
        await pg.wait_for_function("()=>document.activeElement?.closest('[role=listbox]')"); await pg.wait_for_timeout(500)
        r={'inertBefore':ib,'w':w,'lang':lang,'path':path,'active':await pg.evaluate(AE)}
        r['portal']=await pg.evaluate("()=>{const l=document.querySelector('[role=listbox]');return {rootContainsListbox:document.getElementById('root').contains(l),rootAriaHidden:document.getElementById('root').getAttribute('aria-hidden'),rootInert:document.getElementById('root').inert}}")
        if len(sys.argv)>2: await pg.screenshot(path=f"{sys.argv[2]}/open_{path.strip('/')}_{w}_{lang[:2]}.png")
        await pg.add_script_tag(path=AXE)
        r['axe']=await pg.evaluate("async()=>(await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))}))")
        r['focusableInRoot']=await pg.evaluate("()=>document.querySelectorAll('#root a[href],#root button:not([disabled]),#root input,#root [tabindex]:not([tabindex=\"-1\"])').length")
        tabs=[]
        for i in range(5): await pg.keyboard.press('Tab'); tabs.append(await pg.evaluate("()=>!!document.activeElement.closest('[role=listbox]')"))
        await pg.keyboard.press('Shift+Tab'); tabs.append(await pg.evaluate("()=>!!document.activeElement.closest('[role=listbox]')"))
        r['tabStaysInListbox']=all(tabs)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        r['inertAfterEsc']=await pg.evaluate("()=>document.querySelectorAll('[inert]').length")
        r['afterEsc']=await pg.evaluate(AE); r['escToTrigger']=await pg.evaluate(f"()=>document.activeElement===document.querySelector('{sel}')")
        if len(sys.argv)>2: await pg.screenshot(path=f"{sys.argv[2]}/closed_{path.strip('/')}_{w}_{lang[:2]}.png")
        await pg.keyboard.press('Tab'); r['tabAfterClose']=await pg.evaluate("()=>{const a=document.activeElement;return {tag:a.tagName,inRoot:document.getElementById('root').contains(a)}}")
        for how in ['select','outside']:
          await pg.locator(sel).focus(); await pg.keyboard.press('Enter'); await pg.wait_for_function("()=>document.activeElement?.closest('[role=listbox]')")
          op=await pg.evaluate("()=>document.querySelectorAll('[inert]').length")
          if how=='select': await pg.keyboard.press('Enter')
          else: await pg.mouse.click(w-5,895)
          await pg.wait_for_timeout(400)
          r['inert_'+how]={'open':op,'after':await pg.evaluate("()=>document.querySelectorAll('[inert]').length"),'focusTrigger':await pg.evaluate(f"()=>document.activeElement===document.querySelector('{sel}')")}
        r['inertWhileOpen']=r['inert_select']['open']
        print(json.dumps(r,ensure_ascii=False))
      await ctx.close()
    await b.close()
asyncio.run(m())
