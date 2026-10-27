// 場上卡牌特效。
// 持續效果跟著遊戲狀態同步（syncBoard）：場地（造勢晚會舞台燈光）、雙方狀態（包圍、追問、頭暈…）、
// 召喚出來的小隊、蓋著的陷阱牌。單次效果跟著事件播放（playFx）：拉票人潮、挖角、下雨、翻牌、大絕招等。
// 純裝飾：不改遊戲狀態；位置一律從人偶與平台的實際位置算，直式、橫式版面都適用。

const $ = (s) => document.querySelector(s);
const other = (side) => (side === 'blue' ? 'green' : 'blue');
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

// 召喚物圖示（中英文名稱都對得到：連線時伺服器送中文名，英文版本機是英文名）
const SUMMON_ICON = {
  志工團: '🦺', Volunteers: '🦺', 青年軍: '📱', 'Youth Squad': '📱', 服務隊: '🛠️', 'Service Crew': '🛠️',
  小編團: '💻', 'Social Team': '💻', 青鳥群: '🐦', 'Bluebird Flock': '🐦', 市政團隊: '👷', 'City Team': '👷',
};

let battle, layer, stage, rain;
const box = { me: {}, opp: {} };   // 每一方：aura（狀態）、troops（召喚）、traps（蓋牌）
let last = null;                   // 上一次同步的參數，視窗改變大小時重新定位用

function el(cls, html = '', tag = 'div') {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function initFx() {
  battle = $('#battle');
  layer = el('fx-layer');
  layer.setAttribute('aria-hidden', 'true');
  stage = el('stage-fx hidden', '<i class="beam l"></i><i class="beam r"></i><div class="confetti"></div>');
  const conf = stage.querySelector('.confetti');
  for (let i = 0; i < 18; i++) {
    const c = el('cf');
    c.style.left = `${(i * 37) % 100}%`;
    c.style.animationDelay = `${-(i * 0.37) % 3.2}s`;
    c.style.animationDuration = `${2.6 + (i % 5) * 0.35}s`;
    c.style.background = ['#ffcf3d', '#ff6b8b', '#6bd3ff', '#9dff7a', '#fff'][i % 5];
    conf.appendChild(c);
  }
  rain = el('rain-fx hidden');
  layer.append(stage, rain);
  for (const k of ['me', 'opp']) {
    for (const part of ['aura', 'troops', 'traps']) {
      box[k][part] = el(`fx-${part} ${k}`);
      layer.appendChild(box[k][part]);
    }
  }
  // 放在人偶之上、提示文字與手牌之下
  battle.insertBefore(layer, $('#me-info'));
  window.addEventListener('resize', () => { if (last) syncBoard(...last); });
}

// 元素相對於對戰畫面的位置
function rectOf(sel) {
  const b = battle.getBoundingClientRect(), r = $(sel).getBoundingClientRect();
  return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height, cx: r.left - b.left + r.width / 2, cy: r.top - b.top + r.height / 2 };
}
const wide = () => battle.clientWidth / Math.max(1, battle.clientHeight) > 1.25;
// 中間選民站的位置（跟 crowd.js 的區域一致）
function crowdPoint() {
  const W = battle.clientWidth, H = battle.clientHeight;
  return wide() ? { x: W * (0.38 + Math.random() * 0.24), y: H * (0.56 + Math.random() * 0.05) }
    : { x: W * (0.15 + Math.random() * 0.7), y: H * (0.46 + Math.random() * 0.07) };
}
const mascotOf = (key) => rectOf(key === 'me' ? '#me-mascot' : '#opp-mascot');

