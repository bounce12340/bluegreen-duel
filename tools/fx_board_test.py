"""場上特效截圖：用假的遊戲狀態把所有持續效果（狀態、召喚、蓋牌、晚會）一次擺出來，再播幾個單次效果。
用法：python3 tools/fx_board_test.py 輸出資料夾"""
import os, subprocess, sys, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8768"], cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site"),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
FAKE = """(async () => {
  const fx = await import('./js/fx.js');
  const P = (st, sm, tr) => ({ statuses: st.map((id) => ({ id, turns: 2 })), summons: sm, traps: tr, supporters: 20, voice: 50, hand: [] });
  window.__fake = { field: { owner: 'blue', turns: 2 }, players: {
    blue: P(['encircle', 'question', 'burst'], [{ name: '小編團', turns: 3, perTurn: 3 }, { name: '青年軍', turns: 2, perTurn: 3 }], [{ id: 's_rain', name: '下雨了', fx: {} }, { id: 's_flip', name: '跑票', fx: {} }]),
    green: P(['deflect', 'gaffe', 'exposed', 'sympathy', 'ultBoost', 'reflect'], [{ name: '市政團隊', turns: 3, perTurn: 3 }], [{ id: 's_flip', name: '跑票', fx: {} }]) } };
  fx.syncBoard(window.__fake, 'blue', 'green');
  window.__fx = fx;
})()"""
SIZES = [("phone", 390, 844, 2, True), ("desk", 1600, 900, 1, False)]
errs = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, w, h, dpr, touch in SIZES:
            ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=dpr, has_touch=touch, is_mobile=touch and w < 600, locale="zh-TW")
            pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto("http://localhost:8768/index.html"); pg.evaluate("localStorage.setItem('bg_seen_help','1')"); pg.reload(); pg.wait_for_timeout(800)
            pg.click(".pick-btn.blue"); pg.wait_for_timeout(300); pg.click("#m-ai")
            for _ in range(40):
                if pg.evaluate("!document.querySelector('#end-btn').disabled"): break
                pg.wait_for_timeout(400)
            pg.wait_for_timeout(1500)
            pg.evaluate(FAKE); pg.wait_for_timeout(1200)
            pg.screenshot(path=f"{OUT}/{name}_persist.png")
            # 單次效果
            shots = [("pull", "{type:'pull', side:'blue', n:9}", 450), ("poach", "{type:'poach', side:'green', n:5}", 450),
                     ("rain", "{type:'trap', side:'green', trap:'rain'}", 1000), ("ult_birds", "{type:'ult', side:'green', ult:'u_birds'}", 700),
                     ("ult_shield", "{type:'ult', side:'green', ult:'u_shield'}", 500), ("status", "{type:'status', side:'green', status:'gaffe'}", 300),
                     ("buzz", "{type:'play', side:'blue', card:'s_buzz'}", 400), ("staff", "{type:'play', side:'blue', card:'s_staff'}", 450)]
            for nm, ev, wait in shots:
                pg.evaluate(f"(async () => {{ const e = await import('./js/engine.js'); window.__fx.playFx({ev}, {{ me: 'blue', opp: 'green', card: (id) => e.CARD_BY_ID[id] }}); }})()")
                pg.wait_for_timeout(wait)
                pg.screenshot(path=f"{OUT}/{name}_{nm}.png")
                pg.wait_for_timeout(1500)
            ctx.close()
        b.close()
finally:
    srv.terminate()
print("errors:", errs)
