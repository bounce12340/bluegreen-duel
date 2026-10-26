// 群眾小人：100 個用同一張 Canvas 批次畫，不用 100 個 DOM 元素，手機才跑得動。
const COLORS = {
  blue: { body: '#2f6fd6', flag: '#8db6ff' },
  green: { body: '#1f9a55', flag: '#8fe3b3' },
  n: { body: '#9aa3ad', flag: null },
};
const SKIN = ['#f6d7b8', '#eec39a', '#f3cfae', '#e0b08a'];
const HAIR = ['#2b2b2b', '#4a3426', '#1e1e1e', '#6b4b33'];

function seeded(seed) {
  let a = seed;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

// 各區在畫面中的範圍（寬、高比例）：[x0, x1, y0, y1]
const ZONES = {
  opp: [0.40, 0.99, 0.395, 0.45],
  n: [0.04, 0.96, 0.455, 0.53],
  me: [0.42, 0.99, 0.54, 0.605],
};

export function createCrowd(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, running = false, raf = 0, last = 0;
  let sideColor = { me: 'blue', opp: 'green' };
  const spots = { n: [], me: [], opp: [] };
  const used = { n: new Set(), me: new Set(), opp: new Set() };
  const rnd = seeded(42);
  const figs = Array.from({ length: 100 }, (_, i) => ({
    owner: 'n', spot: i, x: 0, y: 0, ph: rnd() * Math.PI * 2,
    skin: SKIN[i % 4], hair: HAIR[(i * 7) % 4], flash: 0,
  }));
  figs.forEach((f) => used.n.add(f.spot));

  function genSpots() {
    for (const z of ['n', 'me', 'opp']) {
      const r = seeded(z === 'n' ? 7 : z === 'me' ? 11 : 13);
      const [x0, x1, y0, y1] = ZONES[z];
      spots[z] = Array.from({ length: 100 }, () => ({ x: (x0 + (x1 - x0) * r()) * W, y: (y0 + (y1 - y0) * r()) * H }));
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    genSpots();
    for (const f of figs) { const p = spots[f.owner][f.spot]; f.x = p.x; f.y = p.y; }
  }

  function takeSpot(owner) {
    for (let i = 0; i < 100; i++) if (!used[owner].has(i)) { used[owner].add(i); return i; }
    return 0;
  }
  function move(f, owner) {
    used[f.owner].delete(f.spot);
    f.owner = owner;
    f.spot = takeSpot(owner);
    f.flash = 1;
  }

  // 依人數差異，把小人搬到正確的陣營
  function setCounts(meN, oppN) {
    const count = (o) => figs.filter((f) => f.owner === o).length;
    let m = count('me'), o = count('opp');
    while (m > meN) { move(figs.find((f) => f.owner === 'me'), 'n'); m--; }
    while (o > oppN) { move(figs.find((f) => f.owner === 'opp'), 'n'); o--; }
    const neutrals = () => figs.filter((f) => f.owner === 'n');
    while (m < meN) {
      const pool = neutrals(); if (!pool.length) break;
      move(pool.reduce((a, b) => (b.y > a.y ? b : a)), 'me'); m++;
    }
    while (o < oppN) {
      const pool = neutrals(); if (!pool.length) break;
      move(pool.reduce((a, b) => (b.y < a.y ? b : a)), 'opp'); o++;
    }
  }

  function drawFig(f, t) {
    const scale = Math.max(0.7, Math.min(1.25, 0.75 + (f.y / H - 0.3) * 1.6));
    const s = H * 0.024 * scale;
    const bob = Math.sin(t * 4 + f.ph) * s * 0.06;
    const x = f.x, y = f.y + bob;
    const col = f.owner === 'n' ? COLORS.n : COLORS[sideColor[f.owner]];
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,.15)';
    ctx.beginPath(); ctx.ellipse(x, f.y + s * 0.02, s * 0.32, s * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    // 身體
    ctx.fillStyle = col.body;
    ctx.beginPath(); ctx.roundRect(x - s * 0.24, y - s * 0.58, s * 0.48, s * 0.56, s * 0.16); ctx.fill();
    // 頭
    ctx.fillStyle = f.skin;
    ctx.beginPath(); ctx.arc(x, y - s * 0.78, s * 0.24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = f.hair;
    ctx.beginPath(); ctx.arc(x, y - s * 0.83, s * 0.24, Math.PI, Math.PI * 2); ctx.fill();
    // 支持者揮旗
    if (col.flag) {
      const a = Math.sin(t * 6 + f.ph) * 0.35;
      const hx = x + s * 0.24, hy = y - s * 0.5;
      const tx = hx + Math.sin(a) * s * 0.7, ty = hy - Math.cos(a) * s * 0.7;
      ctx.strokeStyle = '#6b5a45'; ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = col.flag;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + s * 0.36, ty + s * 0.1); ctx.lineTo(tx, ty + s * 0.24); ctx.fill();
    }
    if (f.flash > 0) {
      ctx.fillStyle = `rgba(255,236,120,${f.flash * 0.7})`;
      ctx.beginPath(); ctx.arc(x, y - s * 0.55, s * 0.55, 0, Math.PI * 2); ctx.fill();
    }
  }

  function frame(ts) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (ts - last < 33) return; // 約 30fps
    last = ts;
    const t = ts / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const f of figs) {
      const p = spots[f.owner][f.spot];
      f.x += (p.x - f.x) * 0.12; f.y += (p.y - f.y) * 0.12;
      if (f.flash > 0) f.flash = Math.max(0, f.flash - 0.04);
    }
    const order = [...figs].sort((a, b) => a.y - b.y);
    for (const f of order) drawFig(f, t);
  }

  let wanted = false; // 是否在對戰畫面中
  function run() { if (running) return; running = true; raf = requestAnimationFrame(frame); }
  function pause() { running = false; cancelAnimationFrame(raf); }
  function start() { wanted = true; run(); }
  function stop() { wanted = false; pause(); }
  // 切到背景分頁就暫停，省電
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else if (wanted) run(); });
  window.addEventListener('resize', resize);

  function reset(colors) {
    sideColor = colors;
    used.n.clear(); used.me.clear(); used.opp.clear();
    figs.forEach((f, i) => { f.owner = 'n'; f.spot = i; f.flash = 0; used.n.add(i); });
    resize();
  }

  return { reset, setCounts, start, stop, resize };
}