// ── 持續效果 ─────────────────────────────
export function syncBoard(game, me, opp, opts = {}) {
  if (!layer) return;
  last = [game, me, opp, opts];
  if (!game) { for (const k of ['me', 'opp']) for (const p of Object.values(box[k])) p.innerHTML = ''; setField(null); return; }
  const keys = { [me]: 'me', [opp]: 'opp' };
  for (const side of [me, opp]) {
    const key = keys[side];
    const p = game.players[side];
    const m = mascotOf(key);
    if (!m.h) continue;
    // 狀態光環：蓋在人偶上
    const a = box[key].aura;
    Object.assign(a.style, { left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px` });
    a.style.setProperty('--s', `${m.h}px`);
    syncKeyed(a, p.statuses.map((st) => [st.id, st]), (id) => statusNode(id, side));
    // 召喚小隊：站在人偶旁邊
    const t = box[key].troops;
    const tx = key === 'me' ? m.x + m.w * 0.78 : m.x + m.w * 0.12;
    // 直式手機：我方右下角有資訊框，小隊放高一點避開
    const ty = key === 'me' && !wide() ? m.y + m.h * 0.12 : m.y + m.h * 0.48;
    Object.assign(t.style, { left: `${tx}px`, top: `${ty}px` });
    t.style.setProperty('--s', `${m.h}px`);
    syncKeyed(t, p.summons.map((sm, i) => [`${sm.name}#${i}`, sm]), (k, sm) => troopNode(sm, side), (node, sm) => {
      node.querySelector('b').textContent = `×${sm.turns}`;
    });
    // 蓋著的陷阱：放在平台前緣。自己的看得到是哪張；對手的只有被起底時才翻開
    const tr = box[key].traps;
    const plat = rectOf(key === 'me' ? '#me-plat' : '#opp-plat');
    Object.assign(tr.style, { left: `${key === 'me' ? m.x + m.w * 0.05 : m.x + m.w * 0.5}px`, top: `${plat.cy - m.h * 0.02}px` });
    tr.style.setProperty('--s', `${m.h}px`);
    const exposed = p.statuses.some((st) => st.id === 'exposed');
    syncKeyed(tr, p.traps.map((x, i) => [`t${i}`, x]), (k, x) => trapNode(x, side, key === 'me' || exposed), (node, x) => {
      const open = !!((key === 'me' || exposed) && x && x.id);
      if (open !== node.classList.contains('open')) { const nn = trapNode(x, side, key === 'me' || exposed); nn.dataset.k = node.dataset.k; node.replaceWith(nn); }
    });
  }
  setField(game.field ? game.field.owner : null);
}

// 依 key 增減子元素：新的播進場動畫，消失的播退場動畫
function syncKeyed(parent, items, make, update) {
  const want = new Map(items);
  for (const node of [...parent.children]) {
    if (node.classList.contains('leaving')) continue;
    if (!want.has(node.dataset.k)) {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 450);
    }
  }
  for (const [k, v] of want) {
    let node = [...parent.children].find((n) => n.dataset.k === k && !n.classList.contains('leaving'));
    if (!node) {
      node = make(k, v);
      if (!node) continue;
      node.dataset.k = k;
      node.classList.add('entering');
      setTimeout(() => node.classList.remove('entering'), 700);
      parent.appendChild(node);
    } else if (update) update(node, v);
  }
}

function statusNode(id, side) {
  // 包圍：攻擊方是綠營就是青鳥，藍營就是工程帽
  const swarm = other(side) === 'green' ? '🐦' : '👷';
  const ring = (icon, n) => Array.from({ length: n }, (_, i) => `<span style="animation-delay:${-(i * 2.4) / n}s">${icon}</span>`).join('');
  switch (id) {
    case 'encircle': return el('st st-encircle', ring(swarm, 6));
    case 'question': return el('st st-question', '<span>❓</span><span>❓</span><span>❓</span><span class="mic">🎤</span>');
    case 'deflect': return el('st st-deflect', ring('💫', 4));
    case 'gaffe': return el('st st-gaffe', '<span>🤐</span><span class="x">🎙️</span>');
    case 'exposed': return el('st st-exposed', '<i class="spot"></i><span>🔍</span>');
    case 'sympathy': return el('st st-sympathy', '<i class="glow"></i><span>💗</span><span>💗</span><span>🥺</span>');
    case 'burst': return el('st st-burst', '<i class="flame"></i><span>🔥</span>');
    case 'ultBoost': return el('st st-boost', '<i class="dome"></i><span>🛡️</span>');
    case 'reflect': return el('st st-reflect', '<i class="mirror"></i><span>🪞</span>');
    default: return null;
  }
}

function troopNode(sm, side) {
  const icon = SUMMON_ICON[sm.name] || '👥';
  return el(`troop ${side}`, `<span>${icon}</span><span>${icon}</span><span>${icon}</span><b>×${sm.turns}</b>`);
}

function trapNode(x, side, open) {
  const known = open && x && x.id;
  const n = el(`trap-card ${side} ${known ? 'open' : ''}`);
  n.innerHTML = known ? `<img src="assets/cards/${x.art || x.id}.webp" alt="">` : '<span>?</span>';
  return n;
}

