import { CONFIG } from './config.js';
import { ULTS, STATUS_INFO, SIDE_NAME, SIDE_FULL } from './cards.js';
import {
  RULES, createGame, playCard, canPlay, cardCost, endTurn, takeEvents, availableUlts,
  canBurst, enterBurst, useUlt, neutral, hasStatus,
  CARD_BY_ID, canDeclareAny, canDeclare, declareCard, declarableCards, respond,
} from './engine.js';
import { aiStep, aiRespond } from './ai.js';
import { createCrowd } from './crowd.js';
import { unlock, sfx, isMuted, setMuted } from './sound.js';
import { fetchStatus, getPid, wsUrl, getTurnstileToken } from './online.js';
import { checkName, cleanName, NAME_MAX } from './names.js';

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const other = (side) => (side === 'blue' ? 'green' : 'blue');
const TYPE = {
  attack: ['📣', '攻擊'], summon: ['👥', '召喚'], magic: ['✨', '魔法'],
  trap: ['🪤', '陷阱'], status: ['🌀', '狀態'], field: ['🎪', '場地'],
};
const RAR = { common: '', rare: '★', epic: '★★' };
const RAR_NAME = { common: '普通', rare: '稀有', epic: '史詩' };

let game = null, me = 'blue', opp = 'green', busy = false, timerId = null, timeLeft = 0, gen = 0;
// 連線模式狀態
let mode = 'local';          // 'local' 對戰電腦｜'online' 連線
let server = { online: false };
let sock = null, roomCode = null, deadline = 0, clockOffset = 0, leaving = false, resultShown = false;
let names = { blue: null, green: null }, reconnectUntil = 0, lobbySock = null;
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const crowd = createCrowd($('#crowd'));

// ── 啟動與關站判斷 ───────────────────────
function taipeiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}
function closedReason() {
  if (CONFIG.MAINTENANCE) return CONFIG.MAINTENANCE_MSG;
  if (CONFIG.CLOSED_DATES.includes(taipeiToday())) return CONFIG.CLOSED_MSG;
  return null;
}
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  document.body.classList.toggle('in-battle', id === 'battle');
}

async function init() {
  for (const a of document.querySelectorAll('.contact-link')) {
    a.href = `mailto:${CONFIG.CONTACT_EMAIL}`;
    a.textContent = CONFIG.CONTACT_EMAIL;
  }
  if (CONFIG.SPONSOR_URL) {
    const s = $('.sponsor-link');
    s.href = CONFIG.SPONSOR_URL;
    s.classList.remove('hidden');
  }
  server = await fetchStatus();
  const reason = server.maintenance ? server.msg : closedReason();
  if (reason) { $('#closed-msg').textContent = reason; show('closed'); return; }
  show('title');
  for (const b of document.querySelectorAll('.pick-btn')) b.addEventListener('click', () => openModeMenu(b.dataset.side));
  // 重新整理頁面時，若這個分頁還有進行中的連線對局就接回去
  try {
    const saved = JSON.parse(sessionStorage.getItem('bg_room') || 'null');
    if (saved && server.online && Date.now() - saved.at < 25 * 60_000) connectRoom(saved.code, saved.name);
  } catch { /* 忽略 */ }
  for (const b of document.querySelectorAll('[data-open]')) b.addEventListener('click', () => (b.dataset.open === 'rules' ? openRules() : openPrivacy()));
  $('#mute').addEventListener('click', toggleMute);
  $('#menu').addEventListener('click', openMenu);
  $('#end-btn').addEventListener('click', () => { if (isMyTurn()) endMyTurn(); });
  $('#ult-btn').addEventListener('click', openUlt);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !$('#modal').dataset.locked) closeModal(); });
  updateMuteIcon();
}

// ── 開局 ─────────────────────────────────
function setupBattle(side) {
  me = side; opp = other(side);
  busy = false;
  resultShown = false;
  closeModal();
  show('battle');
  $('#me-mascot').src = `assets/${me}_back.webp`;
  $('#me-mascot').alt = `${SIDE_NAME[me]}（我方）`;
  setOppFace('idle');
  $('#opp-plat').className = `platform opp-plat ${opp}`;
  $('#me-plat').className = `platform me-plat ${me}`;
  crowd.reset({ me, opp });
  crowd.start();
}

function maybeShowHelp() {
  let seen = false;
  try { seen = localStorage.getItem('bg_seen_help') === '1'; } catch { /* 忽略 */ }
  if (!seen) {
    openRules(true);
    try { localStorage.setItem('bg_seen_help', '1'); } catch { /* 忽略 */ }
  }
}

function startGame(side) {
  const reason = closedReason();
  if (reason) { $('#closed-msg').textContent = reason; show('closed'); return; }
  unlock();
  gen += 1; // 讓上一局還在跑的電腦回合自動中止
  mode = 'local';
  names = { blue: null, green: null };
  const disabled = [...CONFIG.disabledCards, ...(server.disabledCards || [])];
  game = createGame({ seed: Math.floor(Math.random() * 2 ** 31), disabledCards: disabled });
  setupBattle(side);
  takeEvents(game); // 開局抽牌的事件不用播
  render();
  toast(game.first === me ? '你是先手！' : '對手先手，你多拿 1 張牌和 30 聲量', me, true);
  maybeShowHelp();
  nextPhase();
}

function nextPhase() {
  if (game.over) { playEvents(); render(); return; }
  if (game.current === me) startMyTurn();
  else runAI();
}

const isMyTurn = () => game && !game.over && !busy && !game.pending && game.current === me
  && (mode === 'local' || (sock && sock.readyState === 1));

