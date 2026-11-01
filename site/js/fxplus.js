// 進階特效：canvas-confetti 彩帶、tsParticles 下雨與煙火、Lottie 大絕招動畫、PixiJS 背景震波、gl-transitions 轉場。
// 函式庫都打包在 site/vendor/（網站 CSP 只允許自家程式），第一次用到才 import()，不拖慢開場。
// 純裝飾：失敗就安靜略過；手機設了「減少動態效果」或省流量模式時整組不播。
import { playTransition } from './glfx.js';

const $ = (s) => document.querySelector(s);
export const fxReduced = () => (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)
  || !!(navigator.connection && navigator.connection.saveData);
const lazy = (url) => { let p; return () => (p ||= import(url).catch((e) => { p = null; throw e; })); };
const libConfetti = lazy('../vendor/fx-confetti.mjs');
const libParticles = lazy('../vendor/fx-particles.mjs');
const libLottie = lazy('../vendor/fx-lottie.mjs');
const libPixi = lazy('../vendor/fx-pixi.mjs');
const quiet = (p) => p.catch((e) => console.warn('特效載入失敗', e));
const COLORS = { blue: ['#2f6fd6', '#8db6ff', '#ffffff', '#ffcf3d'], green: ['#1f9a55', '#8fe3b3', '#ffffff', '#ffcf3d'] };

// 對戰中閒下來時先把大檔案抓好，真的要播時就不會卡一下
export function prefetchFx() {
  if (fxReduced()) return;
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
  idle(() => { quiet(libConfetti()); quiet(libParticles()); quiet(libLottie()); quiet(libPixi()); });
}

// ── 彩帶（canvas-confetti）────────────────────
let cannon;
async function getCannon() {
  if (cannon) return cannon;
  const { create } = await libConfetti();
  const cv = document.createElement('canvas');
  cv.className = 'fx-confetti-cv';
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  cannon = create(cv, { resize: true, useWorker: false, disableForReducedMotion: true });
  return cannon;
}
// kind：win 勝利兩側大砲｜epic 抽到史詩卡｜ult 大絕招｜combo 連擊；at：{x,y} 0–1 的畫面位置
export function confettiBurst(kind, side, at = { x: 0.5, y: 0.5 }) {
  if (fxReduced()) return;
  quiet(getCannon().then((fire) => {
    const colors = COLORS[side] || ['#ffcf3d', '#ff6b8b', '#6bd3ff', '#9dff7a', '#ffffff'];
    if (kind === 'win') {
      const end = performance.now() + 1600;
      const frame = () => {
        fire({ particleCount: 4, angle: 60, spread: 60, startVelocity: 55, origin: { x: 0, y: 0.75 }, colors });
        fire({ particleCount: 4, angle: 120, spread: 60, startVelocity: 55, origin: { x: 1, y: 0.75 }, colors });
        if (performance.now() < end) requestAnimationFrame(frame);
      };
      frame();
      setTimeout(() => fire({ particleCount: 120, spread: 100, startVelocity: 45, origin: { x: 0.5, y: 0.35 }, colors, shapes: ['square', 'circle', 'star'], scalar: 1.1 }), 500);
    } else if (kind === 'epic') {
      fire({ particleCount: 60, spread: 70, startVelocity: 30, origin: at, colors: ['#ffcf3d', '#fff3c4', '#ff78c8', '#78dcff'], shapes: ['star'], scalar: 0.9, ticks: 120 });
    } else if (kind === 'ult') {
      fire({ particleCount: 90, spread: 360, startVelocity: 38, origin: at, colors, shapes: ['star', 'circle'], ticks: 150 });
    } else {
      fire({ particleCount: 30, spread: 55, startVelocity: 28, origin: at, colors, ticks: 90 });
    }
  }));
}