let fieldOwner = null;
function setField(owner) {
  if (owner === fieldOwner) return;
  fieldOwner = owner;
  stage.classList.toggle('hidden', !owner);
  stage.classList.remove('blue', 'green');
  if (owner) stage.classList.add(owner);
}

// ── 單次效果 ─────────────────────────────
// ctx：{ me, opp, card(id) → 卡牌資料 }
export function playFx(ev, ctx) {
  if (!layer || reduced()) return;
  const key = (side) => (side === ctx.me ? 'me' : 'opp');
  try {
    switch (ev.type) {
      case 'pull': if (ev.n > 0) stream(null, key(ev.side), ev.side, Math.min(14, 3 + ev.n)); break;
      case 'poach': if (ev.n > 0) stream(key(other(ev.side)), key(ev.side), ev.side, Math.min(12, 3 + ev.n)); break;
      case 'encircle': if (ev.n > 0) stream(key(ev.side), key(other(ev.side)), other(ev.side), 4 + ev.n); break;
      case 'play': {
        const c = !ev.hidden && ctx.card(ev.card);
        if (!c) break;
        if (c.fx.voice) megaphone(key(ev.side));
        if (c.fx.draw) cardsToHand(key(ev.side), c.fx.draw);
        if (c.fx.ap) sunrise(key(ev.side));
        break;
      }
      case 'status': impact(key(ev.side), ev.status); break;
      case 'setTrap': trapDrop(key(ev.side), ev.side); break;
      case 'trap':
        trapFlip(key(ev.side), ev.side, ev.trap);
        if (ev.trap === 'rain') setTimeout(() => rainFor(2600), 350);
        if (ev.trap === 'flip') setTimeout(() => ballots(key(other(ev.side))), 450);
        break;
      case 'summon': flock(key(ev.side), SUMMON_ICON[ev.name] || '👥', 5); break;
      case 'field': spotlights(); break;
      case 'reflect': mirrorFlash(key(ev.side)); break;
      case 'miss': whoosh(key(ev.side)); break;
      case 'expose': magnify(key(ev.side)); break;
      case 'sympathy': hearts(key(ev.side)); break;
      case 'burst': flameRing(key(ev.side)); break;
      case 'ult': ultFx(ev.ult, key(ev.side), key(other(ev.side)), ev.side); break;
      case 'challenge': stamp(key(ev.caught ? other(ev.side) : ev.side), ev.caught ? '🚨' : '❌'); break;
      case 'draw': drawCard(key(ev.side), ev.side); break;
      default: break;
    }
  } catch (e) { console.warn('特效播放失敗', e); }
}

// 一顆會飛的小東西：from/to 為 {x,y}
function fly(html, from, to, { dur = 900, delay = 0, arc = -60, cls = '', scale = 1 } = {}) {
  const n = el(`fx-fly ${cls}`, html);
  n.style.left = `${from.x}px`; n.style.top = `${from.y}px`;
  layer.appendChild(n);
  const dx = to.x - from.x, dy = to.y - from.y;
  const a = n.animate([
    { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
    { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 + arc}px)) scale(${scale})`, opacity: 1, offset: 0.5 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale * 0.7})`, opacity: 0.2 },
  ], { duration: dur, delay, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'both' });
  a.onfinish = () => n.remove();
  return n;
}
// 在某個位置播一段 CSS 動畫的元素，播完自動移除
function pop(cls, html, at, ms = 1400, size) {
  const n = el(`fx-pop ${cls}`, html);
  n.style.left = `${at.x}px`; n.style.top = `${at.y}px`;
  if (size) n.style.setProperty('--s', `${size}px`);
  layer.appendChild(n);
  setTimeout(() => n.remove(), ms);
  return n;
}
const head = (k) => { const m = mascotOf(k); return { x: m.cx, y: m.y + m.h * 0.2, h: m.h }; };
const body = (k) => { const m = mascotOf(k); return { x: m.cx, y: m.y + m.h * 0.55, h: m.h }; };

