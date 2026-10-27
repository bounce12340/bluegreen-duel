"""Jev 前端整合測試（對電腦）：
1) Jev 正常時，宣告後顯示「含 Jev 判斷」
2) 停掉 Jev（假伺服器）後，宣告仍正常進行，改用歷史紀錄，瀏覽器有警告
3) 玩家習慣紀錄有存進 localStorage
用法：python3 tools/jev_client_test.py <停掉 Jev 的指令>
"""
import os, subprocess, sys, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8788/")
STOP_CMD = sys.argv[1] if len(sys.argv) > 1 else None
warns = []


def declare_once(pg):
    def my():
        return pg.evaluate("!document.querySelector('#end-btn').disabled && document.querySelector('#modal').classList.contains('hidden')")
    for _ in range(12):
        for _ in range(80):
            if my(): break
            if pg.is_visible("#m-pass"): pg.click("#m-pass")
            pg.wait_for_timeout(300)
        for i in range(len(pg.query_selector_all(".card"))):
            cs = pg.query_selector_all(".card")
            if i >= len(cs): break
            try:
                cs[i].click(timeout=2000)
            except Exception:
                continue
            pg.wait_for_timeout(200)
            if pg.is_visible("#m-declare") and pg.is_enabled("#m-declare"):
                pg.click("#m-declare"); pg.wait_for_timeout(200)
                it = pg.query_selector(".decl-item:not([disabled])")
                if it:
                    it.click()
                    for _ in range(40):
                        t = pg.inner_text("#toasts")
                        if "電腦研判" in t:
                            return [x for x in t.split("\n") if "電腦研判" in x][0]
                        pg.wait_for_timeout(200)
                    return "（沒看到研判提示）"
                pg.click("#m-back"); pg.wait_for_timeout(150)
            if pg.is_visible("#m-cancel"): pg.click("#m-cancel")
        if my(): pg.click("#end-btn")
        pg.wait_for_timeout(500)
    return None


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(locale="zh-TW", viewport={"width": 390, "height": 844})
    pg.on("console", lambda m: m.type in ("warning", "error") and warns.append(m.text))
    pg.goto(BASE); pg.wait_for_selector("#title:not(.hidden)")
    pg.click(".pick-btn.blue"); pg.click("#m-ai"); pg.wait_for_timeout(500)
    if pg.is_visible("#m-ok"): pg.click("#m-ok")
    print("Jev 正常：", declare_once(pg))
    if STOP_CMD:
        subprocess.run(STOP_CMD, shell=True); time.sleep(1)
        print("Jev 停掉後：", declare_once(pg))
        print("瀏覽器警告：", [w for w in warns if "Jev" in w][:2])
    print("記住的習慣：", pg.evaluate("localStorage.getItem('bg_profile')"))
    b.close()
