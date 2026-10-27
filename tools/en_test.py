"""英文版截圖與檢查：首頁、模式選單、對戰、卡牌、蓋牌宣告、規則、隱私、選單；並檢查畫面上殘留的中文。
用法：python3 shot_en.py 輸出資料夾 [locale]"""
import os, re, subprocess, sys, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; LOCALE = sys.argv[2] if len(sys.argv) > 2 else "en-US"
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8767"], cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site"),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
CJK = re.compile(r"[一-鿿]")
leaks = set()
def check(pg, where):
    txt = pg.evaluate("document.body.innerText")
    for line in txt.split("\n"):
        if CJK.search(line) and line.strip() not in ("中文",): leaks.add(f"{where}: {line.strip()[:90]}")
SIZES = [("phone", 390, 844, 2, True), ("desk", 1920, 1080, 1, False)]
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, w, h, dpr, touch in SIZES:
            errs = []
            ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=dpr, has_touch=touch, is_mobile=touch and w < 600, locale=LOCALE)
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto("http://localhost:8767/index.html"); pg.wait_for_timeout(1200)
            pg.screenshot(path=f"{OUT}/{name}_1title.png"); check(pg, "title")
            pg.click(".pick-btn.green"); pg.wait_for_timeout(500)
            pg.screenshot(path=f"{OUT}/{name}_2mode.png"); check(pg, "mode")
            pg.click("#m-ai"); pg.wait_for_timeout(700)
            pg.screenshot(path=f"{OUT}/{name}_3rules.png"); check(pg, "rules")
            pg.click("#m-ok"); pg.wait_for_timeout(400)
            pg.screenshot(path=f"{OUT}/{name}_3b_policy.png"); check(pg, "policy")
            if pg.locator(".policy-item").first.is_visible(): pg.locator(".policy-item").first.click()
            for _ in range(40):
                if pg.evaluate("!document.querySelector('#end-btn').disabled"): break
                pg.wait_for_timeout(500)
            pg.wait_for_timeout(1500)
            pg.screenshot(path=f"{OUT}/{name}_4battle.png"); check(pg, "battle")
            pg.query_selector_all(".card")[0].click(); pg.wait_for_timeout(500)
            pg.screenshot(path=f"{OUT}/{name}_5card.png"); check(pg, "card")
            if pg.locator("#m-declare").is_visible() and pg.locator("#m-declare").is_enabled():
                pg.click("#m-declare"); pg.wait_for_timeout(500)
                pg.screenshot(path=f"{OUT}/{name}_6declare.png"); check(pg, "declare")
                pg.click("#m-back"); pg.wait_for_timeout(300)
            pg.click("#m-cancel"); pg.wait_for_timeout(300)
            pg.click("#menu"); pg.wait_for_timeout(300)
            pg.screenshot(path=f"{OUT}/{name}_7menu.png"); check(pg, "menu")
            pg.click("#m-priv"); pg.wait_for_timeout(300); check(pg, "privacy")
            pg.screenshot(path=f"{OUT}/{name}_8privacy.png")
            pg.click("#m-ok"); pg.wait_for_timeout(200)
            # 玩到結束：每回合出第一張能出的牌，對手宣告就質疑，順便收集提示文字
            toasts = set()
            t_end = time.time() + 240
            while time.time() < t_end:
                for el in pg.query_selector_all(".toast, .cast-label, .bubble"):
                    try: toasts.add(el.inner_text().strip())
                    except Exception: pass
                if pg.locator(".result-img").is_visible(): break
                try:
                    if pg.locator(".policy-item").first.is_visible():
                        pg.locator(".policy-item").first.click(timeout=1500); continue
                    if pg.locator("#m-challenge").is_visible():
                        pg.click("#m-challenge", timeout=1500); pg.wait_for_timeout(300); continue
                    if pg.evaluate("!document.querySelector('#end-btn').disabled && document.querySelector('#modal').classList.contains('hidden') && document.querySelector('#cast').classList.contains('hidden')"):
                        cs = pg.query_selector_all(".card:not(.cant)")
                        if cs:
                            cs[-1].click(timeout=1500); pg.wait_for_timeout(200)
                            if pg.locator("#m-play").is_enabled(): pg.click("#m-play", timeout=1500)
                            else: pg.click("#m-cancel", timeout=1500); pg.click("#end-btn", timeout=1500)
                        else: pg.click("#end-btn", timeout=1500)
                        pg.wait_for_timeout(400)
                    else: pg.wait_for_timeout(150)
                except Exception:
                    pg.wait_for_timeout(300)
            pg.wait_for_timeout(1200)
            pg.screenshot(path=f"{OUT}/{name}_9result.png"); check(pg, "result")
            for tt in toasts:
                if CJK.search(tt): leaks.add("toast: " + tt[:90])
            open(f"{OUT}/{name}_toasts.txt", "w").write("\n".join(sorted(toasts)))
            print(name, "errors:", errs, "toasts:", len(toasts))
            ctx.close()
        b.close()
finally:
    srv.terminate()
print("CJK leaks:", len(leaks))
for l in sorted(leaks): print(" ", l)
