// 全像閃卡：稀有、史詩卡的反光跟著手指（滑鼠）位置或手機傾斜角度變化。
// 做法：在卡片上設定 CSS 變數 --mx/--my（光點位置 %）、--rot（傾斜）、--ho（反光強度），樣式在 style.css 的 .holo 區塊。
// 自己寫的；只參考了「用 CSS 變數 + 混色模式做全像卡」這個常見手法。
const SEL = '.holo';
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
let tiltOn = false;     // 已收到陀螺儀資料
let touching = null;    // 手指正壓著的卡（優先於陀螺儀）

function setVars(el, px, py, strength = 1) {
  // px/py：0–1
  const x = Math.max(0, Math.min(1, px)), y = Math.max(0, Math.min(1, py));
  el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
  el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
  // 傾斜用 CSS 的 rotate（軸＋角度），跟卡片原本的 transform 動畫互不干擾
  const rx = (0.5 - y) * 16 * strength, ry = (x - 0.5) * 20 * strength, ang = Math.hypot(rx, ry);
  el.style.setProperty('--rot', ang < 0.05 ? 'none' : `${rx.toFixed(3)} ${ry.toFixed(3)} 0 ${ang.toFixed(2)}deg`);
  el.style.setProperty('--ho', String(0.35 + Math.hypot(x - 0.5, y - 0.5) * 1.1));
}
function reset(el) {
  for (const k of ['--mx', '--my', '--rot', '--ho']) el.style.removeProperty(k);
  el.classList.remove('holo-live');
}

function onMove(e) {
  const el = e.target.closest && e.target.closest(SEL);
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  el.classList.add('holo-live');
  setVars(el, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  if (e.pointerType === 'touch') touching = el;
}
function onLeave(e) {
  const el = e.target.closest && e.target.closest(SEL);
  if (el && !tiltOn) reset(el);
  if (touching === el) touching = null;
}

// 手機傾斜：beta 前後（-180~180）、gamma 左右（-90~90）。以第一次讀到的姿勢當中心，慢慢跟上，避免拿著手機就整張偏掉
let base = null;
function onTilt(e) {
  if (e.beta == null || e.gamma == null) return;
  if (!base) base = { b: e.beta, g: e.gamma };
  base.b += (e.beta - base.b) * 0.01;
  base.g += (e.gamma - base.g) * 0.01;
  const px = 0.5 + Math.max(-1, Math.min(1, (e.gamma - base.g) / 25)) * 0.5;
  const py = 0.5 + Math.max(-1, Math.min(1, (e.beta - base.b) / 25)) * 0.5;
  tiltOn = true;
  for (const el of document.querySelectorAll(SEL)) {
    if (el === touching || !el.isConnected || !el.offsetParent) continue;
    el.classList.add('holo-live');
    setVars(el, px, py, 0.8);
  }
}

// iOS 要使用者點過才能要陀螺儀權限；在第一次點到閃卡時才問，不在開場就跳視窗
let asked = false;
function askTilt() {
  if (asked) return;
  asked = true;
  const D = window.DeviceOrientationEvent;
  if (!D) return;
  if (typeof D.requestPermission === 'function') {
    D.requestPermission().then((s) => { if (s === 'granted') window.addEventListener('deviceorientation', onTilt); }).catch(() => {});
  } else window.addEventListener('deviceorientation', onTilt);
}

export function initHolo() {
  if (reduced()) return;
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest(SEL)) { onMove(e); askTilt(); } }, { passive: true });
  document.addEventListener('pointerout', onLeave, { passive: true });
  document.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') onLeave(e); }, { passive: true });
  // Android 不用權限，一開始就能讀
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== 'function') askTilt();
}

// 卡片 class 用：稀有、史詩加上 holo（史詩更強）
export const holoClass = (rarity) => (rarity === 'epic' ? 'holo holo-epic' : rarity === 'rare' ? 'holo' : '');
