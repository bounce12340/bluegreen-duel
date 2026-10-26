"""一回合一張牌＋出牌演出測試（對電腦）：截手牌、出牌演出中、效果、電腦出牌演出，最後打完整局。
需先啟動 wrangler dev（8787）與 wrangler pages dev（8788），或設定 BASE。
"""
import os, sys, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8788/")
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fx"
os.makedirs(OUT, exist_ok=True)
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.goto(BASE); pg.wait_for_selector("#title:not(.hidden)")
    pg.click(".pick-btn.green"); pg.click("#m-ai"); pg.wait_for_timeout(600)
    if pg.is_visible("#m-ok"): pg.click("#m-ok")

    def my():
        return pg.evaluate("!document.querySelector('#end-btn').disabled && document.querySelector('#modal').classList.contains('hidden')")

    for _ in range(40):
        if my(): break
        if pg.is_visible("#m-pass"): pg.click("#m-pass")
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(2700)  # 等提示消失
    pg.screenshot(path=f"{OUT}/1_hand.png")
    c = pg.query_selector(".card:not(.cant)")
    c.click(); pg.wait_for_timeout(300); pg.screenshot(path=f"{OUT}/2_detail.png")
    t0 = time.time(); pg.click("#m-play"); pg.wait_for_timeout(500); pg.screenshot(path=f"{OUT}/3_cast.png")
    pg.wait_for_timeout(1400); pg.screenshot(path=f"{OUT}/4_effect.png")

    # 等電腦出牌演出
    shot = False
    for _ in range(60):
        if not shot and not my() and pg.is_visible("#cast:not(.hidden)"):
            pg.wait_for_timeout(350); pg.screenshot(path=f"{OUT}/5_ai_cast.png"); shot = True
        if my(): break
        if pg.is_visible("#m-pass"):
            pg.screenshot(path=f"{OUT}/5b_ai_declare.png"); pg.click("#m-challenge")
        pg.wait_for_timeout(250)
    print(f"我出牌到又輪到我：{time.time() - t0:.1f} 秒")

    # 打完整局：每回合出第一張能出的牌
    turns = 0; t1 = time.time()
    for _ in range(500):
        if pg.is_visible("#m-again"): break
        if pg.is_visible("#m-pass"):
            pg.click("#m-pass" if turns % 2 else "#m-challenge"); continue
        if my():
            turns += 1
            cs = pg.query_selector_all(".card:not(.cant)")
            if cs:
                try:
                    cs[0].click(timeout=2000); pg.wait_for_timeout(150)
                    if pg.is_visible("#m-play") and pg.is_enabled("#m-play"): pg.click("#m-play")
                    elif pg.is_visible("#m-cancel"): pg.click("#m-cancel")
                except Exception:
                    pass
            elif pg.is_enabled("#end-btn"):
                pg.click("#end-btn")
        pg.wait_for_timeout(400)
    pg.wait_for_timeout(1500)
    pg.screenshot(path=f"{OUT}/6_result.png")
    res = pg.inner_text(".modal-box h2") if pg.is_visible("#m-again") else "未結束"
    score = pg.inner_text(".score") if pg.is_visible(".score") else ""
    print(f"整局：我出手 {turns} 次，用時 {time.time() - t1:.0f} 秒，結果：{res} {score}")
    b.close()
print("errors:", errors[:6])