// 選民流向：從中間（或對手身上）飛到這一方
function stream(fromKey, toKey, color, n) {
  const to = body(toKey);
  for (let i = 0; i < n; i++) {
    const from = fromKey ? { x: body(fromKey).x + (Math.random() - 0.5) * 40, y: body(fromKey).y + (Math.random() - 0.5) * 40 } : crowdPoint();
    fly(`<i class="voter ${color}"></i>`, from, { x: to.x + (Math.random() - 0.5) * 30, y: to.y }, { dur: 700 + Math.random() * 300, delay: i * 45, arc: -30 - Math.random() * 60 });
  }
}
function megaphone(k) {
  const h = head(k);
  pop('ripple', '', h, 1200, h.h);
  pop('emoji-rise', '📣', h, 1200, h.h);
  pop('emoji-rise late', '📈', { x: h.x + h.h * 0.25, y: h.y }, 1400, h.h);
}
function cardsToHand(k, n) {
  const from = body(k), hand = rectOf('#hand');
  for (let i = 0; i < n; i++) fly('<i class="mini-card"></i>', { x: battle.clientWidth / 2, y: battle.clientHeight * 0.35 }, { x: hand.cx + (i - 0.5) * 60, y: hand.cy }, { dur: 800, delay: i * 180, arc: -80 });
  pop('emoji-rise', '🍱', head(k), 1200, from.h);
}
function sunrise(k) {
  const h = head(k);
  pop('sun', '<i></i>☀️', h, 1600, h.h);
  const ap = rectOf('#ap');
  for (let i = 0; i < 2; i++) fly('<i class="ap-dot"></i>', h, { x: ap.x + 60 + i * 16, y: ap.cy }, { dur: 800, delay: 200 + i * 150 });
}
function impact(k, id) {
  const icon = { encircle: '🌀', question: '❓', deflect: '💫', gaffe: '🤐', exposed: '🔍', sympathy: '🥺', burst: '🔥', ultBoost: '🛡️', reflect: '🪞' }[id];
  if (!icon) return;
  const h = body(k);
  pop('impact', `<i></i><span>${icon}</span>`, h, 1100, h.h);
}
function trapDrop(k, side) {
  const m = mascotOf(k), plat = rectOf(k === 'me' ? '#me-plat' : '#opp-plat');
  fly(`<i class="mini-card ${side}"></i>`, { x: battle.clientWidth / 2, y: battle.clientHeight * 0.4 }, { x: k === 'me' ? m.x + m.w * 0.2 : m.x + m.w * 0.6, y: plat.cy }, { dur: 650, arc: -50, scale: 1.3 });
}
function trapFlip(k, side, kind) {
  const m = mascotOf(k), plat = rectOf(k === 'me' ? '#me-plat' : '#opp-plat');
  const art = kind === 'rain' ? 's_rain' : 's_flip';
  pop(`trap-flip ${side}`, `<img src="assets/cards/${art}.webp" alt="">`, { x: k === 'me' ? m.x + m.w * 0.3 : m.x + m.w * 0.6, y: plat.cy - m.h * 0.25 }, 1500, m.h);
}
function rainFor(ms) {
  rain.classList.remove('hidden');
  rain.classList.add('on');
  clearTimeout(rain._t);
  rain._t = setTimeout(() => { rain.classList.remove('on'); setTimeout(() => rain.classList.add('hidden'), 500); }, ms);
}
function ballots(fromKey) {
  for (let i = 0; i < 8; i++) fly('🗳️', body(fromKey), crowdPoint(), { dur: 900, delay: i * 70, arc: -90 });
}
function flock(k, icon, n) {
  const to = body(k);
  const startX = k === 'me' ? -40 : battle.clientWidth + 40;
  for (let i = 0; i < n; i++) fly(icon, { x: startX, y: to.y - to.h * (0.2 + Math.random() * 0.4) }, { x: to.x + (k === 'me' ? 1 : -1) * to.h * 0.4, y: to.y }, { dur: 900, delay: i * 90, arc: -40, cls: 'big' });
}
function spotlights() {
  stage.classList.remove('flash'); void stage.offsetWidth; stage.classList.add('flash');
}
function mirrorFlash(k) { const h = body(k); pop('mirror-flash', '<i></i><span>🪞</span>', h, 1200, h.h); }
function whoosh(k) { const h = body(k); pop('whoosh', '💨', h, 1000, h.h); pop('emoji-rise', '💫', head(k), 1100, h.h); }
function magnify(k) { const h = body(k); pop('magnify', '🔍', h, 1600, h.h); }
function hearts(k) { const h = head(k); for (let i = 0; i < 5; i++) fly('💗', { x: h.x + (i - 2) * 14, y: h.y + h.h * 0.3 }, { x: h.x + (i - 2) * 30, y: h.y - h.h * 0.4 }, { dur: 1100, delay: i * 90, arc: -10 }); }
function flameRing(k) { const h = body(k); pop('flame-ring', '<i></i>', h, 1300, h.h); }
function stamp(k, icon) { const h = body(k); pop('stamp', icon, h, 1200, h.h); }
function rays(k, side) { const h = body(k); pop(`rays ${side}`, '<i></i>', h, 1800, h.h); }