// ── 天氣、煙火（tsParticles）───────────────────
let pHost, pContainer, pMode = null, pTimer;
// 背景是白天的藍天，雨絲要用偏深的藍灰色才看得到；下雨時整個畫面再壓暗一點（.fx-particles.wet）
const RAIN = (heavy) => ({
  fullScreen: { enable: false }, detectRetina: true, fpsLimit: 60, background: { opacity: 0 },
  particles: {
    number: { value: heavy ? 320 : 180, density: { enable: true, width: 400, height: 400 } },
    shape: { type: 'line' },
    paint: { stroke: { width: heavy ? 2.2 : 1.6, color: { value: heavy ? '#4f76b3' : '#6b8fc4' } } },
    opacity: { value: { min: 0.45, max: 0.85 } },
    size: { value: { min: 7, max: heavy ? 18 : 12 } },
    rotate: { value: heavy ? 72 : 82 },
    move: { enable: true, direction: 'bottom', straight: true, speed: { min: heavy ? 26 : 18, max: heavy ? 38 : 26 }, outModes: { default: 'out' }, drift: heavy ? 3 : 1 },
  },
});
const FIREWORKS = (colors) => ({
  fullScreen: { enable: false }, detectRetina: true, fpsLimit: 60, background: { opacity: 0 },
  particles: {
    number: { value: 0 },
    paint: { fill: { enable: true, color: { value: colors } } },
    shape: { type: 'circle' },
    opacity: { value: { min: 0, max: 1 }, animation: { enable: true, speed: 0.7, startValue: 'max', destroy: 'min' } },
    size: { value: { min: 2.5, max: 5 } },
    shadow: { enable: true, blur: 8, color: { value: '#ffffff' } },
    life: { count: 1, duration: { value: { min: 1.1, max: 1.8 } } },
    move: { enable: true, speed: { min: 8, max: 20 }, direction: 'none', outModes: { default: 'destroy' }, gravity: { enable: true, acceleration: 5 }, decay: 0.05 },
  },
  emitters: [0, 1, 2, 3].map((i) => ({
    position: { x: 18 + i * 22, y: 14 + (i % 2) * 14 },
    size: { width: 0, height: 0 },
    rate: { quantity: 60, delay: 1.1 + i * 0.3 },
    life: { wait: false },
  })),
});
function host() {
  if (pHost && pHost.isConnected) return pHost;
  pHost = document.createElement('div');
  pHost.className = 'fx-particles';
  pHost.setAttribute('aria-hidden', 'true');
  const battle = $('#battle');
  if (!battle) return null;
  battle.insertBefore(pHost, $('#opp-info'));  // 蓋在人偶上、兩邊資訊框底下
  return pHost;
}
// mode：'rain' | 'storm' | 'fireworks' | null；ms：幾毫秒後自動停（不給就一直播到下次切換）
export function weather(mode, ms, colors) {
  clearTimeout(pTimer);
  if (fxReduced()) mode = null;
  if (mode === pMode && !ms) return;
  pMode = mode;
  if (pContainer) { try { pContainer.destroy(); } catch { /* 忽略 */ } pContainer = null; }
  const el = host();
  if (!mode || !el) { if (el) el.classList.remove('on'); return; }
  const my = mode;
  quiet(libParticles().then(({ engine }) => engine()).then(async (eng) => {
    if (pMode !== my) return;
    const opts = mode === 'fireworks' ? FIREWORKS(colors || ['#ffcf3d', '#ff6b8b', '#6bd3ff', '#ffffff']) : RAIN(mode === 'storm');
    const c = await eng.load({ id: 'fxp', element: el, options: opts });
    if (pMode !== my) { c.destroy(); return; }
    pContainer = c;
    el.classList.toggle('wet', mode !== 'fireworks');
    el.classList.add('on');
  }));
  if (ms) pTimer = setTimeout(() => weather(null), ms);
}

// ── 大絕招全螢幕動畫（Lottie）─────────────────
const ULT_LOTTIE = { u_swap: 'ult_swap', u_report: 'ult_steady' };
export function ultLottie(ultId, side) {
  const file = ULT_LOTTIE[ultId];
  if (!file || fxReduced()) return Promise.resolve(false);
  return libLottie().then(({ default: lottie }) => new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = `fx-lottie ${side}`;
    box.setAttribute('aria-hidden', 'true');
    document.body.appendChild(box);
    const freeze = window.__fxFreeze; // 測試用：停在某個進度截圖
    const anim = lottie.loadAnimation({ container: box, renderer: 'svg', loop: false, autoplay: freeze == null, path: `assets/lottie/${file}.json` });
    let ended = false;
    const done = () => { if (ended) return; ended = true; box.classList.add('out'); setTimeout(() => { anim.destroy(); box.remove(); resolve(true); }, 250); };
    if (freeze != null) { anim.addEventListener('DOMLoaded', () => anim.goToAndStop(Math.round(anim.totalFrames * freeze), true)); resolve(true); return; }
    anim.addEventListener('complete', done);
    anim.addEventListener('data_failed', done);
    setTimeout(done, 3500); // 保險：檔案沒載到也不會卡住畫面
    confettiBurst('ult', side, { x: 0.5, y: 0.45 });
  })).catch(() => false);
}