// ── 畫面 ─────────────────────────────────
function infoHTML(side, mine) {
  const p = game.players[side];
  const pct = Math.min(100, (p.supporters / RULES.winAt) * 100);
  const chips = p.statuses.map((st) => {
    const info = STATUS_INFO[st.id];
    return `<span class="chip ${info.bad ? 'bad' : 'good'}">${info.icon}${info.name}</span>`;
  });
  for (const sm of p.summons) chips.push(`<span class="chip good">👥${sm.name}×${sm.turns}</span>`);
  if (p.traps.length) {
    const shown = p.traps.filter((t) => t && t.name).map((t) => t.name);
    chips.push(mine || !shown.length
      ? `<span class="chip">🪤蓋牌×${p.traps.length}</span>`
      : `<span class="chip bad">🔍${shown.map(esc).join('、')}</span>`);
  }
  if (!mine) chips.push(`<span class="chip">🂠手牌×${p.hand.length}</span>`);
  return `
    ${names[side] ? `<div class="small nick">👤 ${esc(names[side])}${mine ? '（你）' : ''}</div>` : ''}
    <div class="row"><span class="who">${SIDE_NAME[side]}<span class="small">（${SIDE_FULL[side]}）</span></span>
      <span class="count" style="color:var(--${side})">${p.supporters}</span></div>
    <div class="bar sup" style="color:var(--${side})"><i style="width:${pct}%"></i></div>
    <div class="row small"><span>支持者（${RULES.winAt} 過半）</span><span>聲量 ${p.voice}</span></div>
    <div class="bar voice ${p.voice >= 100 ? 'full' : ''}"><i style="width:${p.voice}%"></i></div>
    <div class="statuses">${chips.join('')}</div>`;
}

function render() {
  if (!game) return;
  const mp = game.players[me];
  $('#round').textContent = `第 ${Math.min(game.round, RULES.maxRounds)} / ${RULES.maxRounds} 回合`;
  $('#neutral').textContent = `中間選民 ${neutral(game)}`;
  const oi = $('#opp-info'); oi.className = `info opp ${opp}`; oi.innerHTML = infoHTML(opp, false);
  const mi = $('#me-info'); mi.className = `info me ${me}`; mi.innerHTML = infoHTML(me, true);

  const night = !!(game.field);
  $('#battle').classList.toggle('night', night);
  const fb = $('#field-banner');
  fb.classList.toggle('hidden', !night);
  if (night) fb.textContent = `🎪 ${game.field.owner === me ? '我方' : '對手'}造勢晚會・剩 ${game.field.turns} 回合`;

  // 行程點
  const myTurn = game.current === me && !game.over;
  const apMax = Math.max(mp.ap, 0);
  $('#ap').innerHTML = myTurn
    ? `行程點 ${'<i></i>'.repeat(Math.min(apMax, 12))} ${mp.ap}`
    : `<span class="small">${game.over ? '' : mode === 'online' ? '對手思考中…' : busy ? '對手行動中…' : ''}</span>`;

  // 手牌
  const hand = $('#hand');
  hand.innerHTML = '';
  for (const c of mp.hand) {
    const el = document.createElement('button');
    const ok = myTurn && !busy && canPlay(game, me, c.uid);
    const cost = cardCost(game, me, c);
    el.className = `card ${c.side === 'shared' ? '' : c.side} ${c.rarity === 'epic' ? 'epic' : ''} ${ok ? '' : 'cant'}`;
    el.innerHTML = `<span class="cost ${cost > c.cost ? 'up' : ''}">${cost}</span><span class="rar">${RAR[c.rarity]}</span>
      <span class="ico">${TYPE[c.type][0]}</span><span class="nm">${c.name}</span><span class="tx">${c.short || c.text}</span>`;
    el.addEventListener('click', () => openCard(c.uid));
    hand.appendChild(el);
  }
  for (let i = mp.hand.length; i < RULES.handMax; i++) hand.insertAdjacentHTML('beforeend', '<div></div>');

  $('#end-btn').disabled = !isMyTurn();
  $('#ult-btn').classList.toggle('hidden', !(isMyTurn() && canBurst(game, me)));
  crowd.setCounts(mp.supporters, game.players[opp].supporters);
}

function setOppFace(expr) {
  $('#opp-mascot').src = `assets/${opp}_${expr}.webp`;
  $('#opp-mascot').alt = `${SIDE_NAME[opp]}（對手）`;
}
let faceTimer = null;
function oppReact(expr, ms = 1300) {
  setOppFace(expr);
  clearTimeout(faceTimer);
  faceTimer = setTimeout(() => setOppFace(baseFace()), ms);
}
function baseFace() {
  if (!game) return 'idle';
  const o = game.players[opp], m = game.players[me];
  if (o.statuses.some((st) => ['deflect', 'question'].includes(st.id))) return 'special';
  if (m.supporters - o.supporters >= 12) return 'panic';
  if (o.supporters - m.supporters >= 12) return 'smug';
  return 'idle';
}
function meReact(cls) {
  const el = $('#me-mascot');
  el.classList.remove('hit', 'joy', 'big');
  void el.offsetWidth; // 重新觸發動畫
  el.classList.add(cls);
}
function pulse(side, cls) {
  if (side === me) meReact(cls);
  else oppReact(cls === 'hit' ? 'hurt' : cls === 'joy' ? 'happy' : 'happy');
}