function ultFx(id, k, ok, side) {
  rays(k, side);
  const W = battle.clientWidth;
  switch (id) {
    case 'u_birds':
      for (let i = 0; i < 12; i++) fly('🐦', { x: -40, y: battle.clientHeight * (0.2 + Math.random() * 0.4) }, { x: W + 40, y: battle.clientHeight * (0.15 + Math.random() * 0.4) }, { dur: 1600, delay: i * 80, arc: -50, cls: 'big' });
      break;
    case 'u_team':
      for (let i = 0; i < 10; i++) fly('👷', { x: W + 40, y: body(k).y + (i % 3) * 18 }, { x: -40, y: body(k).y + (i % 3) * 18 }, { dur: 1800, delay: i * 90, arc: -8, cls: 'big' });
      break;
    case 'u_shield': { const h = body(k); pop('shield-dome', '<i></i>', h, 1800, h.h); break; }
    case 'u_reflect': mirrorFlash(k); break;
    case 'u_swap': {
      const a = body(k), b = body(ok);
      for (let i = 0; i < 6; i++) { fly('🔄', a, b, { dur: 1000, delay: i * 80, arc: -120 }); fly('🔄', b, a, { dur: 1000, delay: i * 80, arc: 120 }); }
      break;
    }
    case 'u_report': {
      const h = head(ok);
      fly('📋', { x: W / 2, y: -40 }, h, { dur: 800, arc: 0, cls: 'big', scale: 1.4 });
      setTimeout(() => stamp(ok, '✅'), 700);
      break;
    }
    default: break;
  }
}

// 抽牌：我方從牌庫飛進手牌，對手的牌飛向對手人偶
let drawQueue = 0;
function drawCard(k, side) {
  const deck = $('#deck');
  if (!deck) return;
  const d = rectOf('#deck');
  const to = k === 'me' ? { x: rectOf('#hand').x + rectOf('#hand').w * (0.5 + 0.1 * (drawQueue % 3)), y: rectOf('#hand').cy } : body('opp');
  const delay = (drawQueue++ % 4) * 120;
  setTimeout(() => { drawQueue = Math.max(0, drawQueue - 1); }, 600);
  deck.classList.remove('pulse'); void deck.offsetWidth; deck.classList.add('pulse');
  fly(`<i class="mini-card ${side}"></i>`, { x: d.cx, y: d.cy }, to, { dur: 600, delay, arc: k === 'me' ? -40 : -80, scale: 1.4 });
}

// 勝負演出：勝方滿場彩帶、人偶跳起來；敗方人偶變灰下沉
export function victory(winKey, side) {
  if (!layer) return;
  const win = winKey === 'me' ? '#me-mascot' : '#opp-mascot', lose = winKey === 'me' ? '#opp-mascot' : '#me-mascot';
  $(win).classList.add('champion');
  $(lose).classList.add('defeated');
  if (reduced()) return;
  const W = battle.clientWidth, H = battle.clientHeight;
  const colors = side === 'blue' ? ['#2f6fd6', '#8db6ff', '#ffcf3d', '#fff'] : ['#1f9a55', '#8fe3b3', '#ffcf3d', '#fff'];
  for (let i = 0; i < 60; i++) {
    const c = el('fx-confetti');
    c.style.background = colors[i % colors.length];
    c.style.left = `${Math.random() * W}px`;
    c.style.top = '-20px';
    layer.appendChild(c);
    const drift = (Math.random() - 0.5) * 160;
    const a = c.animate([
      { transform: 'translate(0,0) rotate(0)', opacity: 1 },
      { transform: `translate(${drift}px, ${H + 40}px) rotate(${720 * (Math.random() > 0.5 ? 1 : -1)}deg)`, opacity: 0.9 },
    ], { duration: 1800 + Math.random() * 1200, delay: Math.random() * 600, easing: 'cubic-bezier(.3,.5,.6,1)', fill: 'both' });
    a.onfinish = () => c.remove();
  }
  rays(winKey, side);
}
export function clearVictory() {
  for (const sel of ['#me-mascot', '#opp-mascot']) { const m = $(sel); if (m) m.classList.remove('champion', 'defeated'); }
}