// ── 背景震波（PixiJS + pixi-filters）──────────────
// 把對戰背景圖畫進一張 WebGL 畫布（疊在原背景上、人偶下面），在打擊點放震波＋放射模糊＋發光圈。
let px = null, pxBusy = false;
async function pixiStage() {
  if (px) return px;
  const P = await libPixi();
  const battle = $('#battle'), bg = battle && battle.querySelector('.bg');
  if (!bg) throw new Error('no bg');
  const app = new P.Application();
  await app.init({ backgroundAlpha: 0, antialias: true, resizeTo: battle, autoDensity: true, resolution: 1, preference: 'webgl' }); // 背景本來就柔焦，用 1 倍解析度就好，手機省電
  app.canvas.className = 'fx-pixi';
  app.canvas.setAttribute('aria-hidden', 'true');
  bg.parentElement.after(app.canvas);  // <picture> 後面、群眾畫布前面
  app.ticker.stop();
  px = { P, app, bgEl: bg, sprite: null, src: '' };
  return px;
}
function coverSprite(st) {
  // 跟 CSS 的 object-fit: cover; object-position: center top 一樣的擺法
  const { app, sprite } = st;
  const W = app.screen.width, H = app.screen.height;
  const iw = sprite.texture.width, ih = sprite.texture.height;
  const s = Math.max(W / iw, H / ih);
  sprite.scale.set(s);
  sprite.x = (W - iw * s) / 2;
  sprite.y = 0;
}
// at：{x,y} 相對於對戰畫面的像素；strength：1 一般大招、1.6 大絕招
export function shockwave(at, side, strength = 1) {
  if (fxReduced() || pxBusy) return;
  pxBusy = true;
  pixiStage().then(async (st) => {
    const { P, app } = st;
    const src = st.bgEl.currentSrc || st.bgEl.src;
    if (!st.sprite || st.src !== src) {
      // 直接用畫面上那張 <img>（已經載好了），不另外下載、也不開 Worker（CSP 不允許）
      if (!st.bgEl.complete) await new Promise((r) => st.bgEl.addEventListener('load', r, { once: true }));
      const tex = P.Texture.from(st.bgEl);
      if (st.sprite) st.sprite.destroy();
      st.sprite = new P.Sprite(tex);
      st.src = src;
      app.stage.removeChildren();
      app.stage.addChild(st.sprite);
    }
    app.resize();
    coverSprite(st);
    const color = side === 'blue' ? 0x4d8dff : side === 'green' ? 0x2fd17a : 0xffcf3d;
    const ring = new P.Graphics().circle(0, 0, 40).stroke({ width: 10, color, alpha: 0.9 });
    ring.position.set(at.x, at.y);
    const glow = new P.GlowFilter({ distance: 18, outerStrength: 3, color, quality: 0.2 });
    ring.filters = [glow];
    app.stage.addChild(ring);
    const wave = new P.ShockwaveFilter({ center: { x: at.x, y: at.y }, amplitude: 26 * strength, wavelength: 150, brightness: 1.15, radius: -1, speed: 900 });
    const zoom = new P.ZoomBlurFilter({ strength: 0.12 * strength, center: { x: at.x, y: at.y }, innerRadius: 60, maxKernelSize: 12 });
    st.sprite.filters = [wave, zoom];
    app.canvas.classList.add('on');
    const t0 = performance.now(), dur = 900;
    const freeze = window.__fxFreeze; // 測試用：停在某個進度截圖（tools/fxplus_test.py）
    const step = () => {
      const t = freeze ?? (performance.now() - t0) / dur;
      wave.time = t * 0.9;
      zoom.strength = Math.max(0, 0.12 * strength * (1 - t * 2));
      ring.scale.set(1 + t * 6 * strength);
      ring.alpha = Math.max(0, 1 - t * 1.3);
      app.render();
      if (freeze != null) return;
      if (t < 1) { requestAnimationFrame(step); return; }
      app.canvas.classList.remove('on');
      st.sprite.filters = null;
      ring.destroy();
      setTimeout(() => { pxBusy = false; }, 120);
    };
    requestAnimationFrame(step);
  }).catch((e) => { pxBusy = false; console.warn('震波特效略過', e); });
}

