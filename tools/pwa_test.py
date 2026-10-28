"""PWA 檢查：manifest 讀得到、Service Worker 註冊成功、斷網後重新整理還能開首頁並跟電腦開打。
用法：python3 tools/pwa_test.py"""
import os, subprocess, sys, time, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8775"], cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site"),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
ok = True
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844}, locale="zh-TW")
        pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://localhost:8775/index.html"); pg.wait_for_timeout(500)
        m = pg.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
        print("manifest:", m["short_name"], len(m["icons"]), "icons")
        pg.evaluate("navigator.serviceWorker.ready.then(() => true)")
        # 等 install 把整份檔案清單放進快取
        for _ in range(60):
            n = pg.evaluate("caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys().then(x => x.length))))).then(a => a.reduce((s, v) => s + v, 0))")
            if n >= 100: break
            pg.wait_for_timeout(500)
        print("cached files:", n)
        ctx.set_offline(True)
        pg.reload(); pg.wait_for_timeout(1500)
        title = pg.is_visible("#title")
        print("offline title visible:", title)
        pg.evaluate("localStorage.setItem('bg_seen_help','1')")
        pg.click(".pick-btn.green"); pg.wait_for_timeout(400); pg.click("#m-ai"); pg.wait_for_timeout(800)
        started = pg.is_visible("#battle")
        print("offline battle started:", started, "errors:", errs)
        ok = title and started and n >= 100 and not errs
        b.close()
finally:
    srv.terminate()
print("PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