function toast(msg, side, big = false) {
  const t = document.createElement('div');
  t.className = `toast ${side || ''} ${big ? 'big' : ''}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 1900);
  const all = $('#toasts').children;
  while (all.length > 3) all[0].remove();
}

// 把引擎事件轉成提示、音效、表情
function playEvents() {
  for (const ev of takeEvents(game)) {
    const who = ev.side === me ? '我方' : '對手';
    switch (ev.type) {
      case 'play':
        sfx.card();
        if (ev.side === opp && !ev.hidden) toast(`對手打出「${ev.name}」`, opp);
        break;
      case 'pull':
        if (ev.n > 0) { sfx.pull(); toast(`${who} +${ev.n} 人`, ev.side); pulse(ev.side, 'joy'); }
        break;
      case 'poach':
        if (ev.n > 0) { sfx.hit(); toast(`${who}挖走 ${ev.n} 人`, ev.side); pulse(other(ev.side), 'hit'); }
        break;
      case 'encircle':
        if (ev.n > 0) { sfx.hit(); toast(`${ev.side === me ? '我方' : '對手'}${ev.msg}`, other(ev.side)); pulse(ev.side, 'hit'); }
        break;
      case 'status':
        sfx.status();
        toast(`${ev.side === me ? '我方' : '對手'}：${STATUS_INFO[ev.status].icon}${STATUS_INFO[ev.status].name}`, ev.side);
        if (STATUS_INFO[ev.status].bad) { pulse(ev.side, 'hit'); if (ev.side === me) oppReact('smug'); }
        break;
      case 'ult':
        sfx.ult(); toast(`${who}大絕招「${ev.name}」！`, ev.side, true);
        if (ev.side === me) meReact('big'); else oppReact('win', 1800);
        break;
      case 'burst':
        sfx.ult(); toast(`${who}聲量爆表！2 回合拉票 +50%`, ev.side, true);
        if (ev.side === me) meReact('big'); else oppReact('happy');
        break;
      case 'trap': sfx.trap(); toast(ev.msg, ev.side, true); break;
      case 'reflect': sfx.trap(); toast(ev.msg, ev.side, true); break;
      case 'miss': toast(`${who}${ev.msg}`, ev.side); pulse(ev.side, 'hit'); break;
      case 'sympathy': toast(`${who}${ev.msg}`, ev.side); break;
      case 'field': toast(`${who}${ev.msg}`, ev.side, true); break;
      case 'summon': toast(`${who}召喚「${ev.name}」`, ev.side); break;
      case 'setTrap': if (ev.side === opp) toast('對手蓋了一張牌…', opp); break;
      case 'discard': if (ev.side === me) toast(ev.msg); break;
      case 'timeout': toast(`${who}${ev.msg}`, ev.side); break;
      case 'declare':
        sfx.card();
        if (ev.side === me) toast(`你蓋牌宣告「${ev.name}」`, me);
        break;
      case 'pass':
        toast(ev.side === me ? `你放行了，「${ev.name}」生效` : `對手放行，「${ev.name}」生效`, other(ev.side));
        break;
      case 'challenge': {
        sfx.trap();
        const iChallenged = ev.side === me;
        const lost = (n) => (n > 0 ? `-${n} 人、` : '');
        if (ev.caught) {
          toast(iChallenged ? `抓到吹牛！其實是「${ev.actual}」，對手${lost(ev.n)}聲量 -${RULES.caughtVoice}` : `被抓包！你宣告的其實是「${ev.actual}」，${lost(ev.n)}聲量 -${RULES.caughtVoice}`, ev.side, true);
          pulse(other(ev.side), 'hit');
          if (iChallenged) meReact('big');
        } else {
          const tail = ev.n > 0 ? `，${iChallenged ? '你' : '對手'} -${ev.n} 人` : '';
          toast(iChallenged ? `質疑失敗！「${ev.name}」是真的${tail}` : `對手質疑失敗！「${ev.name}」是真的${tail}`, other(ev.side), true);
          pulse(ev.side, 'hit');
          if (!iChallenged) meReact('joy'); else oppReact('smug', 1600);
        }
        break;
      }
      case 'expose':
        toast(ev.side === me ? `你的陷阱被翻開了：${ev.traps.join('、')}` : `對手的陷阱翻開了：${ev.traps.join('、')}`, other(ev.side), true);
        break;
      case 'gameOver': setTimeout(showResult, 900); break;
      default: break;
    }
  }
}

// ── 我方回合 ─────────────────────────────
function startMyTurn() {
  playEvents();
  render();
  if (game.over) return;
  toast(`你的回合（第 ${game.round} 回合）`, me);
  timeLeft = CONFIG.TURN_SECONDS;
  updateTimer();
  clearInterval(timerId);
  timerId = setInterval(() => {
    if (!$('#modal').classList.contains('hidden') && $('#modal').dataset.pause) return; // 看規則時暫停
    timeLeft -= 1;
    if (timeLeft <= 10 && timeLeft > 0) sfx.tick();
    updateTimer();
    if (timeLeft <= 0) { closeModal(); endMyTurn(); }
  }, 1000);
}
function updateTimer() {
  const t = $('#timer');
  t.textContent = String(Math.max(0, timeLeft));
  t.classList.toggle('low', timeLeft <= 10);
}

function doPlay(uid) {
  if (!isMyTurn()) return;
  if (mode === 'online') { send({ t: 'play', uid }); closeModal(); return; }
  if (!playCard(game, me, uid)) return;
  closeModal();
  playEvents();
  render();
}

function endMyTurn() {
  if (!game || game.over || game.current !== me) return;
  if (mode === 'online') { send({ t: 'end' }); return; }
  clearInterval(timerId);
  endTurn(game);
  playEvents();
  render();
  nextPhase();
}

// ── 電腦回合：一步一步播放 ───────────────
async function runAI() {
  const myGen = gen;
  busy = true;
  clearInterval(timerId);
  $('#timer').textContent = '…';
  playEvents();
  render();
  await sleep(900);
  for (let i = 0; i < 14; i++) {
    if (myGen !== gen || game.over) return;
    const a = aiStep(game, opp);
    if (!a) break;
    playEvents();
    render();
    if (game.pending) {
      const challenge = await askChallenge(Date.now() + RULES.respondSeconds * 1000);
      if (myGen !== gen || game.over) return;
      respond(game, me, challenge);
      playEvents();
      render();
    }
    await sleep(1000);
  }
  if (myGen !== gen || game.over) { busy = false; return; }
  endTurn(game);
  busy = false;
  nextPhase();
}

// ── 彈窗 ─────────────────────────────────
function openModal(html, { locked = false, pause = false } = {}) {
  const m = $('#modal');
  $('#modal-box').innerHTML = html;
  m.dataset.locked = locked ? '1' : '';
  m.dataset.pause = pause ? '1' : '';
  m.classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

function openCard(uid) {
  const c = game.players[me].hand.find((x) => x.uid === uid);
  if (!c) return;
  const ok = isMyTurn() && canPlay(game, me, uid);
  const cost = cardCost(game, me, c);
  let why = '';
  if (!isMyTurn()) why = '現在不是你的回合';
  else if (c.type === 'trap' && game.players[me].traps.length >= 2) why = '最多同時蓋 2 張陷阱';
  else if (!ok) why = `行程點不足（需要 ${cost}）`;
  openModal(`
    <div class="big-card ${c.side === 'shared' ? '' : c.side}">
      <div class="ico">${TYPE[c.type][0]}</div>
      <div class="nm">${c.name}</div>
      <div class="meta">${TYPE[c.type][1]}卡・${RAR_NAME[c.rarity]}・行程點 ${cost}${cost > c.cost ? '（被追問 +1）' : ''}</div>
      <div class="tx">${c.text}</div>
      <div class="fl">${c.flavor}</div>
    </div>
    ${why ? `<p class="small center">${why}</p>` : ''}
    <div class="btns">
      <button class="btn" id="m-cancel">取消</button>
      <button class="btn ${me}" id="m-play" ${ok ? '' : 'disabled'}>打出</button>
    </div>
    ${c.type !== 'trap' && isMyTurn() ? `<div class="btns"><button class="btn bluff" id="m-declare" ${canDeclareAny(game, me) ? '' : 'disabled'}>🂠 蓋牌宣告…</button></div>
      <p class="small center">${declareHint()}</p>` : ''}`);
  $('#m-cancel').onclick = closeModal;
  $('#m-play').onclick = () => doPlay(uid);
  if ($('#m-declare')) $('#m-declare').onclick = () => openDeclare(uid);
}

function declareHint() {
  const p = game.players[me];
  if (hasStatus(p, 'exposed')) return '被起底中，這回合不能蓋牌宣告';
  if (game.declaredThisTurn) return '每回合只能蓋牌宣告 1 次';
  return '把這張蓋著打出，宣告成任何一張牌。對手可以質疑。';
}

// 選要宣告成哪一張
function openDeclare(uid) {
  const real = game.players[me].hand.find((x) => x.uid === uid);
  if (!real) return;
  const ap = game.players[me].ap;
  const list = declarableCards(game, me)
    .sort((a, b) => (a.id === real.id ? -1 : b.id === real.id ? 1 : a.cost - b.cost));
  const items = list.map((c) => {
    const cost = cardCost(game, me, c);
    const ok = canDeclare(game, me, uid, c.id);
    return `<button class="decl-item ${c.side === 'shared' ? '' : c.side}" data-as="${c.id}" ${ok ? '' : 'disabled'}>
      <span class="cost">${cost}</span><b>${c.name}${c.id === real.id ? '<em>（說實話）</em>' : ''}</b><span>${c.short || c.text}</span></button>`;
  }).join('');
  openModal(`<h2>蓋牌宣告</h2>
    <p class="small">手上這張是「${real.name}」。要宣告成哪一張？行程點照宣告的那張付（你有 ${ap} 點）。</p>
    <div class="decl-list">${items}</div>
    <p class="small">吹牛被抓：你 -${RULES.bluffPenalty} 人（聲量爆表時加倍）、聲量 -${RULES.caughtVoice}，效果作廢。對手冤枉你：對手 -${RULES.wrongChallenge} 人，效果照常。</p>
    <div class="btns"><button class="btn" id="m-back">返回</button></div>`, { pause: true });
  $('#m-back').onclick = () => openCard(uid);
  for (const b of document.querySelectorAll('[data-as]')) b.onclick = () => doDeclare(uid, b.dataset.as);
}

async function doDeclare(uid, asId) {
  if (!isMyTurn()) return;
  if (mode === 'online') { send({ t: 'declare', uid, as: asId }); closeModal(); return; }
  if (!declareCard(game, me, uid, asId)) return;
  closeModal();
  playEvents();
  render();
  const myGen = gen;
  showWaitingRespond(Date.now() + 1500);
  await sleep(1200 + Math.random() * 900); // 電腦想一下
  if (myGen !== gen || !game || !game.pending) return;
  respond(game, opp, aiRespond(game, opp));
  closeModal();
  playEvents();
  render();
}

// 對手蓋牌宣告：跳出質疑／放行，限時 8 秒，時間到視同放行
let respondTimer = null;
function askChallenge(deadlineAt) {
  return new Promise((resolve) => {
    const pd = game.pending;
    const as = CARD_BY_ID[pd.asId];
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearInterval(respondTimer);
      closeModal();
      resolve(v);
    };
    openModal(`<h2>對手蓋牌宣告</h2>
      <div class="big-card ${as.side === 'shared' ? '' : as.side} facedown">
        <div class="ico">🂠</div><div class="nm">宣告：${as.name}</div>
        <div class="meta">${TYPE[as.type][1]}卡・行程點 ${as.cost}</div><div class="tx">${as.text}</div>
      </div>
      <div class="count-ring small-ring" id="m-rcount">${RULES.respondSeconds}</div>
      <p class="small center">質疑要付出：你下回合行程點 -1。<br>抓到吹牛 → 對手 -${RULES.bluffPenalty} 人、聲量 -${RULES.caughtVoice}、效果作廢；猜錯 → 你 -${RULES.wrongChallenge} 人。</p>
      <div class="btns">
        <button class="btn" id="m-pass">放行</button>
        <button class="btn danger" id="m-challenge">🔍 質疑！</button>
      </div>`, { locked: true });
    $('#m-pass').onclick = () => finish(false);
    $('#m-challenge').onclick = () => finish(true);
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadlineAt - (Date.now() + clockOffset * (mode === 'online' ? 1 : 0))) / 1000));
      const el = $('#m-rcount');
      if (el) { el.textContent = left; el.style.setProperty('--p', `${(left / RULES.respondSeconds) * 100}%`); }
      if (left <= 0) finish(false);
    };
    clearInterval(respondTimer);
    respondTimer = setInterval(tick, 200);
    tick();
  });
}

// 自己蓋牌宣告後，等對手決定
function showWaitingRespond(deadlineAt) {
  const pd = game.pending;
  if (!pd) return;
  const as = CARD_BY_ID[pd.asId];
  openModal(`<h2>等對手決定…</h2>
    <p class="center">你蓋牌宣告了「${as.name}」</p>
    <div class="count-ring small-ring" id="m-wcount">${RULES.respondSeconds}</div>
    <p class="small center">對手正在決定要質疑還是放行</p>`, { locked: true });
  clearInterval(respondTimer);
  respondTimer = setInterval(() => {
    const el = $('#m-wcount');
    if (!el || !game || !game.pending) { clearInterval(respondTimer); return; }
    const left = Math.max(0, Math.ceil((deadlineAt - (Date.now() + (mode === 'online' ? clockOffset : 0))) / 1000));
    el.textContent = left;
    el.style.setProperty('--p', `${(left / RULES.respondSeconds) * 100}%`);
  }, 200);
}

function openUlt() {
  if (!isMyTurn() || !canBurst(game, me)) return;
  const avail = availableUlts(game, me).map((u) => u.id);
  const gaffe = hasStatus(game.players[me], 'gaffe');
  const items = ULTS[me].map((u) => {
    const used = game.players[me].usedUlts.includes(u.id);
    let note = '';
    if (used) note = '（本局已用過）';
    else if (gaffe) note = '（失言中，不能發動）';
    else if (u.minRound && game.round < u.minRound) note = `（第 ${u.minRound} 回合後）`;
    return `<button class="ult-item" data-ult="${u.id}" ${avail.includes(u.id) ? '' : 'disabled'}><b>${u.name}${note}</b><span>${u.text}</span></button>`;
  }).join('');
  openModal(`<h2>🔥 聲量爆表！擇一</h2>
    <div class="ult-list">${items}
      <button class="ult-item" data-ult="burst"><b>進入爆表狀態</b><span>2 回合內拉票 +50%</span></button>
    </div>
    <div class="btns"><button class="btn" id="m-cancel">先不要</button></div>`);
  for (const b of document.querySelectorAll('[data-ult]')) {
    b.onclick = () => {
      if (mode === 'online') {
        send(b.dataset.ult === 'burst' ? { t: 'burst' } : { t: 'ult', id: b.dataset.ult });
        closeModal();
        return;
      }
      if (b.dataset.ult === 'burst') enterBurst(game, me);
      else useUlt(game, me, b.dataset.ult);
      closeModal();
      playEvents();
      render();
    };
  }
  $('#m-cancel').onclick = closeModal;
}

function openRules(first = false) {
  openModal(`<h2>怎麼玩</h2>
    <ul>
      <li>場上有 100 位灰色<b>中間選民</b>，先拉到 <b>${RULES.winAt} 人（過半）</b>就贏；第 ${RULES.maxRounds} 回合結束時，支持者多的一方獲勝。</li>
      <li>每回合有<b>行程點</b>（金色圓點），等於回合數＋1，最多 10 點。出牌要花行程點。</li>
      <li>每回合抽 2 張牌，手牌最多 5 張。牌庫無限、完全隨機。</li>
      <li>點手牌看說明，再按「打出」。做完按「結束回合」，每回合限時 ${CONFIG.TURN_SECONDS} 秒。</li>
      <li><b>聲量條</b>集滿 100 會出現「聲量爆表」：發動大絕招（每招每局一次），或進入爆表狀態 2 回合拉票 +50%。</li>
      <li>越後期，中間選民越難拉。被攻擊 2 次會觸發<b>同情票</b>，下次拉票加倍。</li>
      <li>卡牌：📣攻擊 👥召喚 ✨魔法 🪤陷阱（蓋著等對方觸發）🌀狀態 🎪場地。</li>
      <li><b>蓋牌宣告</b>：點手牌選「蓋牌宣告」，把牌蓋著打出並宣告成任何一張牌（行程點照宣告的付），可以說實話也可以吹牛，每回合 1 次。</li>
      <li><b>質疑</b>：對手蓋牌宣告時你有 ${RULES.respondSeconds} 秒決定。質疑要付下回合行程點 -1：抓到吹牛，對手 -${RULES.bluffPenalty} 人、聲量 -${RULES.caughtVoice}，效果作廢；猜錯，你 -${RULES.wrongChallenge} 人。</li>
    </ul>
    <div class="btns"><button class="btn primary" id="m-ok">${first ? '開始！' : '知道了'}</button></div>`, { pause: true });
  $('#m-ok').onclick = closeModal;
}

function openPrivacy() {
  openModal(`<h2>隱私聲明</h2>
    <p>不需註冊，不蒐集姓名、電子郵件或其他聯絡資料。</p>
    <p><b>連線對戰</b>時，伺服器會暫存你輸入的暱稱、隨機產生的玩家識別碼與對局內容，只用來進行這一局；對局結束約 1 分鐘後刪除。暱稱會顯示給對手。</p>
    <p>你的瀏覽器會在你的裝置上記住：是否靜音、是否看過教學、上次用的暱稱，以及進行中對局的識別碼（關閉分頁即清除）。</p>
    <p>網站與連線伺服器由 Cloudflare 託管。Cloudflare 會為了安全與維運記錄連線資訊（例如 IP 位址），依其隱私權政策處理；若啟用真人驗證（Cloudflare Turnstile），也適用其隱私權政策。本站自行記錄的連線資訊保存不超過 30 天。本站沒有使用廣告或追蹤工具。</p>
    <p>問題或要求：<a href="mailto:${CONFIG.CONTACT_EMAIL}">${CONFIG.CONTACT_EMAIL}</a></p>
    <p class="small">本作為政治諷刺娛樂，非任何候選人、政黨或競選團隊製作，內容不代表當事人言行。角色為原創 Q 版人偶，美術由 AI 生成。</p>
    <div class="btns"><button class="btn primary" id="m-ok">關閉</button></div>`, { pause: true });
  $('#m-ok').onclick = closeModal;
}

function openMenu() {
  openModal(`<h2>選單</h2>
    <div class="btns" style="flex-direction:column">
      <button class="btn" id="m-rules">怎麼玩</button>
      <button class="btn" id="m-priv">隱私聲明</button>
      <button class="btn" id="m-home">${mode === 'online' && game && !game.over ? '離開（30 秒後判負）' : '回首頁（放棄這局）'}</button>
      <button class="btn primary" id="m-ok">繼續</button>
    </div>`, { pause: true });
  $('#m-rules').onclick = () => openRules();
  $('#m-priv').onclick = openPrivacy;
  $('#m-home').onclick = goHome;
  $('#m-ok').onclick = closeModal;
}

function goHome() {
  gen += 1;
  leaveOnline();
  mode = 'local';
  names = { blue: null, green: null };
  clearInterval(timerId);
  busy = false;
  game = null;
  crowd.stop();
  closeModal();
  show('title');
}

function showResult() {
  if (resultShown || !game) return;
  resultShown = true;
  clearInterval(timerId);
  try { sessionStorage.removeItem('bg_room'); } catch { /* 忽略 */ }
  const w = game.winner;
  const b = game.players.blue.supporters, g = game.players.green.supporters;
  const won = w === me;
  if (w === 'draw') sfx.lose(); else if (won) sfx.win(); else sfx.lose();
  setOppFace(w === opp ? 'win' : w === me ? 'lose' : 'idle');
  const img = w === 'draw' ? `${me}_idle` : won ? `${me}_win` : `${me}_lose`;
  const title = w === 'draw' ? '平手！' : won ? '你贏了！' : '你輸了…';
  openModal(`
    <img class="result-img" src="assets/${img}.webp" alt="">
    <h2 class="center">${title}</h2>
    <div class="score"><span class="b">藍 ${b}</span> : <span class="g">${g} 綠</span></div>
    <p class="center small">${game.reason}</p>
    <div class="btns"><button class="btn ${me}" id="m-again">再玩一次</button><button class="btn ${opp}" id="m-swap">換陣營</button></div>
    <div class="btns"><button class="btn" id="m-share">分享</button><button class="btn" id="m-home">回首頁</button></div>
    <p class="small center">遊戲結果僅供娛樂，與實際選情無關。</p>`, { locked: true });
  if (mode === 'online') {
    $('#m-again').textContent = '再配對一次';
    $('#m-swap').textContent = '對戰電腦';
    $('#m-again').onclick = () => { const s = me; leaveOnline(); randomMatch(s); };
    $('#m-swap').onclick = () => { const s = me; leaveOnline(); startGame(s); };
  } else {
    $('#m-again').onclick = () => startGame(me);
    $('#m-swap').onclick = () => startGame(opp);
  }
  $('#m-home').onclick = goHome;
  $('#m-share').onclick = async () => {
    const text = `我在《藍綠對決》用${SIDE_NAME[me]}打到 藍 ${b} : ${g} 綠，${title} 來挑戰：${location.href}`;
    try {
      if (navigator.share) await navigator.share({ title: '藍綠對決', text });
      else { await navigator.clipboard.writeText(text); toast('已複製分享文字'); }
    } catch { /* 使用者取消 */ }
  };
}

function toggleMute() { setMuted(!isMuted()); updateMuteIcon(); }
function updateMuteIcon() { $('#mute').textContent = isMuted() ? '🔇' : '🔊'; }

// ── 連線對戰 ─────────────────────────────
let pingTimer = null, battleRoom = null, lastTurnKey = '';

function notice(msg) {
  openModal(`<h2>${esc(msg)}</h2><div class="btns"><button class="btn primary" id="m-ok">知道了</button></div>`);
  $('#m-ok').onclick = closeModal;
}
function savedName() { try { return localStorage.getItem('bg_name') || ''; } catch { return ''; } }

function openModeMenu(side) {
  const online = server.online;
  openModal(`<h2>${SIDE_NAME[side]}・選擇模式</h2>
    <div class="btns"><button class="btn ${side}" id="m-ai">🤖 對戰電腦</button></div>
    ${online ? `
    <hr>
    <label class="small" for="m-name">連線暱稱（最多 ${NAME_MAX} 字，會顯示給對手）</label>
    <input id="m-name" class="input" maxlength="${NAME_MAX * 2}" value="${esc(savedName())}" placeholder="例如：路過的市民" autocomplete="nickname">
    <p class="small err" id="m-err"></p>
    <div class="btns col">
      <button class="btn primary" id="m-rand">⚡ 線上隨機配對</button>
      <button class="btn" id="m-host">🏠 開房間給朋友</button>
    </div>
    <div class="row-join">
      <input id="m-code" class="input" maxlength="5" placeholder="朋友的 5 碼房號" autocapitalize="characters" autocomplete="off">
      <button class="btn" id="m-join">加入</button>
    </div>
    <p class="small">加入朋友的房間時，你會拿到房主沒選的那一邊。</p>`
    : '<p class="small center">連線對戰暫時無法使用，先跟電腦玩吧！</p>'}
    <div class="btns"><button class="btn" id="m-cancel">返回</button></div>`);
  $('#m-ai').onclick = () => startGame(side);
  $('#m-cancel').onclick = closeModal;
  if (!online) return;
  const getName = () => {
    const n = cleanName($('#m-name').value);
    const e = checkName(n);
    if (e) { $('#m-err').textContent = e; return null; }
    try { localStorage.setItem('bg_name', n); } catch { /* 忽略 */ }
    return n;
  };
  $('#m-rand').onclick = () => { const n = getName(); if (n) randomMatch(side, n); };
  $('#m-host').onclick = () => { const n = getName(); if (n) hostRoom(side, n); };
  $('#m-join').onclick = () => {
    const n = getName();
    if (!n) return;
    const code = $('#m-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) { $('#m-err').textContent = '房號是 5 碼英文或數字'; return; }
    unlock();
    connectRoom(code, n);
  };
}

// 有設定 Turnstile 才會跳出真人驗證
async function verifyHuman() {
  if (!server.turnstileSiteKey) return null;
  openModal(`<h2>真人驗證</h2><p class="small">確認你不是機器人，通常點一下就好。</p><div id="ts-box"></div>
    <div class="btns"><button class="btn" id="m-cancel">取消</button></div>`, { locked: true });
  let cancelled = false;
  $('#m-cancel').onclick = () => { cancelled = true; closeModal(); };
  const token = await getTurnstileToken(server.turnstileSiteKey, $('#ts-box'));
  if (cancelled) throw new Error('cancelled');
  return token;
}

async function randomMatch(side, name = savedName()) {
  if (checkName(name)) { openModeMenu(side); return; }
  unlock();
  let token = null;
  try { token = await verifyHuman(); } catch { notice('真人驗證沒有完成，請再試一次'); return; }
  const total = CONFIG.MATCH_SECONDS;
  openModal(`<h2>配對中…</h2>
    <div class="count-ring" id="m-count">${total}</div>
    <p id="m-wait" class="center">正在找另一個陣營的對手…</p>
    <p class="small center">${total} 秒內沒配到，會自動改成跟電腦對戰。</p>
    <div class="btns"><button class="btn ${side}" id="m-ai">直接跟電腦玩</button><button class="btn" id="m-cancel">取消</button></div>`, { locked: true });
  const ws = new WebSocket(wsUrl('/lobby'));
  lobbySock = ws;
  const started = Date.now();
  let full = false;
  const stop = () => {
    clearInterval(countTimer);
    if (lobbySock === ws) lobbySock = null;
    try { ws.close(); } catch { /* 忽略 */ }
  };
  const toAI = (auto) => {
    stop();
    startGame(side);
    if (auto) toast('沒有配到對手，改跟電腦對戰', side, true);
  };
  const countTimer = setInterval(() => {
    if (lobbySock !== ws) { clearInterval(countTimer); return; }
    const left = Math.max(0, total - Math.floor((Date.now() - started) / 1000));
    const el = $('#m-count');
    if (el) {
      el.textContent = left;
      el.style.setProperty('--p', `${(left / total) * 100}%`);
    }
    if (!full && $('#m-wait') && Date.now() - started > 12_000) $('#m-wait').textContent = '改找任何陣營的對手…';
    if (left <= 0) toAI(true);
  }, 250);
  $('#m-ai').onclick = () => toAI(false);
  $('#m-cancel').onclick = () => { stop(); closeModal(); };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', pid: getPid(), name, side, turnstile: token }));
  ws.onmessage = (e) => {
    if (lobbySock !== ws) return; // 已改跟電腦玩或已取消，忽略晚到的配對結果
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'queue' && $('#m-wait')) { full = true; $('#m-wait').textContent = m.msg; }
    else if (m.t === 'error') { stop(); notice(m.msg); }
    else if (m.t === 'matched') { stop(); connectRoom(m.code, name); }
  };
  ws.onclose = () => { if (lobbySock === ws) { stop(); notice('配對連線中斷，請再試一次'); } };
}

async function hostRoom(side, name) {
  unlock();
  let token = null;
  try { token = await verifyHuman(); } catch { notice('真人驗證沒有完成，請再試一次'); return; }
  try {
    const r = await fetch('/api/create', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pid: getPid(), name, side, turnstile: token }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { notice(d.error || d.msg || '開房失敗，請稍後再試'); return; }
    connectRoom(d.code, name);
  } catch { notice('開房失敗，請檢查網路'); }
}

function showWaitingRoom(code) {
  if ($('#m-roomcode')) return;
  openModal(`<h2>房間開好了</h2><p class="center">把房號傳給朋友：</p>
    <div class="code" id="m-roomcode">${esc(code)}</div>
    <p class="small center">朋友在首頁點任一角色 →「加入」輸入房號。10 分鐘內沒人加入會自動關閉。</p>
    <div class="btns"><button class="btn primary" id="m-share">分享房號</button><button class="btn" id="m-cancel">取消</button></div>`, { locked: true });
  $('#m-share').onclick = async () => {
    const text = `來《藍綠對決》跟我對戰！房號 ${code}：${location.origin}`;
    try {
      if (navigator.share) await navigator.share({ title: '藍綠對決', text });
      else { await navigator.clipboard.writeText(text); $('#m-share').textContent = '已複製'; }
    } catch { /* 使用者取消 */ }
  };
  $('#m-cancel').onclick = () => { leaveOnline(); closeModal(); };
}

function send(msg) {
  if (sock && sock.readyState === 1) sock.send(JSON.stringify(msg));
  else toast('連線中，請稍候再試');
}

function connectRoom(code, name) {
  gen += 1;
  mode = 'online';
  roomCode = code;
  leaving = false;
  try { sessionStorage.setItem('bg_room', JSON.stringify({ code, name, at: Date.now() })); } catch { /* 忽略 */ }
  const ws = new WebSocket(wsUrl(`/room/${code}?pid=${encodeURIComponent(getPid())}&name=${encodeURIComponent(name || '')}`));
  sock = ws;
  ws.onmessage = (e) => { if (sock === ws) onRoomMessage(e.data); };
  ws.onopen = () => { reconnectUntil = 0; if (game) render(); };
  ws.onclose = (e) => {
    if (sock !== ws || leaving || e.code === 4003 || e.code === 4001) return;
    if (game && game.over) return;
    if (!reconnectUntil) reconnectUntil = Date.now() + 28_000;
    if (Date.now() < reconnectUntil) {
      if (game) toast('連線中斷，重新連線中…');
      setTimeout(() => { if (sock === ws && !leaving) connectRoom(code, name); }, 2000);
    } else {
      goHome();
      notice('連線中斷太久，這局已結束');
    }
  };
  clearInterval(pingTimer);
  // 伺服器會自動回 pong，不會喚醒房間，也不會產生費用
  pingTimer = setInterval(() => { if (sock && sock.readyState === 1) sock.send('ping'); }, 25_000);
}

function leaveOnline() {
  leaving = true;
  clearInterval(pingTimer);
  if (sock) { try { sock.close(1000, 'leave'); } catch { /* 忽略 */ } }
  if (lobbySock) { try { lobbySock.close(); } catch { /* 忽略 */ } }
  sock = null; lobbySock = null; roomCode = null; battleRoom = null; reconnectUntil = 0;
  pendingUI = null; clearInterval(respondTimer);
  try { sessionStorage.removeItem('bg_room'); } catch { /* 忽略 */ }
}

function onRoomMessage(data) {
  if (data === 'pong') return;
  let m; try { m = JSON.parse(data); } catch { return; }
  if (m.t === 'error') {
    if (m.fatal) { goHome(); notice(m.msg); } else if (game) toast(m.msg);
    return;
  }
  if (m.t === 'opp') {
    if (m.status === 'left') toast('對手斷線了，30 秒內沒回來你就獲勝', me, true);
    else toast('對手回來了', me);
    return;
  }
  if (m.t !== 'view') return;
  const v = m.view;
  clockOffset = v.serverNow - Date.now();
  names = v.names || names;
  if (v.status === 'waiting' || !v.state) { showWaitingRoom(v.code); return; }

  if (battleRoom !== v.code) {
    battleRoom = v.code;
    setupBattle(v.you);
    game = v.state;
    game.events = [];
    render();
    toast(game.first === me ? '你是先手！' : '對手先手，你多拿 1 張牌和 30 聲量', me, true);
    maybeShowHelp();
  }
  game = v.state;
  game.events = m.events || [];
  deadline = v.deadline;
  playEvents();
  render();
  const key = `${game.round}-${game.current}`;
  if (key !== lastTurnKey) {
    lastTurnKey = key;
    if (!game.over && game.current === me) toast(`你的回合（第 ${game.round} 回合）`, me);
  }
  startOnlineTimer();
  syncPendingUI(v.respondDeadline);
  if (game.over && !resultShown) setTimeout(showResult, 1200);
}

// 依伺服器狀態開關質疑相關的彈窗
let pendingUI = null; // 'ask' 我要決定｜'wait' 等對手｜null
function syncPendingUI(respondDeadline) {
  const pd = game && !game.over ? game.pending : null;
  const want = !pd ? null : pd.side === me ? 'wait' : 'ask';
  if (want === pendingUI) return;
  if (pendingUI) { clearInterval(respondTimer); closeModal(); }
  pendingUI = want;
  if (want === 'wait') showWaitingRespond(respondDeadline);
  if (want === 'ask') {
    askChallenge(respondDeadline).then((challenge) => {
      if (pendingUI === 'ask' && game && game.pending) send({ t: 'respond', challenge });
    });
  }
}

function startOnlineTimer() {
  clearInterval(timerId);
  const tick = () => {
    if (!game || game.over || mode !== 'online') { clearInterval(timerId); return; }
    if (game.pending) { $('#timer').textContent = '暫停'; return; }
    const prev = timeLeft;
    timeLeft = Math.max(0, Math.ceil((deadline - (Date.now() + clockOffset)) / 1000));
    if (game.current === me && timeLeft <= 10 && timeLeft > 0 && timeLeft !== prev) sfx.tick();
    updateTimer();
  };
  tick();
  timerId = setInterval(tick, 250);
}

init();
