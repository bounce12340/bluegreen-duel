"""測逾時自動結束回合（60 秒）與斷線 30 秒判負。約需 100 秒。"""
import os, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
BASE = os.environ.get("BASE", "http://localhost:8788/")
with sync_playwright() as p:
    b = p.chromium.launch()
    def player(side, name):
        ctx = b.new_context(viewport={"width": 390, "height": 844}); pg = ctx.new_page(); pg.goto(BASE)
        pg.wait_for_selector("#title:not(.hidden)"); pg.click(f".pick-btn.{side}"); pg.fill("#m-name", name); pg.click("#m-rand"); return pg, ctx
    a, actx = player("blue", "逾時甲"); g, gctx = player("green", "逾時乙")
    a.wait_for_selector("#battle:not(.hidden)", timeout=15000); g.wait_for_selector("#battle:not(.hidden)", timeout=15000)
    for pg in (a, g):
        if pg.is_visible("#m-ok"): pg.click("#m-ok")
    a.wait_for_timeout(1000)
    who = "A" if a.evaluate("!document.querySelector('#end-btn').disabled") else "B"
    print("先手：", who, "，等 63 秒不動作…")
    a.wait_for_timeout(63000)
    who2 = "A" if a.evaluate("!document.querySelector('#end-btn').disabled") else "B"
    print("逾時後輪到：", who2, "（應與先手不同）")
    print("關掉 B 的瀏覽器，等 33 秒…")
    gctx.close()
    a.wait_for_timeout(34000)
    print("A 結果：", a.inner_text(".modal-box") .split("\n")[0:4] if a.is_visible("#m-again") else "未結束")
    b.close()
