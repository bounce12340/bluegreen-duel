"""進階特效測試（手機直式、套正式 CSP）：VS 開場轉場、全像閃卡、彩帶、下雨／煙火、Lottie 大絕招、Pixi 震波、結算轉場。
每種特效截一張圖，並檢查有沒有 CSP 違規或 JS 錯誤。
用法：python3 tools/fxplus_test.py [輸出資料夾]；BASE 預設 http://127.0.0.1:8790/（要帶 _headers 裡的 CSP）
"""
import os, sys, time
T0 = time.time()
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:8790/")
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fxplus"
os.makedirs(OUT, exist_ok=True)
errors, csp = [], []

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(locale="zh-TW", viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    pg.add_init_script("document.addEventListener('securitypolicyviolation', e => console.error('CSP ' + e.violatedDirective + ' ' + e.blockedURI))")
    pg.on("pageerror", lambda e: errors.append(str(e)))
    # 本機沒有 Worker，/api/status 的 404 不算
    pg.on("console", lambda m: (csp if m.text.startswith("CSP ") else errors).append(m.text) if m.type == "error" and "404" not in m.text else None)
    pg.on("console", lambda m: errors.append(m.text) if m.type == "warning" and ("特效" in m.text or "轉場" in m.text or "震波" in m.text) else None)
    pg.set_default_timeout(15000)

    def shot(name, sel=None):
        print("shot", name, round(time.time() - T0, 1), flush=True)
        (pg.locator(sel) if sel else pg).screenshot(path=f"{OUT}/{name}", animations="allow", timeout=30000)

    pg.goto(BASE); pg.wait_for_selector("#title:not(.hidden)"); print("title", flush=True)
    pg.click(".pick-btn.blue"); pg.click("#m-ai")
    pg.wait_for_timeout(700); shot("1_vs_intro.png")
    pg.wait_for_timeout(1800)
    if pg.is_visible("#m-ok"): pg.click("#m-ok")
    pg.wait_for_timeout(600)
    has_gl = pg.evaluate("!!document.createElement('canvas').getContext('webgl')")
    print("WebGL:", has_gl)

    fx = "const m = await import('./js/fxplus.js');"
    # 全像閃卡：在一張手牌上加 holo、模擬手指移到右上角
    pg.evaluate("""() => { const c = document.querySelector('#hand .card'); c.classList.add('holo','holo-epic','epic');
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.right - 8, clientY: r.top + 10, pointerType: 'mouse' })); }""")
    pg.wait_for_timeout(200)
    print("holo vars:", pg.evaluate("(() => { const c = document.querySelector('#hand .card'); return [c.style.getPropertyValue('--rot'), getComputedStyle(c).rotate]; })()"))
    shot("2_holo_hand.png", "#hand")

    pg.evaluate(f"async () => {{ {fx} m.confettiBurst('epic', 'blue', {{ x: 0.5, y: 0.8 }}); }}")
    pg.wait_for_timeout(500); shot("3_confetti_epic.png")

    pg.evaluate("() => { const m = document.querySelector('#modal'); if (m) m.classList.add('hidden'); }")  # 收掉策略視窗，看得清楚
    pg.evaluate(f"async () => {{ {fx} m.weather('storm'); }}")
    pg.wait_for_timeout(2500); shot("4_storm.png")
    pg.evaluate(f"async () => {{ {fx} m.weather('fireworks'); }}")
    pg.wait_for_timeout(3500); shot("5_fireworks.png")
    pg.evaluate(f"async () => {{ {fx} m.weather(null); }}")
    # Lottie：停在 45% 進度截圖
    pg.evaluate(f"async () => {{ window.__fxFreeze = 0.45; {fx} await m.ultLottie('u_swap', 'green'); }}")
    pg.wait_for_timeout(1200); shot("6_lottie_swap.png")
    pg.evaluate("() => document.querySelectorAll('.fx-lottie').forEach((e) => e.remove())")
    pg.evaluate(f"async () => {{ window.__fxFreeze = 0.5; {fx} await m.ultLottie('u_report', 'blue'); }}")
    pg.wait_for_timeout(1200); shot("7_lottie_steady.png")
    pg.evaluate("() => { document.querySelectorAll('.fx-lottie').forEach((e) => e.remove()); window.__fxFreeze = undefined; }")

    # 震波：先完整播一次（第一次要載 Pixi），再停在 30% 進度截圖
    pg.evaluate(f"async () => {{ {fx} const b = document.querySelector('#battle'); m.shockwave({{ x: b.clientWidth / 2, y: b.clientHeight / 2 }}, 'blue', 1.4); }}")
    pg.wait_for_timeout(5000)
    pg.evaluate(f"async () => {{ window.__fxFreeze = 0.3; {fx} const b = document.querySelector('#battle'); m.shockwave({{ x: b.clientWidth / 2, y: b.clientHeight / 2 }}, 'green', 1.4); }}")
    pg.wait_for_timeout(1500); shot("8_shockwave.png")
    pg.evaluate("() => { window.__fxFreeze = undefined; document.querySelector('.fx-pixi').classList.remove('on'); }")
    print("pixi canvas:", pg.evaluate("!!document.querySelector('.fx-pixi')"))
    pg.wait_for_timeout(1200)

    pg.evaluate(f"async () => {{ {fx} m.confettiBurst('win', 'blue'); }}")
    pg.wait_for_timeout(900); shot("9_confetti_win.png")
    pg.wait_for_timeout(1500)

    pg.evaluate(f"async () => {{ {fx} m.resultTransition('blue', 'blue'); }}")
    pg.wait_for_timeout(650); shot("10_result_win.png")
    pg.wait_for_timeout(1500)
    pg.evaluate(f"async () => {{ {fx} m.resultTransition('blue', 'green'); }}")
    pg.wait_for_timeout(450); shot("11_result_lose.png")
    pg.wait_for_timeout(1500)
    b.close()

print("CSP 違規：", csp or "無")
print("錯誤：", errors or "無")
sys.exit(1 if csp or errors else 0)
