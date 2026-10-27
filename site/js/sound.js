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
  preloadSamples();
  applyMusic();
}
// 台北安可電視台遙控器的音量（0～1）與靜音：只在這次瀏覽有效，不改玩家自己存的靜音設定
let remoteVolume = 1, remoteMuted = false;
export function setRemoteVolume(volume, mutedFlag) {
  if (typeof volume === 'number' && Number.isFinite(volume)) remoteVolume = Math.max(0, Math.min(1, volume));
  if (typeof mutedFlag === 'boolean') remoteMuted = mutedFlag;
  applyMusic();
}
export const isMuted = () => muted;
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('bg_muted', v ? '1' : '0'); } catch { /* 忽略 */ }
  applyMusic();
}

// ── 背景音樂（ElevenLabs 生成，對戰畫面循環播放）與群眾音效 ──
let musicOn = true;
try { musicOn = localStorage.getItem('bg_music') !== '0'; } catch { /* 忽略 */ }
let bgm = null, musicWanted = false;
const MUSIC_VOL = 0.28;
function applyMusic() {
  if (!bgm) return;
  bgm.volume = Math.max(0, Math.min(1, MUSIC_VOL * remoteVolume));
  const silent = muted || remoteMuted || !musicOn || !musicWanted;
  if (silent) bgm.pause();
  else bgm.play().catch(() => { /* 還沒有使用者互動，之後再播 */ });
}
export const isMusicOn = () => musicOn;
export function setMusicOn(v) {
  musicOn = v;
  try { localStorage.setItem('bg_music', v ? '1' : '0'); } catch { /* 忽略 */ }
  applyMusic();
}
// 進對戰時 music(true)，回首頁 music(false)
export function music(on) {
  musicWanted = on;
  if (on && !bgm) {
    bgm = new Audio('assets/audio/bgm.mp3');
    bgm.loop = true;
    bgm.preload = 'auto';
  }
  if (!on && bgm) bgm.currentTime = 0;
  applyMusic();
}

// 群眾音效：第一次用到時下載並解碼，之後重複播放
const samples = {}, loading = {};
async function sample(name) {
  if (samples[name] || !ctx) return samples[name];
  if (!loading[name]) {
    loading[name] = fetch(`assets/audio/${name}.mp3`).then((r) => r.arrayBuffer())
      .then((b) => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej)))
      .then((buf) => { samples[name] = buf; return buf; }).catch(() => null);
  }
  return loading[name];
}
function playSample(name, vol = 0.5) {
  if (muted || remoteMuted || remoteVolume <= 0 || !ctx) return;
  sample(name).then((buf) => {
    if (!buf) return;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = vol * remoteVolume;
    src.buffer = buf;
    src.connect(g).connect(ctx.destination);
    src.start();
  });
}
// 先在背景下載，避免第一次播放時延遲
export function preloadSamples() { sample('cheer'); sample('ooh'); }

function tone(freq, dur, { type = 'sine', vol = 0.18, delay = 0, slide = 0 } = {}) {
  if (muted || remoteMuted || remoteVolume <= 0 || !ctx) return;
  vol *= remoteVolume;
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
  cheer: () => playSample('cheer', 0.45),
  ooh: () => playSample('ooh', 0.5),
};
