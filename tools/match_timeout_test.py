"""測配對倒數：(1) 沒人時 30 秒自動改跟電腦；(2) 被配對但從未連進房間的「幽靈」對手，30 秒後判我方勝。"""
import os, subprocess, sys, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
BASE = os.environ.get("BASE", "http://localhost:8788/")
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/mt"
os.makedirs(OUT, exist_ok=True)
GHOST = r"""
const base = process.argv[2].replace(/^http/, 'ws').replace(/\/$/, '');
const ws = new WebSocket(base + '/api/lobby');
ws.onopen = () => ws.send(JSON.stringify({ t: 'join', pid: 'ghost-player-0000001', name: '幽靈', side: 'green' }));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'matched') { console.log('ghost matched', m.code); process.exit(0); } };
setTimeout(() => process.exit(1), 20000);
"""
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 844})
    pg.goto(BASE); pg.wait_for_selector("#title:not(.hidden)")
    pg.click(".pick-btn.blue"); pg.fill("#m-name", "等人的人"); pg.click("#m-rand")
    pg.wait_for_selector("#m-count"); pg.wait_for_timeout(2500)
    first = pg.inner_text("#m-count"); pg.screenshot(path=f"{OUT}/count.png")
    pg.wait_for_timeout(11000)
    print("倒數：", first, "→", pg.inner_text("#m-count"), "｜", pg.inner_text("#m-wait"))
    pg.wait_for_selector("#battle:not(.hidden)", timeout=25000)
    print("30 秒後自動改跟電腦：", pg.is_visible("#battle"), "，結束回合按鈕存在：", pg.is_visible("#end-btn"))

    # 幽靈對手
    g = b.new_page(viewport={"width": 390, "height": 844})
    g.goto(BASE); g.wait_for_selector("#title:not(.hidden)")
    g.click(".pick-btn.blue"); g.fill("#m-name", "正常玩家"); g.click("#m-rand")
    g.wait_for_timeout(1500)
    js = os.path.join(OUT, "ghost.mjs"); open(js, "w").write(GHOST)
    r = subprocess.run(["node", js, BASE], capture_output=True, text=True, timeout=30)
    print(r.stdout.strip() or r.stderr.strip()[:200])
    g.wait_for_selector("#battle:not(.hidden)", timeout=15000)
    if g.is_visible("#m-ok"): g.click("#m-ok")
    t0 = time.time()
    g.wait_for_selector("#m-again", timeout=45000)
    print(f"幽靈對手 {time.time()-t0:.0f} 秒後判定：", g.inner_text(".modal-box").split("\n")[1:4])
    b.close()
