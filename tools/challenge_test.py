"""質疑機制測試。
(1) 對電腦：我方蓋牌宣告（吹牛）、電腦蓋牌時跳出質疑視窗並回應。
(2) 連線：A 吹牛 → B 質疑；A 說實話 → B 不回應 8 秒自動放行；檢查 B 收到的資料裡沒有 A 的真牌。
需先啟動 wrangler dev（8787）與 wrangler pages dev（8788）。
"""
import os, sys, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
BASE = os.environ.get("BASE", "http://localhost:8788/")
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ch"
os.makedirs(OUT, exist_ok=True)
errors = []

def page(b, tag):
    pg = b.new_page(viewport={"width": 390, "height": 844})
    pg.on("pageerror", lambda e: errors.append(f"{tag}: {e}"))
    pg.on("console", lambda m: m.type == "error" and errors.append(f"{tag}: {m.text}"))
    pg.goto(BASE); pg.wait_for_selector("#title:not(.hidden)")
    return pg

def my_turn(pg):
    return pg.evaluate("!document.querySelector('#end-btn').disabled && document.querySelector('#modal').classList.contains('hidden')")

def safe_click(pg, sel):
    try:
        pg.click(sel, timeout=2000); return True
    except Exception:
        return False

def give_turn_to(A, B):
    """結束 B 的回合直到輪到 A（且 A 沒有彈窗）"""
    for _ in range(10):
        if my_turn(A): return True
        if my_turn(B): safe_click(B, "#end-btn")
        A.wait_for_timeout(1000)
    return my_turn(A)

def declare(pg, honest=False, shot=None):
    """點第一張非陷阱牌 → 蓋牌宣告 → 選一張（吹牛選第一個不是說實話的；說實話選標有說實話的）"""
    for i in range(len(pg.query_selector_all(".card"))):
        cs = pg.query_selector_all(".card")
        if i >= len(cs): break
        try: cs[i].click(timeout=2000)
        except Exception: continue
        pg.wait_for_timeout(200)
        if pg.is_visible("#m-declare") and pg.is_enabled("#m-declare"):
            pg.click("#m-declare"); pg.wait_for_timeout(200)
            if shot: pg.screenshot(path=shot)
            items = pg.query_selector_all(".decl-item:not([disabled])")
            pick = None
            for it in items:
                is_honest = "說實話" in it.inner_text()
                if honest == is_honest: pick = it; break
            if pick:
                name = pick.query_selector("b").inner_text()
                pick.click(); return name
            pg.click("#m-back"); pg.wait_for_timeout(150)
        if pg.is_visible("#m-cancel"): pg.click("#m-cancel")
        pg.wait_for_timeout(150)
    return None

with sync_playwright() as p:
    b = p.chromium.launch()
    # ── (1) 對電腦 ──
    L = page(b, "L")
    L.click(".pick-btn.blue"); L.click("#m-ai"); L.wait_for_timeout(500)
    if L.is_visible("#m-ok"): L.click("#m-ok")
    declared = asked = 0
    for t in range(40):
        if L.is_visible("#m-again"): break
        if L.is_visible("#m-challenge"):
            asked += 1
            if asked == 1: L.screenshot(path=f"{OUT}/ai_declares.png")
            L.click("#m-challenge" if asked % 2 else "#m-pass"); L.wait_for_timeout(1200)
            continue
        if my_turn(L):
            if declared < 3 and not L.is_visible(".modal:not(.hidden)"):
                n = declare(L, honest=False, shot=f"{OUT}/picker.png" if declared == 0 else None)
                if n: declared += 1; L.wait_for_timeout(2600)
            if my_turn(L): L.click("#end-btn")
        L.wait_for_timeout(900)
    print(f"對電腦：我方蓋牌 {declared} 次，電腦蓋牌時跳出質疑視窗 {asked} 次")
    L.close()

    # ── (2) 連線 ──
    A = page(b, "A"); B = page(b, "B")
    frames_b = []
    B.on("websocket", lambda ws: ws.on("framereceived", lambda f: frames_b.append(f if isinstance(f, str) else str(f))))
    A.click(".pick-btn.blue"); A.fill("#m-name", "宣告者"); A.click("#m-rand")
    B.click(".pick-btn.green"); B.fill("#m-name", "質疑者"); B.click("#m-rand")
    for pg in (A, B):
        pg.wait_for_selector("#battle:not(.hidden)", timeout=15000)
        pg.wait_for_timeout(500)
        if pg.is_visible("#m-ok"): pg.click("#m-ok")
    give_turn_to(A, B)
    name = declare(A, honest=False)
    print("A 吹牛宣告：", name)
    B.wait_for_selector("#m-challenge", timeout=5000)
    B.screenshot(path=f"{OUT}/b_prompt.png")
    A.screenshot(path=f"{OUT}/a_wait.png")
    B.click("#m-challenge"); A.wait_for_timeout(600)
    cast_a = A.inner_text("#cast") if A.is_visible("#cast") else "（沒有翻牌演出）"
    cast_b = B.inner_text("#cast") if B.is_visible("#cast") else "（沒有翻牌演出）"
    B.screenshot(path=f"{OUT}/b_reveal.png")
    print("A 看到翻牌：", cast_a.replace("\n", "｜")[:80])
    print("B 看到翻牌：", cast_b.replace("\n", "｜")[:80])
    leaked = any('"cardId"' in f for f in frames_b)
    print("B 收到的資料含 A 的真牌（cardId）：", leaked)
    # 下一回合 A 說實話、B 不回應（找得到付得起的真牌才宣告，最多試 4 回合）
    name2 = None
    for _ in range(4):
        A.wait_for_timeout(800)
        if my_turn(A): safe_click(A, "#end-btn")
        give_turn_to(A, B)
        name2 = declare(A, honest=True)
        if name2: break
    print("A 說實話宣告：", name2)
    try:
        B.wait_for_selector("#m-challenge", timeout=5000)
    except Exception:
        print("！B 沒看到質疑視窗。B 彈窗：", B.inner_html("#modal-box")[:300], "｜B 計時：", B.inner_text("#timer"))
        raise
    t_before = A.inner_text("#timer")
    A.wait_for_timeout(10000)
    print("B 不回應 10 秒後，B 的質疑視窗還在：", B.is_visible("#m-challenge"), "｜A 計時器：", t_before, "→", A.inner_text("#timer"))
    A.screenshot(path=f"{OUT}/a_after_pass.png")
    b.close()
print("errors:", errors[:8])
