"""開本機伺服器，用手機尺寸實際操作遊戲並截圖，同時收集主控台錯誤。"""
import os, subprocess, sys, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shots"
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8765"], cwd=os.path.join(os.path.dirname(__file__), "..", "site"),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(locale="zh-TW", viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:8765/index.html")
        pg.wait_for_timeout(800)
        pg.screenshot(path=f"{OUT}/1_title.png")
        pg.click(".pick-btn.green")
        pg.wait_for_timeout(300)
        pg.screenshot(path=f"{OUT}/1b_mode.png")
        pg.click("#m-ai")
        pg.wait_for_timeout(600)
        pg.screenshot(path=f"{OUT}/2_rules.png")
        pg.click("#m-ok")
        # 等到輪到我方
        for _ in range(40):
            if pg.evaluate("!document.querySelector('#end-btn').disabled"):
                break
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f"{OUT}/3_battle.png")
        # 打出第一張能出的牌
        cards = pg.query_selector_all(".card:not(.cant)")
        if cards:
            cards[0].click(); pg.wait_for_timeout(400)
            pg.screenshot(path=f"{OUT}/4_preview.png")
            pg.click("#m-play"); pg.wait_for_timeout(1200)
        pg.screenshot(path=f"{OUT}/5_after_play.png")
        # 快轉：一直出牌、結束回合，直到結束
        for turn in range(40):
            if pg.is_visible("#m-again"):
                break
            if pg.evaluate("!document.querySelector('#end-btn').disabled"):
                if pg.is_visible("#ult-btn"):
                    pg.click("#ult-btn"); pg.wait_for_timeout(300)
                    btn = pg.query_selector("[data-ult]:not([disabled])")
                    if btn: btn.click(); pg.wait_for_timeout(500)
                for _ in range(5):
                    cs = pg.query_selector_all(".card:not(.cant)")
                    if not cs: break
                    cs[0].click(); pg.wait_for_timeout(200)
                    if pg.is_visible("#m-play") and pg.is_enabled("#m-play"): pg.click("#m-play")
                    elif pg.is_visible("#m-cancel"): pg.click("#m-cancel")
                    pg.wait_for_timeout(300)
                if turn == 4: pg.screenshot(path=f"{OUT}/6_midgame.png")
                if pg.is_enabled("#end-btn"): pg.click("#end-btn")
            pg.wait_for_timeout(1500)
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f"{OUT}/7_result.png")
        b.close()
finally:
    srv.terminate()
print("errors:", errors[:10])
