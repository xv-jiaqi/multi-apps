# CH-220 v1.9 §2-5 / 20-11: same multi-table sample in topic body and one reply on /forum/:slug.
# Local vite preview; GET from fixtures; every non-GET gets 405.
import sys, json, asyncio
from datetime import datetime, timezone
src = open(__file__.replace('probe-table-prefix.py', 'probe-scroll-region.py')).read().split('async def main')[0]
TAG = sys.argv[3]
exec(src)
MULTI = '\n'.join([
  '| a |', '| --- |', '| 1 |', '',
  '## 价格', '', '| b |', '| --- |', '| 2 |', '',
  '### 版本对照', '', '| c |', '| --- |', '| 3 |',
])
NOW_S = datetime(2026, 11, 6, 8, 0, 0, tzinfo=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
USER = {'id': 'u1', 'username': 'qa_user', 'role': 'user', 'passwordChangeRecommended': False, 'bannedAt': None}
TOPIC = {
  'id': 't1', 'slug': 'table-prefix', 'title': '表格前缀样例', 'body': MULTI,
  'pinned': False, 'editedAt': None, 'createdAt': NOW_S, 'updatedAt': NOW_S,
  'editableUntil': NOW_S, 'serverNow': NOW_S,
  'author': {'id': 'u1', 'username': 'qa_user'}, 'replyCount': 1,
  'replies': [{
    'id': 'r1', 'body': MULTI, 'createdAt': NOW_S,
    'author': {'id': 'u2', 'username': 'replier'},
  }],
  'replyNextCursor': None,
}
EXPECTED = {
  'zh-CN': {
    'topic': ['表格 1（可横向滚动）', '价格：表格 2（可横向滚动）', '版本对照：表格 3（可横向滚动）'],
    'reply': ['回复 1：表格 1（可横向滚动）', '回复 1：价格：表格 2（可横向滚动）', '回复 1：版本对照：表格 3（可横向滚动）'],
  },
  'en-US': {
    'topic': ['Table 1 (scrollable)', '价格: Table 2 (scrollable)', '版本对照: Table 3 (scrollable)'],
    'reply': ['Reply 1: Table 1 (scrollable)', 'Reply 1: 价格: Table 2 (scrollable)', 'Reply 1: 版本对照: Table 3 (scrollable)'],
  },
}
_data = data
def data(p):
  if p == 'auth.me': return USER
  if p == 'forum.topics.bySlug': return TOPIC
  return _data(p)
async def ctxu(b, w, lang):
  ctx = await ctxfor(b, w, lang)
  await ctx.add_init_script(
    f"localStorage.setItem('cardhub:session',JSON.stringify({{token:'local-fake',user:{json.dumps(USER)}}}))"
  )
  return ctx
LM = "async()=>(await axe.run(document,{runOnly:{type:'rule',values:['landmark-unique','scrollable-region-focusable','region']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))}))"
async def main():
  out = open(f'{OUT}/{TAG}.jsonl', 'w')
  async with async_playwright() as p:
    b = await p.chromium.launch()
    for w, lang in [(375, 'zh-CN'), (375, 'en-US'), (1440, 'zh-CN'), (1440, 'en-US')]:
      ctx = await ctxu(b, w, lang); pg = await ctx.new_page()
      await pg.goto(f"{BASE}/forum/table-prefix")
      await pg.wait_for_selector('main h1', timeout=20000)
      await pg.wait_for_selector('[role=region]', timeout=20000)
      await pg.wait_for_timeout(800)
      await pg.evaluate("()=>{document.activeElement?.blur();window.scrollTo(0,0)}")
      await pg.screenshot(path=f"{OUT}/{TAG}_{w}_{lang[:2]}.png", full_page=True)
      labels = await pg.evaluate("()=>[...document.querySelectorAll('main [role=region]')].map(r=>r.getAttribute('aria-label'))")
      exp = EXPECTED[lang]
      want = exp['topic'] + exp['reply']
      v = await axe(pg)
      lm = await pg.evaluate(LM)
      nonget = [x for x in ctx.reqlog if x['m'] != 'GET']
      r = {
        'tag': TAG, 'w': w, 'lang': lang, 'labels': labels, 'want': want,
        'match': labels == want, 'unique': len(set(labels)) == len(labels),
        'axeLandmark': lm, 'axeWcag': [{'id': x['id']} for x in v], 'nonGet': nonget,
      }
      out.write(json.dumps(r, ensure_ascii=False) + '\n')
      print(TAG, w, lang, 'match', r['match'], 'unique', r['unique'], 'lm', lm, 'axe', [x['id'] for x in v], flush=True)
      await ctx.close()
    await b.close()
asyncio.run(main())