// ── 開局 VS 與結算轉場（gl-transitions）────────────
const loadImg = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
function sizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = Math.round(window.innerWidth * dpr); c.height = Math.round(window.innerHeight * dpr);
  return c;
}
function paintSide(ctx, x, w, h, side, img, label, flip) {
  const g = ctx.createLinearGradient(x, 0, x + w, h);
  g.addColorStop(0, side === 'blue' ? '#1b3f8f' : '#0f5c33');
  g.addColorStop(1, side === 'blue' ? '#3b7ff0' : '#25b465');
  ctx.fillStyle = g; ctx.fillRect(x, 0, w, h);
  const ih = h * 0.62, iw = ih * (img.width / img.height);
  ctx.save();
  if (flip) { ctx.translate(x + w / 2, 0); ctx.scale(-1, 1); ctx.drawImage(img, -iw / 2, h * 0.2, iw, ih); } else ctx.drawImage(img, x + (w - iw) / 2, h * 0.2, iw, ih);
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${Math.round(h * 0.06)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, h * 0.14);
}
// 開局：先是我方全螢幕，轉場成雙方對峙的 VS 畫面
export async function versusIntro(me, names) {
  if (fxReduced()) return;
  try {
    const opp = me === 'blue' ? 'green' : 'blue';
    const [a, b] = await Promise.all([loadImg(`assets/${me}_happy.webp`), loadImg(`assets/${opp}_smug.webp`)]);
    const from = sizeCanvas(), to = sizeCanvas();
    const W = from.width, H = from.height;
    paintSide(from.getContext('2d'), 0, W, H, me, a, names[me], false);
    const c = to.getContext('2d');
    const left = me === 'blue' ? 'blue' : 'green';
    paintSide(c, 0, W / 2, H, left, left === me ? a : b, names[left], false);
    paintSide(c, W / 2, W / 2, H, left === 'blue' ? 'green' : 'blue', left === me ? b : a, names[left === 'blue' ? 'green' : 'blue'], true);
    c.fillStyle = '#ffcf3d'; c.strokeStyle = '#1b2333'; c.lineWidth = H * 0.012;
    c.font = `italic 900 ${Math.round(H * 0.16)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.strokeText('VS', W / 2, H * 0.55); c.fillText('VS', W / 2, H * 0.55);
    await playTransition(from, to, 'crosszoom', { dur: 900, hold: 650, fadeOut: 350 });
  } catch (e) { console.warn('開場轉場略過', e); }
}
// 結算：從對戰畫面的勝負姿勢轉到勝方大圖（贏了用夢幻放大、輸了用故障雜訊）
export async function resultTransition(me, winner) {
  if (fxReduced()) return;
  try {
    const opp = me === 'blue' ? 'green' : 'blue';
    const draw = winner === 'draw';
    const [a, b] = await Promise.all([loadImg(`assets/${me}_${draw ? 'idle' : winner === me ? 'happy' : 'hurt'}.webp`), loadImg(`assets/${opp}_${draw ? 'idle' : winner === opp ? 'happy' : 'hurt'}.webp`)]);
    const w = draw ? me : winner;
    const big = await loadImg(`assets/${w}_win.webp`);
    const from = sizeCanvas(), to = sizeCanvas();
    const W = from.width, H = from.height;
    const left = me === 'blue' ? 'blue' : 'green';
    const f = from.getContext('2d');
    paintSide(f, 0, W / 2, H, left, left === me ? a : b, '', false);
    paintSide(f, W / 2, W / 2, H, left === 'blue' ? 'green' : 'blue', left === me ? b : a, '', true);
    paintSide(to.getContext('2d'), 0, W, H, w, big, '', false);
    await playTransition(from, to, draw ? 'doorway' : winner === me ? 'dreamy' : 'glitch', { dur: 1000, hold: 250, fadeOut: 300 });
  } catch (e) { console.warn('結算轉場略過', e); }
}

// ── 換畫面（View Transitions API）───────────────
export function withViewTransition(update) {
  if (fxReduced() || !document.startViewTransition) { update(); return; }
  try { document.startViewTransition(update); } catch { update(); }
}
