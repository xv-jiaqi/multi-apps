#!/usr/bin/env python3
"""Measure search-page CLS on local pnpm dev:web with a delayed 30-card fixture."""
import argparse
import json
import urllib.parse
from pathlib import Path

from playwright.sync_api import sync_playwright

INIT = """window.__ls=[];new PerformanceObserver(l=>{for(const e of l.getEntries()){if(e.hadRecentInput)continue;window.__ls.push({v:+e.value.toFixed(4),t:Math.round(e.startTime),src:(e.sources||[]).map(s=>{const n=s.node;return n?(n.tagName+'#'+(n.id||'')+'.'+String(n.className).slice(0,80))+' '+JSON.stringify(s.previousRect)+'->'+JSON.stringify(s.currentRect):null})})}}).observe({type:'layout-shift',buffered:true});localStorage.setItem('cardhub:locale', window.__clsLocale || 'zh-CN')"""

CARDS = [
    {
        "slug": f"pikachu-{i:02d}",
        "name": "皮卡丘",
        "seriesTitle": "30周年庆典",
        "seriesSlug": "ptcg-sc-30th",
        "rarity": "common" if i % 3 == 0 else "rare",
        "imageUrl": None,
        "cardNumber": f"{i:03d}",
        "parallelName": None,
        "printRun": None,
        "isParallel": False,
        "base": None,
    }
    for i in range(1, 31)
]


def trpc_ok(data):
    return {"result": {"data": data}}


def fulfill_trpc(route, delay_ms):
    request = route.request
    url = request.url
    parsed = urllib.parse.urlparse(url)
    path = parsed.path
    # /trpc/search.global,series.list
    proc_part = path.split("/trpc/", 1)[-1]
    procedures = [p for p in proc_part.split(",") if p]
    qs = urllib.parse.parse_qs(parsed.query)
    batch = "batch" in qs or len(procedures) > 1

    def payload_for(name):
        if name == "search.global":
            return {
                "query": "皮卡丘",
                "cards": CARDS,
                "series": [],
            }
        if name == "series.list":
            return {"items": [], "page": 1, "pageSize": 100, "total": 0, "years": []}
        return {"ok": True}

    if request.method == "OPTIONS":
        route.fulfill(status=204, headers={"Access-Control-Allow-Origin": "*"})
        return

    # only delay the search procedure
    if "search.global" in procedures and delay_ms:
        page = route.request.frame.page
        page.wait_for_timeout(delay_ms)

    if batch or len(procedures) > 1:
        body = [trpc_ok(payload_for(name)) for name in procedures]
    else:
        body = trpc_ok(payload_for(procedures[0] if procedures else ""))
    route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(body),
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://localhost:5173")
    p.add_argument("--out", required=True)
    p.add_argument("--label", default="run")
    p.add_argument("--delay-ms", type=int, default=2000)
    p.add_argument("--viewports", default="1440x900,1350x940,375x812")
    p.add_argument("--wait-ms", type=int, default=6000)
    p.add_argument("--locale", default="zh-CN")
    p.add_argument("--shots", action="store_true")
    args = p.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    vps = []
    for raw in args.viewports.split(","):
        w, h = raw.lower().split("x")
        vps.append((int(w), int(h)))
    results = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for w, h in vps:
            ctx = browser.new_context(viewport={"width": w, "height": h})
            ctx.add_init_script(f"window.__clsLocale={args.locale!r};" + INIT)
            page = ctx.new_page()
            page.route("**/trpc/**", lambda route: fulfill_trpc(route, args.delay_ms))
            page.goto(
                args.base + "/search?q=" + urllib.parse.quote("皮卡丘"),
                wait_until="domcontentloaded",
                timeout=90000,
            )
            if args.shots:
                page.screenshot(path=str(out / f"{args.label}_{w}x{h}_first.png"), full_page=False)
            page.wait_for_load_state("load")
            page.wait_for_timeout(args.wait_ms)
            shifts = page.evaluate("window.__ls")
            results[f"{args.label}_{w}x{h}"] = {
                "cls_sum": round(sum(x["v"] for x in shifts), 4),
                "shifts": shifts[:8],
            }
            if args.shots:
                page.screenshot(path=str(out / f"{args.label}_{w}x{h}_done.png"), full_page=False)
            ctx.close()
        browser.close()
    (out / f"{args.label}.json").write_text(json.dumps(results, ensure_ascii=False, indent=1) + "\n")
    for key, value in results.items():
        print(key, value["cls_sum"], [(s["v"], s["t"], (s["src"] or [None])[:1]) for s in value["shifts"][:3]])


if __name__ == "__main__":
    main()
