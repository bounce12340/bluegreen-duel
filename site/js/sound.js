// 簡易音效：用 Web Audio 即時合成，不需下載音檔。
// 瀏覽器規定要先有使用者點擊才能出聲，所以在選陣營時呼叫 unlock()。
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('bg_muted') === '1'; } catch { /* 無痕模式可能讀不到 */ }

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
export const isMuted = () => muted;
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('bg_muted', v ? '1' : '0'); } catch { /* 忽略 */ }
}

function tone(freq, dur, { type = 'sine', vol = 0.18, delay = 0, slide = 0 } = {}) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

export const sfx = {
  card: () => { tone(520, 0.08, { type: 'triangle' }); tone(780, 0.1, { type: 'triangle', delay: 0.06 }); },
  pull: () => { [660, 880, 1100].forEach((f, i) => tone(f, 0.12, { delay: i * 0.06, vol: 0.12 })); },
  hit: () => tone(220, 0.25, { type: 'sawtooth', slide: -120, vol: 0.12 }),
  status: () => tone(400, 0.3, { type: 'square', slide: 300, vol: 0.06 }),
  ult: () => { [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'square', delay: i * 0.08, vol: 0.07 })); },
  tick: () => tone(1200, 0.04, { vol: 0.08 }),
  trap: () => { tone(300, 0.15, { type: 'square', vol: 0.08 }); tone(200, 0.2, { type: 'square', delay: 0.12, vol: 0.08 }); },
  win: () => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, { type: 'triangle', delay: i * 0.12 })); },
  lose: () => { [440, 392, 349, 294].forEach((f, i) => tone(f, 0.35, { type: 'triangle', delay: i * 0.18, vol: 0.12 })); },
};
