import asyncio,json,sys
sys.argv=['x']; exec(open('pr3shoot.py').read().split('async def main')[0])
OUT='/workspace/ch305/pr4'
async def run():
    from playwright.async_api import async_playwright
    res=[]
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for w in (1440,375):
            for lang in ('zh','en'):
                ctx=await b.new_context(viewport={'width':w,'height':900},is_mobile=w==375,service_workers='block',color_scheme='light')
                await ctx.add_init_script(f"localStorage.setItem('cardhub:locale','{'zh-CN' if lang=='zh' else 'en-US'}');localStorage.setItem('cardhub:session',{json.dumps(json.dumps({'token':'t','user':ADMIN}))});")
                await ctx.route('**/*',handler('success',ADMIN)); pg=await ctx.new_page()
                await pg.goto('http://127.0.0.1:4312/admin/catalog/import',timeout=90000); await pg.wait_for_timeout(3000)
                await pg.click('#import-json'); await pg.keyboard.press('Tab'); await pg.wait_for_timeout(400)
                a=await pg.evaluate("()=>{const e=document.activeElement;const s=getComputedStyle(e);return {tag:e.tagName,type:e.type,text:e.textContent.trim(),fv:e.matches(':focus-visible'),shadow:s.boxShadow,outline:s.outlineStyle+' '+s.outlineColor,fileTabIndex:document.querySelector('input[type=file]').tabIndex}}")
                bb=await pg.evaluate("()=>{const r=document.activeElement.getBoundingClientRect();return {y:r.y+scrollY,h:r.height}}")
                await pg.evaluate("()=>document.activeElement.scrollIntoView({block:'center'})"); bb=await pg.evaluate("()=>{const r=document.activeElement.getBoundingClientRect();return {y:r.y,h:r.height}}")
                f=f"admin-import_tab-file-button_light_{w}_{lang}.png"
                await pg.screenshot(path=f"{OUT}/{f}",clip={'x':0,'y':max(0,bb['y']-200),'width':w,'height':bb['h']+260}); await pg.screenshot(path=f"{OUT}/full_{f}")
                res.append({'shot':f,'viewport':'full_'+f,**a}); await ctx.close()
        await b.close()
    json.dump(res,open(f'{OUT}/tab-results.json','w'),ensure_ascii=False,indent=1); print(json.dumps(res,ensure_ascii=False,indent=1))
asyncio.run(run())
