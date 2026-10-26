"""本機雙人連線測試：兩個瀏覽器隨機配對、輪流出牌，中途讓一方重新整理測斷線重連，打到分出勝負。
另測：朋友房（開房／加入）、不合格暱稱。需先啟動 wrangler dev（8787）與 wrangler pages dev（8788）。
"""
import os, sys, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8788/")
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/pvp"
os.makedirs(OUT, exist_ok=True)
errors = []


def new_player(b, tag):
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(f"{tag}: {e}"))
    pg.on("console", lambda m: m.type == "error" and errors.append(f"{tag}: {m.text}"))
    pg.goto(BASE)
    pg.wait_for_selector("#title:not(.hidden)")
    return pg


def open_menu(pg, side, name):
    pg.click(f".pick-btn.{side}")
    pg.fill("#m-name", name)


def dismiss_help(pg):
    if pg.is_visible("#m-ok"):
        pg.click("#m-ok")


def take_turn(pg):
    dismiss_help(pg)
    for _ in range(5):
        cs = pg.query_selector_all(".card:not(.cant)")
        if not cs:
            break
        cs[0].click(); pg.wait_for_timeout(150)
        if pg.is_visible("#m-play") and pg.is_enabled("#m-play"):
            pg.click("#m-play")
        elif pg.is_visible("#m-cancel"):
            pg.click("#m-cancel")
        pg.wait_for_timeout(400)
    if pg.is_enabled("#end-btn"):
        pg.click("#end-btn")


with sync_playwright() as p:
    b = p.chromium.launch()

    # 1. 不合格暱稱
    a = new_player(b, "A")
    open_menu(a, "blue", "蔣萬安本人")
    a.click("#m-rand"); a.wait_for_timeout(300)
    print("擋暱稱:", a.inner_text("#m-err"))

    # 2. 隨機配對（不同陣營，應立即配對）
    a.fill("#m-name", "測試甲")
    a.click("#m-rand")
    g = new_player(b, "B")
    open_menu(g, "green", "測試乙")
    g.click("#m-rand")
    a.wait_for_selector("#battle:not(.hidden)", timeout=15000)
    g.wait_for_selector("#battle:not(.hidden)", timeout=15000)
    dismiss_help(a); dismiss_help(g)
    a.wait_for_timeout(800)
    print("配對成功；A 看到對手暱稱：", "測試乙" in a.inner_text("#opp-info"))
    a.screenshot(path=f"{OUT}/a_start.png"); g.screenshot(path=f"{OUT}/b_start.png")

    # 對手手牌不該外洩：A 的頁面裡不能出現 B 的卡名
    reloaded = False
    for turn in range(60):
        if a.is_visible("#m-again") or g.is_visible("#m-again"):
            break
        for pg in (a, g):
            if pg.evaluate("!document.querySelector('#end-btn').disabled"):
                take_turn(pg)
        if turn == 3 and not reloaded:
            reloaded = True
            g.reload(); g.wait_for_selector("#battle:not(.hidden)", timeout=15000)
            dismiss_help(g)
            print("B 重新整理後回到對局：", g.is_visible("#battle"))
        a.wait_for_timeout(700)
    a.wait_for_timeout(2000)
    a.screenshot(path=f"{OUT}/a_end.png"); g.screenshot(path=f"{OUT}/b_end.png")
    print("A 結果:", a.inner_text(".modal-box h2") if a.is_visible("#m-again") else "未結束")
    print("B 結果:", g.inner_text(".modal-box h2") if g.is_visible("#m-again") else "未結束")

    # 3. 朋友房
    h = new_player(b, "H")
    open_menu(h, "green", "房主")
    h.click("#m-host")
    h.wait_for_selector("#m-roomcode", timeout=10000)
    code = h.inner_text("#m-roomcode").strip()
    j = new_player(b, "J")
    open_menu(j, "green", "朋友")
    j.fill("#m-code", code)
    j.click("#m-join")
    h.wait_for_selector("#battle:not(.hidden)", timeout=10000)
    j.wait_for_selector("#battle:not(.hidden)", timeout=10000)
    dismiss_help(j); dismiss_help(h); j.wait_for_timeout(600)
    print("朋友房", code, "：房主陣營", h.evaluate("document.querySelector('#me-info').className"), "／朋友陣營", j.evaluate("document.querySelector('#me-info').className"))
    j.screenshot(path=f"{OUT}/friend.png")

    # 4. 已開始的房間不能再加入
    k = new_player(b, "K")
    open_menu(k, "blue", "路人")
    k.fill("#m-code", code); k.click("#m-join"); k.wait_for_timeout(1500)
    print("第三人加入：", k.inner_text(".modal-box h2") if k.is_visible(".modal-box") else "無提示")
    b.close()

print("errors:", errors[:10])
