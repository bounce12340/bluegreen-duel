"""教學、每日挑戰、成就圖鑑、電視台展示模式的瀏覽器測試。用法：python3 tools/extras_test.py 輸出資料夾 [locale]"""
import os, subprocess, sys, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
BASE=os.environ.get("BASE", "http://localhost:8771/"); OUT=sys.argv[1]; LOC=sys.argv[2] if len(sys.argv)>2 else "zh-TW"; os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8771"], cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); errs=[]
def newpage(b, **kw):
    ctx=b.new_context(viewport={"width":390,"height":844},device_scale_factor=2,is_mobile=True,has_touch=True,locale=LOC, accept_downloads=True, **kw)
    pg=ctx.new_page(); pg.on("pageerror",lambda e: errs.append(str(e))); return ctx,pg
def wait_my_turn(pg, n=80):
    for _ in range(n):
        if pg.evaluate("!document.querySelector('#end-btn').disabled && document.querySelector('#modal').classList.contains('hidden') && document.querySelector('#cast').classList.contains('hidden')"): return True
        if pg.locator("#m-challenge").is_visible(): return 'challenge'
        pg.wait_for_timeout(300)
    return False
def coach(pg):
    return pg.inner_text("#coach .msg") if pg.locator("#coach:not(.hidden)").count() else "-"
def play_card(pg, sel):
    pg.click(sel, timeout=3000, force=True); pg.wait_for_timeout(300); pg.click("#m-play", timeout=3000)
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    # 1 教學
    ctx,pg=newpage(b); pg.goto(BASE + "index.html"); pg.wait_for_timeout(800)
    pg.screenshot(path=f"{OUT}/0title.png")
    pg.click('[data-open="tutorial"]'); pg.wait_for_timeout(300); pg.click("#m-tg"); pg.wait_for_timeout(500)
    pg.screenshot(path=f"{OUT}/1tut_policy.png"); pg.locator(".policy-item").first.click(); pg.wait_for_timeout(600)
    print("T1", wait_my_turn(pg), coach(pg)[:50]); pg.screenshot(path=f"{OUT}/2tut_play.png")
    play_card(pg, ".card.coach-target")
    r=wait_my_turn(pg); print("T2", r, coach(pg)[:50]); pg.screenshot(path=f"{OUT}/3tut_combo.png")
    play_card(pg, ".card.coach-target"); pg.wait_for_timeout(2500)
    print("after magic, combo-ready cards:", pg.locator(".card.combo-ready").count())
    pg.screenshot(path=f"{OUT}/3b_comboready.png")
    play_card(pg, ".card.coach-target"); pg.wait_for_timeout(2000); pg.screenshot(path=f"{OUT}/4tut_combo_done.png"); print("coach:", coach(pg)[:40])
    r=wait_my_turn(pg); print("AI turn result:", r, coach(pg)[:50]); pg.screenshot(path=f"{OUT}/5tut_challenge.png")
    if r=='challenge': pg.click("#m-challenge"); 
    r=wait_my_turn(pg); print("T3", r, coach(pg)[:50]); pg.screenshot(path=f"{OUT}/6tut_declare.png")
    pg.query_selector_all(".card")[0].click(); pg.wait_for_timeout(300)
    if pg.locator("#m-declare").is_enabled():
        pg.click("#m-declare"); pg.wait_for_timeout(300)
        items=[x for x in pg.query_selector_all(".decl-item:not([disabled])")]
        items[-1].click(); pg.wait_for_timeout(4000)
    print("after declare coach:", coach(pg)[:50]); pg.screenshot(path=f"{OUT}/7tut_done.png")
    ctx.close()
    # 2 每日挑戰：兩個玩家同一天的開局手牌一樣
    hands=[]
    for i in range(2):
        ctx,pg=newpage(b); pg.goto(BASE + "index.html"); pg.evaluate("localStorage.setItem('bg_seen_help','1')"); pg.reload(); pg.wait_for_timeout(600)
        pg.click('[data-open="daily"]'); pg.wait_for_timeout(300)
        if i==0: pg.screenshot(path=f"{OUT}/8daily.png")
        pg.click("#m-go"); pg.wait_for_timeout(500)
        offers=[x.inner_text().split("\n")[0] for x in pg.query_selector_all(".policy-item")]
        pg.locator(".policy-item").first.click(); pg.wait_for_timeout(800)
        hands.append((offers, [c.inner_text().split("\n")[0] for c in pg.query_selector_all(".card")]))
        ctx.close()
    print("daily same deal:", hands[0]==hands[1], hands[0])
    # 3 圖鑑與成就（用剛剛教學的紀錄）
    ctx,pg=newpage(b); pg.goto(BASE + "index.html"); pg.wait_for_timeout(600)
    pg.evaluate("localStorage.setItem('bg_seen_cards', JSON.stringify(['s_street','s_buzz','b_news','g_flash','s_rain','g_rally'])); localStorage.setItem('bg_ach', JSON.stringify({first_win: 1, combo_1: 1}))")
    pg.reload(); pg.wait_for_timeout(600)
    pg.click('[data-open="album"]'); pg.wait_for_timeout(300); pg.screenshot(path=f"{OUT}/9album.png")
    pg.click('[data-tab="cards"]'); pg.wait_for_timeout(300); pg.screenshot(path=f"{OUT}/9b_gallery.png")
    ctx.close()
    # 4 展示模式
    ctx,pg=newpage(b); pg.goto(BASE + "index.html?tv=1"); pg.evaluate("localStorage.setItem('bg_seen_help','1')"); pg.reload()
    pg.wait_for_timeout(27500); pg.screenshot(path=f"{OUT}/10demo.png")
    print("demo running:", pg.locator("#demo-banner:not(.hidden)").count(), "battle:", pg.locator("#battle:not(.hidden)").count())
    pg.wait_for_timeout(6000); pg.keyboard.press("Enter"); pg.wait_for_timeout(600)
    print("after key title shown:", pg.locator("#title:not(.hidden)").count())
    ctx.close()
    b.close()
finally: srv.terminate()
print("errors", errs)
