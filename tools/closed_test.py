"""投票日關站測試：投票日顯示關閉畫面；前一天正常；電視台展示模式跨日進入投票日會停止並顯示關閉畫面。
用法：python3 tools/closed_test.py"""
import os, subprocess, sys, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8774"], cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site"),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(locale="zh-TW", viewport={"width": 390, "height": 844})
        pg.clock.set_fixed_time("2026-11-28T10:00:00+08:00")
        pg.goto("http://localhost:8774/index.html"); pg.wait_for_timeout(800)
        print("投票日顯示關閉畫面:", pg.is_visible("#closed"), pg.inner_text("#closed-msg"))
        pg2 = b.new_page(locale="zh-TW"); pg2.clock.set_fixed_time("2026-11-27T23:00:00+08:00")
        pg2.goto("http://localhost:8774/index.html"); pg2.wait_for_timeout(800)
        print("前一天正常:", pg2.is_visible("#title"))
        # 展示模式：11/27 23:59:40 開著，閒置 25 秒後已跨到 11/28
        pg3 = b.new_page(locale="zh-TW"); pg3.clock.install(time="2026-11-27T23:59:40+08:00")
        pg3.goto("http://localhost:8774/index.html?tv=1"); pg3.wait_for_timeout(800)
        pg3.clock.run_for(27_000); pg3.wait_for_timeout(500)
        print("展示模式跨日後顯示關閉畫面:", pg3.is_visible("#closed"), "| 展示對戰沒有開始:", not pg3.is_visible("#battle"))
        b.close()
finally:
    srv.terminate()
