import { CONFIG } from './config.js';
import { ULTS, STATUS_INFO, SIDE_NAME, SIDE_FULL } from './cards.js';
import {
  RULES, createGame, playCard, canPlay, cardCost, endTurn, takeEvents, availableUlts,
  canBurst, enterBurst, useUlt, neutral, hasStatus,
  CARD_BY_ID, canDeclareAny, canDeclare, declareCard, declarableCards, respond,
} from './engine.js';
import { aiStep, respondDecision, newProfile, observeEvents, EASE_NAMES, EASE_MAX } from './ai.js';
import { createCrowd } from './crowd.js';
import { unlock, sfx, isMuted, setMuted, setRemoteVolume } from './sound.js';
import { fetchStatus, getPid, wsUrl, getTurnstileToken } from './online.js';
import { checkName, cleanName, NAME_MAX } from './names.js';
import { pickChatter, TONE_TAG } from './chatter.js';
import { t, tr, EN, nameEN, setLang, applyStatic, rulesHTML_EN, privacyHTML_EN } from './i18n.js';

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
// 出牌演出：卡牌先放大展示，結束後才更新比分與群眾
let fxChain = Promise.resolve(), holdBoard = false, animating = 0, castSkip = null;
// 連線時伺服器送來的卡牌文字是中文；顯示一律以本機卡牌資料為準（英文版載入時已換成英文）
const loc = (c) => { const k = c && CARD_BY_ID[c.id]; return k ? { ...c, name: k.name, text: k.text, short: k.short, hand: k.hand, flavor: k.flavor } : c; };
const paren = (x) => (EN ? ` (${x})` : `（${x}）`);
const listJoin = (a) => a.join(EN ? ', ' : '、');
const GAME_TITLE = EN ? 'Blue–Green Showdown' : '藍綠攻防戰';
const art = (id) => `assets/cards/${CARD_BY_ID[id]?.art || id}.webp`; // 時事卡沒有專屬插圖時用通用圖
// 電腦記住「你」的習慣（被抓過幾次吹牛、多常質疑），存在這台裝置的瀏覽器，跨局累積
let profile = loadProfile();
let humanSkippedLast = false;
function loadProfile() {
  try { return { ...newProfile(), ...JSON.parse(localStorage.getItem('bg_profile') || '{}') }; } catch { return newProfile(); }
}
function saveProfile() { try { localStorage.setItem('bg_profile', JSON.stringify(profile)); } catch { /* 忽略 */ } }
// 電腦強度（0＝標準，越大越放水）與最近幾局戰績，存在這台裝置；依戰績自動調整
let ease = loadJSON('bg_ease', 0);
let mood = loadJSON('bg_mood', { recent: [], games: 0 });
let gameStats = null;   // 這一局：{ skips, timeouts, startedAt }
let easeNotice = '';    // 下一局開始時要顯示的提示
function loadJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 忽略 */ } }
if (!Number.isInteger(ease) || ease < 0 || ease > EASE_MAX) ease = 0;
if (!mood || !Array.isArray(mood.recent)) mood = { recent: [], games: 0 };
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
  applyStatic();
  const ll = $('#lang-link');
  if (ll) { ll.textContent = EN ? '中文' : 'English'; ll.addEventListener('click', () => setLang(EN ? 'zh' : 'en')); }
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
  if (reason) { $('#closed-msg').textContent = tr(reason); show('closed'); return; }
  show('title');
  for (const b of document.querySelectorAll('.pick-btn')) b.addEventListener('click', () => openModeMenu(b.dataset.side));
  // 重新整理頁面時，若這個分頁還有進行中的連線對局就接回去
  try {
    const saved = JSON.parse(sessionStorage.getItem('bg_room') || 'null');
    if (saved && server.online && Date.now() - saved.at < 25 * 60_000) connectRoom(saved.code, saved.name);
  } catch { /* 忽略 */ }
  for (const b of document.querySelectorAll('[data-open]')) {
    b.addEventListener('click', () => ({ rules: () => openRules(), privacy: openPrivacy, report: openReport }[b.dataset.open] || openPrivacy)());
  }
  $('#mute').addEventListener('click', toggleMute);
  $('#menu').addEventListener('click', openMenu);
  $('#end-btn').addEventListener('click', () => { if (isMyTurn()) endMyTurn(); });
  $('#ult-btn').addEventListener('click', openUlt);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !$('#modal').dataset.locked) closeModal(); });
  updateMuteIcon();
  setupEncoreRemote();
}

// ── 台北安可電視台（被 iframe 嵌入時）：遙控器音量、彩色鍵、← → 轉台 ────────
// 只接受「嵌入我們的那一層」送來的訊息；彩色鍵只開選單類畫面，不會替玩家出牌
function setupEncoreRemote() {
  if (window.parent === window) return;
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'encore:volume') setRemoteVolume(d.volume, d.muted);
    if (d.type === 'encore:color') {
      const inBattle = !$('#battle').classList.contains('hidden');
      if (d.color === 'red') openRules();
      if (d.color === 'green' && inBattle) openMenu();
      if (d.color === 'yellow') openReport();
      if (d.color === 'blue') { toggleMute(); toast(t(isMuted() ? '已靜音' : '已開啟音效')); }
    }
  });
  window.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return; // 打字時不轉台
    window.parent.postMessage({ type: 'encore:key', key: e.key }, '*');
  });
}

// ── 開局 ─────────────────────────────────
function setupBattle(side) {
  me = side; opp = other(side);
  busy = false;
  resultShown = false;
  closeModal();
  show('battle');
  $('#me-mascot').src = `assets/${me}_back.webp`;
  $('#me-mascot').alt = `${SIDE_NAME[me]}${t('（我方）')}`;
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
  if (reason) { $('#closed-msg').textContent = tr(reason); show('closed'); return; }
  unlock();
  gen += 1; // 讓上一局還在跑的電腦回合自動中止
  mode = 'local';
  names = { blue: null, green: null };
  const disabled = [...CONFIG.disabledCards, ...(server.disabledCards || [])];
  game = createGame({ seed: Math.floor(Math.random() * 2 ** 31), disabledCards: disabled, today: taipeiToday() });
  gameStats = { skips: 0, timeouts: 0, startedAt: Date.now() };
  setupBattle(side);
  takeEvents(game); // 開局抽牌的事件不用播
  render();
  toast(t(game.first === me ? '你是先手！' : '對手先手，你多拿 1 張牌'), me, true);
  if (easeNotice) { const n = easeNotice; easeNotice = ''; setTimeout(() => toast(n, opp, true), 1400); }
  maybeShowHelp();
  nextPhase();
}

function nextPhase() {
  if (game.over) { playEvents(); return; }
  if (game.current === me) startMyTurn();
  else runAI();
}

const isMyTurn = () => game && !game.over && !busy && !animating && !game.pending && game.current === me
  && (mode === 'local' || (sock && sock.readyState === 1));

// ── 畫面 ─────────────────────────────────
function infoHTML(side, mine) {
  const p = game.players[side];
  const pct = Math.min(100, (p.supporters / RULES.winAt) * 100);
  const chips = p.statuses.map((st) => {
    const info = STATUS_INFO[st.id];
    return `<span class="chip ${info.bad ? 'bad' : 'good'}">${info.icon}${info.name}</span>`;
  });
  for (const sm of p.summons) chips.push(`<span class="chip good">👥${esc(nameEN(sm.name))}×${sm.turns}</span>`);
  if (p.traps.length) {
    const shown = p.traps.filter((x) => x && x.name).map((x) => nameEN(x.name));
    chips.push(mine || !shown.length
      ? `<span class="chip">${t('🪤蓋牌×{n}', { n: p.traps.length })}</span>`
      : `<span class="chip bad">🔍${listJoin(shown.map(esc))}</span>`);
  }
  if (!mine) chips.push(`<span class="chip">${t('🂠手牌×{n}', { n: p.hand.length })}</span>`);
  return `
    ${names[side] ? `<div class="small nick">👤 ${esc(names[side])}${mine ? t('（你）') : ''}</div>` : ''}
    <div class="row"><span class="who">${SIDE_NAME[side]}<span class="small">${paren(SIDE_FULL[side])}</span></span>
      <span class="count" style="color:var(--${side})">${p.supporters}</span></div>
    <div class="bar sup" style="color:var(--${side})"><i style="width:${pct}%"></i></div>
    <div class="row small"><span>${t('支持者（{n} 過半）', { n: RULES.winAt })}</span><span>${t('聲量 {n}', { n: p.voice })}</span></div>
    <div class="bar voice ${p.voice >= 100 ? 'full' : ''}"><i style="width:${p.voice}%"></i></div>
    <div class="statuses">${chips.join('')}</div>`;
}

function render() {
  if (!game) return;
  const mp = game.players[me];
  if (!holdBoard) {
    $('#round').textContent = t('第 {r} / {m} 回合', { r: Math.min(game.round, RULES.maxRounds), m: RULES.maxRounds });
    $('#neutral').textContent = t('中間選民 {n}', { n: neutral(game) });
    const oi = $('#opp-info'); oi.className = `info opp ${opp}`; oi.innerHTML = infoHTML(opp, false);
    const mi = $('#me-info'); mi.className = `info me ${me}`; mi.innerHTML = infoHTML(me, true);
    crowd.setCounts(mp.supporters, game.players[opp].supporters);
  }

  const night = !!(game.field);
  $('#battle').classList.toggle('night', night);
  const fb = $('#field-banner');
  fb.classList.toggle('hidden', !night);
  if (night) fb.textContent = t('🎪 {who}造勢晚會・剩 {n} 回合', { who: t(game.field.owner === me ? '我方' : '對手'), n: game.field.turns });

  // 行程點
  const myTurn = game.current === me && !game.over;
  const apNow = Math.max(mp.ap, 0);
  const dots = Array.from({ length: RULES.apCap }, (_, i) => `<i class="${i < apNow ? '' : 'used'}"></i>`).join('');
  $('#ap').innerHTML = `<span class="ap-label">${t('行程點 {a}/{c}', { a: apNow, c: RULES.apCap })}</span><span class="ap-dots">${dots}</span>`
    + `<span class="small ap-hint">${game.over ? '' : myTurn
      ? (game.magicThisTurn ? t('魔法卡用過了，還可以出 1 張牌') : t('每回合 +{n}，沒用完會存著', { n: RULES.apPerTurn }))
      : t(mode === 'online' ? '對手思考中…' : '對手行動中…')}</span>`;

  // 手牌
  const hand = $('#hand');
  hand.innerHTML = '';
  for (const raw of mp.hand) {
    const c = loc(raw);
    const el = document.createElement('button');
    const ok = myTurn && !busy && canPlay(game, me, c.uid);
    const cost = cardCost(game, me, c);
    el.className = `card ${c.side === 'shared' ? '' : c.side} ${c.rarity === 'epic' ? 'epic' : ''} ${ok ? '' : 'cant'}`;
    el.innerHTML = `<span class="art-wrap"><img class="art" src="${art(c.id)}" alt="" loading="lazy" draggable="false">
        <span class="cost ${cost > c.cost ? 'up' : ''}">${cost}</span><span class="type">${TYPE[c.type][0]}</span></span>
      <span class="nm">${c.name}${RAR[c.rarity] ? `<span class="rar">${RAR[c.rarity]}</span>` : ''}</span><span class="tx">${c.hand || c.short || c.text}</span>`;
    el.addEventListener('click', () => openCard(c.uid));
    hand.appendChild(el);
  }
  for (let i = mp.hand.length; i < RULES.handMax; i++) hand.insertAdjacentHTML('beforeend', '<div></div>');

  $('#end-btn').disabled = !isMyTurn();
  $('#ult-btn').classList.toggle('hidden', !(isMyTurn() && canBurst(game, me)));
}

function setOppFace(expr) {
  $('#opp-mascot').src = `assets/${opp}_${expr}.webp`;
  $('#opp-mascot').alt = `${SIDE_NAME[opp]}${t('（對手）')}`;
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
  const el = document.createElement('div');
  el.className = `toast ${side || ''} ${big ? 'big' : ''}`;
  el.textContent = tr(msg);
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 2600);
  const all = $('#toasts').children;
  while (all.length > 3) all[0].remove();
}

// 把引擎事件排進演出佇列：卡牌先放大展示，再播效果、更新比分。回傳演出結束的 Promise。
function playEvents() {
  const events = takeEvents(game);
  if (mode === 'local' && events.length) { observeEvents(profile, events, me); saveProfile(); }
  const myGen = gen;
  animating += 1;
  fxChain = fxChain.then(() => (myGen === gen ? animateEvents(events) : null)).catch(() => {}).then(() => {
    animating = Math.max(0, animating - 1);
    holdBoard = false;
    if (myGen === gen && game) render();
  });
  return fxChain;
}

// 哪些事件要先放大展示卡牌
function castFor(ev) {
  const C = CARD_BY_ID;
  if (ev.type === 'play') {
    if (ev.hidden) return { side: ev.side, facedown: true, label: t(ev.side === me ? '你蓋了一張陷阱' : '對手蓋了一張陷阱') };
    return { side: ev.side, card: C[ev.card], label: t(ev.side === me ? '你打出' : '對手打出') };
  }
  if (ev.type === 'pass') return { side: other(ev.side), card: C[ev.asId], label: t('放行，宣告生效') };
  if (ev.type === 'challenge') {
    return ev.caught
      ? { side: other(ev.side), card: C[ev.actualId], label: t('抓到吹牛！宣告「{name}」其實是', { name: nameEN(ev.name) }), bad: true }
      : { side: other(ev.side), card: C[ev.asId], label: t('質疑失敗！是真的') };
  }
  if (ev.type === 'ult') return { side: ev.side, ult: nameEN(ev.name), label: t(ev.side === me ? '你的大絕招' : '對手的大絕招') };
  return null;
}

async function animateEvents(events) {
  let casted = false;
  for (const ev of events) {
    const c = castFor(ev);
    if (c) {
      if (casted) await sleep(900); // 上一張的效果看得到，再展示下一張
      holdBoard = true;
      await showCast(c);
      holdBoard = false;
      render();
      casted = true;
    }
    fxEvent(ev); // 卡牌收起後立刻播效果：浮動數字、震動、表情
  }
  if (casted) await sleep(700);
}

// 卡牌放大展示，可點一下跳過
function showCast(c) {
  return new Promise((resolve) => {
    const box = $('#cast');
    const sideCls = c.card && c.card.side !== 'shared' ? c.card.side : c.side;
    let body;
    if (c.facedown) body = `<div class="cast-card facedown ${c.side}"><div class="back">🂠</div><div class="nm">？？？</div></div>`;
    else if (c.ult) body = `<div class="cast-card ult ${c.side}"><img class="mascot-art" src="assets/${c.side}_win.webp" alt=""><div class="nm">${c.ult}</div></div>`;
    else body = `<div class="cast-card ${sideCls}"><img class="art" src="${art(c.card.id)}" alt="">
      <div class="nm">${c.card.name}</div><div class="tx">${c.card.text}</div>${pttLine(c.card)}</div>`;
    box.innerHTML = `<div class="cast-label ${c.bad ? 'bad' : ''} ${c.side}">${c.label}</div>${body}`;
    box.className = `cast-${c.side === me ? 'me' : 'opp'}`;
    sfx.card();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      box.classList.add('out');
      setTimeout(() => { box.className = 'hidden'; box.innerHTML = ''; resolve(); }, 260);
    };
    castSkip = finish;
    box.onclick = finish;
    setTimeout(finish, 1500);
  });
}

// 卡牌台詞：匿名鄉民推文格式
function pttLine(c) {
  if (!c || !c.flavor) return '';
  const tone = c.tone || 'push';
  if (tone === 'threads') return threadsPost(c.flavor);
  return `<div class="ptt"><span class="tag ${tone}">${TONE_TAG[tone]}</span><span class="id">${t('鄉民')}</span>: <span class="msg">${c.flavor}</span></div>`;
}
// 脆文樣式（不使用任何平台標誌）：頭像、帳號、內文、愛心數
const likes = () => (Math.random() < 0.3 ? Math.floor(Math.random() * 900) + 100 : Math.floor(Math.random() * 90) + 3);
function threadsPost(text) {
  return `<div class="threads"><span class="avatar"></span><div class="body"><span class="handle">${t('脆友')}</span><span class="msg">${text}</span>
    <span class="meta">♡ ${likes()}　💬 ${Math.floor(Math.random() * 30)}</span></div></div>`;
}

// 群眾推文泡泡：從群眾裡冒出來往上飄，同時最多 2 則
function chatter(kind) {
  const line = pickChatter(kind);
  if (!line) return;
  const box = $('#floats');
  const live = box.querySelectorAll('.bubble');
  if (live.length >= 2) live[0].remove();
  const [tone, text] = line;
  const el = document.createElement('div');
  el.className = `bubble ${tone === 'threads' ? 'threads-bubble' : ''}`;
  el.innerHTML = tone === 'threads'
    ? `<span class="avatar"></span><span><b>${t('脆友')}</b> ${text}</span>`
    : `<span class="tag ${tone}">${TONE_TAG[tone]}</span>${text}`;
  el.style.left = `${8 + Math.random() * 44}%`;
  // 兩條跑道，避免兩則疊在一起
  const lane = box.querySelectorAll('.bubble').length % 2;
  el.style.top = `${42 + lane * 9 + Math.random() * 2}%`;
  box.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// 浮動數字：+5 綠／藍、-3 紅
function floatNum(side, text, bad = false) {
  const el = document.createElement('div');
  el.className = `float-num ${bad ? 'bad' : side} ${side === me ? 'at-me' : 'at-opp'}`;
  el.textContent = text;
  el.style.left = `${40 + Math.random() * 20}%`;
  $('#floats').appendChild(el);
  setTimeout(() => el.remove(), 1700);
}
function shake() {
  const b = $('#battle');
  b.classList.remove('shake');
  void b.offsetWidth;
  b.classList.add('shake');
}

// 單一事件的效果：音效、提示、浮動數字、表情
function fxEvent(ev) {
  {
    const who = t(ev.side === me ? '我方' : '對手');
    switch (ev.type) {
      case 'play': break; // 已在展示卡牌時處理
      case 'pull':
        if (ev.n > 0) { sfx.pull(); floatNum(ev.side, `+${ev.n}`); pulse(ev.side, 'joy'); chatter(ev.n >= 9 ? 'bigPull' : 'pull'); }
        break;
      case 'poach':
        if (ev.n > 0) {
          sfx.hit(); shake();
          floatNum(ev.side, `+${ev.n}`); floatNum(other(ev.side), `-${ev.n}`, true);
          toast(t('{who}挖走 {n} 人', { who, n: ev.n }), ev.side); pulse(other(ev.side), 'hit'); chatter('poach');
        }
        break;
      case 'encircle':
        if (ev.n > 0) {
          sfx.hit(); floatNum(ev.side, `-${ev.n}`, true); floatNum(other(ev.side), `+${ev.n}`);
          toast(sideMsg(ev), other(ev.side)); pulse(ev.side, 'hit');
        }
        break;
      case 'status':
        sfx.status();
        toast(t('{who}：{icon}{name}', { who, icon: STATUS_INFO[ev.status].icon, name: STATUS_INFO[ev.status].name }), ev.side);
        if (STATUS_INFO[ev.status].bad) { pulse(ev.side, 'hit'); if (ev.side === me) oppReact('smug'); chatter('status'); }
        break;
      case 'ult':
        sfx.ult(); toast(t('{who}大絕招「{name}」！', { who, name: nameEN(ev.name) }), ev.side, true); chatter('ult');
        if (ev.side === me) meReact('big'); else oppReact('win', 1800);
        break;
      case 'burst':
        sfx.ult(); toast(t('{who}聲量爆表！2 回合拉票 +50%', { who }), ev.side, true);
        if (ev.side === me) meReact('big'); else oppReact('happy');
        break;
      case 'trap': sfx.trap(); toast(ev.msg, ev.side, true); chatter('trap'); break;
      case 'reflect': sfx.trap(); toast(ev.msg, ev.side, true); break;
      case 'miss': toast(sideMsg(ev), ev.side); pulse(ev.side, 'hit'); chatter('miss'); break;
      case 'sympathy': toast(sideMsg(ev), ev.side); break;
      case 'field': toast(sideMsg(ev), ev.side, true); chatter('rally'); break;
      case 'summon': toast(t('{who}召喚「{name}」', { who, name: nameEN(ev.name) }), ev.side); break;
      case 'setTrap': if (ev.side === opp) toast(t('對手蓋了一張牌…'), opp); break;
      case 'discard': if (ev.side === me) toast(t('{name} 因手牌已滿被棄掉', { name: CARD_BY_ID[ev.card]?.name || nameEN(ev.name || '') })); break;
      case 'timeout': toast(sideMsg(ev), ev.side); break;
      case 'declare':
        sfx.card();
        break;
      case 'pass':
        break; // 已用展示卡牌呈現
      case 'challenge': {
        sfx.trap();
        if (ev.n > 0) floatNum(ev.caught ? other(ev.side) : ev.side, `-${ev.n}`, true);
        if (ev.caught) { floatNum(other(ev.side), t('聲量 -{n}', { n: RULES.caughtVoice }), true); shake(); }
        chatter(ev.caught ? 'caught' : 'wrong');
        const iChallenged = ev.side === me;
        const lost = (n) => (n > 0 ? t('-{n} 人、', { n }) : '');
        if (ev.caught) {
          toast(t(iChallenged ? '抓到吹牛！其實是「{actual}」，對手{lost}聲量 -{v}' : '被抓包！你宣告的其實是「{actual}」，{lost}聲量 -{v}', { actual: nameEN(ev.actual), lost: lost(ev.n), v: RULES.caughtVoice }), ev.side, true);
          pulse(other(ev.side), 'hit');
          if (iChallenged) meReact('big');
        } else {
          const tail = ev.n > 0 ? t('，{who} -{n} 人', { who: iChallenged ? t('你') : (EN ? 'your opponent' : '對手'), n: ev.n }) : '';
          toast(t(iChallenged ? '質疑失敗！「{name}」是真的{tail}' : '對手質疑失敗！「{name}」是真的{tail}', { name: nameEN(ev.name), tail }), other(ev.side), true);
          pulse(ev.side, 'hit');
          if (!iChallenged) meReact('joy'); else oppReact('smug', 1600);
        }
        break;
      }
      case 'expose':
        toast(t(ev.side === me ? '你的陷阱被翻開了：{list}' : '對手的陷阱翻開了：{list}', { list: listJoin(ev.traps.map(nameEN)) }), other(ev.side), true);
        break;
      case 'gameOver': setTimeout(showResult, 900); break;
      default: break;
    }
  }
}

// 引擎與伺服器送來的是中文句子（前面接「我方／對手」）；英文版另組成完整句子
function sideMsg(ev) {
  if (!EN) return `${ev.side === me ? '我方' : '對手'}${ev.msg}`;
  const you = ev.side === me;
  switch (ev.type) {
    case 'encircle': return you ? `You're surrounded and lose ${ev.n} supporters` : `Your opponent is surrounded and loses ${ev.n} supporters`;
    case 'miss': return you ? 'You\'re dizzy. That card missed' : 'Your opponent is dizzy. That card missed';
    case 'sympathy': return `${you ? 'You get' : 'Your opponent gets'} a sympathy vote: the next voter gain is doubled`;
    case 'field': return `${you ? 'Your' : 'Your opponent\'s'} big rally begins!`;
    case 'timeout': return /放行/.test(ev.msg || '')
      ? `${you ? 'You' : 'Your opponent'} didn't respond, so the card was allowed`
      : `${you ? 'Your' : 'Your opponent\'s'} time ran out. Turn ended`;
    default: return tr(ev.msg);
  }
}

// ── 我方回合 ─────────────────────────────
async function startMyTurn() {
  const myGen = gen;
  render();
  await playEvents();
  if (myGen !== gen || !game || game.over) return;
  toast(t('你的回合（第 {n} 回合）', { n: game.round }), me);
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

async function doPlay(uid) {
  if (!isMyTurn()) return;
  if (mode === 'online') { send({ t: 'play', uid }); closeModal(); return; }
  if (!playCard(game, me, uid)) return;
  humanSkippedLast = false;
  closeModal();
  const myGen = gen;
  render();
  await playEvents();
  if (myGen === gen) afterMyAction();
}

// 主牌打完會自動換人；魔法卡不佔回合，繼續我的回合
function afterMyAction() {
  if (!game || game.over) return;
  if (game.current !== me) { clearInterval(timerId); nextPhase(); }
  else render();
}

async function endMyTurn() {
  if (!game || game.over || game.current !== me) return;
  if (mode === 'online') { send({ t: 'end' }); return; }
  if (game.pending) return;
  clearInterval(timerId);
  const saved = game.players[me].ap;
  humanSkippedLast = true;
  if (gameStats) { if (timeLeft > 0) gameStats.skips += 1; else gameStats.timeouts += 1; }
  endTurn(game);
  toast(timeLeft > 0 ? t('跳過，行程點 {n} 點存著', { n: saved }) : t('時間到，自動跳過'), me);
  chatter('skip');
  const myGen = gen;
  await playEvents();
  if (myGen === gen) nextPhase();
}

// ── 電腦回合：一步一步播放 ───────────────
async function runAI() {
  const myGen = gen;
  busy = true;
  clearInterval(timerId);
  $('#timer').textContent = '…';
  render();
  await playEvents();
  await sleep(1100); // 電腦「想一下」，節奏不要太快
  for (let i = 0; i < 6; i++) {
    if (myGen !== gen || game.over) return;
    if (game.current !== opp) break; // 主牌打完已經換人
    const a = aiStep(game, opp, profile, { ease });
    if (!a) break;
    render();
    await playEvents();
    if (myGen !== gen) return;
    if (game.pending) {
      const challenge = await askChallenge(Date.now() + RULES.respondSeconds * 1000);
      if (myGen !== gen || game.over) return;
      respond(game, me, challenge);
      render();
      await playEvents();
    }
    await sleep(700);
  }
  if (myGen !== gen || game.over) { busy = false; return; }
  if (game.current === opp) {
    const skipped = game.players[opp].ap;
    endTurn(game);
    toast(t('對手跳過，存了 {n} 點行程點', { n: skipped }), opp);
    chatter('skip');
    await playEvents();
  }
  busy = false;
  if (myGen === gen) nextPhase();
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
  const c = loc(game.players[me].hand.find((x) => x.uid === uid));
  if (!c) return;
  const ok = isMyTurn() && canPlay(game, me, uid);
  const cost = cardCost(game, me, c);
  let why = '';
  if (!isMyTurn()) why = t('現在不是你的回合');
  else if (c.type === 'trap' && game.players[me].traps.length >= 2) why = t('最多同時蓋 2 張陷阱');
  else if (!ok) why = t('行程點不足（需要 {n}）', { n: cost });
  openModal(`
    <div class="big-card ${c.side === 'shared' ? '' : c.side}">
      <img class="art" src="${art(c.id)}" alt="">
      <div class="nm">${TYPE[c.type][0]} ${c.name}</div>
      <div class="meta">${t('{type}卡・{rar}・行程點 {cost}', { type: t(TYPE[c.type][1]), rar: t(RAR_NAME[c.rarity]), cost })}${cost > c.cost ? t('（被追問 +1）') : ''}${t(c.type === 'magic' ? '・不佔回合' : '・打出後換對手')}</div>
      <div class="tx">${c.text}</div>
      ${pttLine(c)}
    </div>
    ${why ? `<p class="small center">${why}</p>` : ''}
    <div class="btns">
      <button class="btn" id="m-cancel">${t('取消')}</button>
      <button class="btn ${me}" id="m-play" ${ok ? '' : 'disabled'}>${t('打出')}</button>
    </div>
    ${c.type !== 'trap' && isMyTurn() ? `<div class="btns"><button class="btn bluff" id="m-declare" ${canDeclareAny(game, me) ? '' : 'disabled'}>${t('🂠 蓋牌宣告…')}</button></div>
      <p class="small center">${declareHint()}</p>` : ''}`);
  $('#m-cancel').onclick = closeModal;
  $('#m-play').onclick = () => doPlay(uid);
  if ($('#m-declare')) $('#m-declare').onclick = () => openDeclare(uid);
}

function declareHint() {
  const p = game.players[me];
  if (hasStatus(p, 'exposed')) return t('被起底中，這回合不能蓋牌宣告');
  if (game.declaredThisTurn) return t('每回合只能蓋牌宣告 1 次');
  return t('把這張蓋著打出，宣告成任何一張牌。對手可以質疑。');
}

// 選要宣告成哪一張
function openDeclare(uid) {
  const real = loc(game.players[me].hand.find((x) => x.uid === uid));
  if (!real) return;
  const ap = game.players[me].ap;
  const list = declarableCards(game, me)
    .sort((a, b) => (a.id === real.id ? -1 : b.id === real.id ? 1 : a.cost - b.cost));
  const items = list.map((c) => {
    const cost = cardCost(game, me, c);
    const ok = canDeclare(game, me, uid, c.id);
    return `<button class="decl-item ${c.side === 'shared' ? '' : c.side}" data-as="${c.id}" ${ok ? '' : 'disabled'}>
      <img class="thumb" src="${art(c.id)}" alt="" loading="lazy"><span class="cost">${cost}</span><b>${c.name}${c.id === real.id ? `<em>${t('（說實話）')}</em>` : ''}</b><span>${c.short || c.text}</span></button>`;
  }).join('');
  openModal(`<h2>${t('蓋牌宣告')}</h2>
    <p class="small">${t('手上這張是「{name}」。要宣告成哪一張？行程點照宣告的那張付（你有 {ap} 點）。宣告後換對手。', { name: real.name, ap })}</p>
    <div class="decl-list">${items}</div>
    <p class="small">${t('吹牛被抓：你 -{b} 人（聲量爆表時加倍）、聲量 -{v}，效果作廢。對手冤枉你：對手 -{w} 人，效果照常。', { b: RULES.bluffPenalty, v: RULES.caughtVoice, w: RULES.wrongChallenge })}</p>
    <div class="btns"><button class="btn" id="m-back">${t('返回')}</button></div>`, { pause: true });
  $('#m-back').onclick = () => openCard(uid);
  for (const b of document.querySelectorAll('[data-as]')) b.onclick = () => doDeclare(uid, b.dataset.as);
}

async function doDeclare(uid, asId) {
  if (!isMyTurn()) return;
  if (mode === 'online') { send({ t: 'declare', uid, as: asId }); closeModal(); return; }
  const apBefore = game.players[me].ap;
  if (!declareCard(game, me, uid, asId)) return;
  const skipped = humanSkippedLast;
  humanSkippedLast = false;
  closeModal();
  const myGen = gen;
  // 電腦一邊播演出，一邊請 Jev 判斷「這次像不像吹牛」
  const jevAsk = askJevBluff({
    asId, round: Math.min(game.round, RULES.maxRounds), apBefore, skippedLastTurn: skipped,
    handSize: game.players[me].hand.length,
    declarerSupporters: game.players[me].supporters, otherSupporters: game.players[opp].supporters,
    history: { bluffs: profile.bluffs, honest: profile.honest },
  });
  render();
  await playEvents();
  if (myGen !== gen || !game || !game.pending) return;
  showWaitingRespond(Date.now() + 1800);
  const [jevBluff] = await Promise.all([jevAsk, sleep(1300 + Math.random() * 900)]); // 電腦想一下
  if (myGen !== gen || !game || !game.pending) return;
  const d = respondDecision(game, opp, { profile, jevBluff, ease });
  respond(game, opp, d.challenge);
  toast(t('電腦研判你吹牛的機率：{p}%', { p: Math.round(d.p * 100) }) + (d.wJev ? t('（含 Jev 判斷）') : ''), opp);
  closeModal();
  render();
  await playEvents();
  if (myGen === gen) afterMyAction();
}

// 請伺服器問 Jev。只送遊戲數字；失敗或逾時回傳 null（改用歷史紀錄），不會當成「不是吹牛」
async function askJevBluff(facts) {
  if (!server.jev) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch('/api/ai/read', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(facts), signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return typeof d.bluff === 'number' ? d.bluff : null;
  } catch (e) {
    console.warn('Jev 判斷失敗，這次改用歷史紀錄：', e.message || e);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── 電腦強度自動調整（只在對戰電腦）────────────────
// 每局結束（或中途離開）記一筆戰績，問 Jev「玩家是不是快放棄了」「電腦是不是太好打」，
// 由這裡的規則決定升降一級。Jev 失敗時改用簡單規則，不把失敗當成判斷結果。
function recordGame(result) {
  if (mode !== 'local' || !game || !gameStats) return;
  const st = gameStats;
  gameStats = null; // 一局只記一次
  mood.recent.push({
    r: result,
    margin: game.players[me].supporters - game.players[opp].supporters,
    rounds: Math.min(Math.max(game.round, 1), RULES.maxRounds),
    skips: Math.min(st.skips, 12), timeouts: Math.min(st.timeouts, 12),
    minutes: Math.min(120, Math.round((Date.now() - st.startedAt) / 60000)),
  });
  mood.recent = mood.recent.slice(-8);
  mood.games = Math.min(10000, (mood.games || 0) + 1);
  saveJSON('bg_mood', mood);
  adjustDifficulty();
}

async function adjustDifficulty() {
  const before = ease;
  let next = ease;
  const read = await askJevMood();
  if (read) {
    if (read.frustrated >= 0.6 && read.tooEasy < 0.5) next = ease + 1;
    else if (read.tooEasy >= 0.6 && read.frustrated < 0.5) next = ease - 1;
  } else {
    const last = mood.recent.slice(-3);
    if (last.length === 3 && last.every((g) => g.r === 'loss' || g.r === 'quit')) next = ease + 1;
    else if (mood.recent.slice(-2).length === 2 && mood.recent.slice(-2).every((g) => g.r === 'win')) next = ease - 1;
  }
  ease = Math.max(0, Math.min(EASE_MAX, next));
  saveJSON('bg_ease', ease);
  if (ease > before) easeNotice = t('電腦這局會手下留情一點（強度：{name}）', { name: t(EASE_NAMES[ease]) });
  else if (ease < before) easeNotice = ease === 0 ? t('你變強了！電腦恢復全力') : t('電腦認真一點了（強度：{name}）', { name: t(EASE_NAMES[ease]) });
}

// 只送遊戲數字；失敗或逾時回傳 null
async function askJevMood() {
  if (!server.jev) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch('/api/ai/mood', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ recent: mood.recent, ease, games: mood.games }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return typeof d.frustrated === 'number' && typeof d.tooEasy === 'number' ? d : null;
  } catch (e) {
    console.warn('Jev 心情判斷失敗，改用簡單規則：', e.message || e);
    return null;
  } finally {
    clearTimeout(t);
  }
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
    openModal(`<h2>${t('對手蓋牌宣告')}</h2>
      <div class="big-card ${as.side === 'shared' ? '' : as.side} facedown">
        <div class="art-box"><img class="art" src="${art(as.id)}" alt=""><span class="stamp">${t('宣告')}</span></div>
        <div class="nm">${as.name}</div>
        <div class="meta">${t('{type}卡・行程點 {cost}', { type: t(TYPE[as.type][1]), cost: as.cost })}</div><div class="tx">${as.text}</div>
      </div>
      <div class="count-ring small-ring" id="m-rcount">${RULES.respondSeconds}</div>
      <p class="small center">${t('質疑要付出：你下回合行程點 -1。<br>抓到吹牛 → 對手 -{b} 人、聲量 -{v}、效果作廢；猜錯 → 你 -{w} 人。', { b: RULES.bluffPenalty, v: RULES.caughtVoice, w: RULES.wrongChallenge })}</p>
      <div class="btns">
        <button class="btn" id="m-pass">${t('放行')}</button>
        <button class="btn danger" id="m-challenge">${t('🔍 質疑！')}</button>
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
  openModal(`<h2>${t('等對手決定…')}</h2>
    <p class="center">${t('你蓋牌宣告了「{name}」', { name: as.name })}</p>
    <div class="count-ring small-ring" id="m-wcount">${RULES.respondSeconds}</div>
    <p class="small center">${t('對手正在決定要質疑還是放行')}</p>`, { locked: true });
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
    if (used) note = t('（本局已用過）');
    else if (gaffe) note = t('（失言中，不能發動）');
    else if (u.minRound && game.round < u.minRound) note = t('（第 {n} 回合後）', { n: u.minRound });
    return `<button class="ult-item" data-ult="${u.id}" ${avail.includes(u.id) ? '' : 'disabled'}><b>${u.name}${note}</b><span>${u.text}</span></button>`;
  }).join('');
  openModal(`<h2>${t('🔥 聲量爆表！擇一')}</h2>
    <div class="ult-list">${items}
      <button class="ult-item" data-ult="burst"><b>${t('進入爆表狀態')}</b><span>${t('2 回合內拉票 +50%')}</span></button>
    </div>
    <div class="btns"><button class="btn" id="m-cancel">${t('先不要')}</button></div>`);
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
  const ok = `<div class="btns"><button class="btn primary" id="m-ok">${t(first ? '開始！' : '知道了')}</button></div>`;
  if (EN) { openModal(rulesHTML_EN(RULES, CONFIG) + ok, { pause: true }); $('#m-ok').onclick = closeModal; return; }
  openModal(`<h2>怎麼玩</h2>
    <ul>
      <li>場上有 100 位灰色<b>中間選民</b>，先拉到 <b>${RULES.winAt} 人（過半）</b>就贏；第 ${RULES.maxRounds} 回合結束時，支持者多的一方獲勝。</li>
      <li><b>一回合出一張牌</b>：點手牌看說明，按「打出」，打完就換對手。不想出可以按「跳過」。每回合限時 ${CONFIG.TURN_SECONDS} 秒。</li>
      <li><b>行程點</b>（金色圓點）每回合 +${RULES.apPerTurn}，沒用完會存著，最多 ${RULES.apCap} 點。存起來就能打大牌。</li>
      <li>✨<b>魔法卡不佔回合</b>：用完還可以再出一張牌（每回合最多 1 張魔法卡）。大絕招也不佔回合。</li>
      <li>每回合抽 1 張牌，手牌最多 5 張。牌庫無限、完全隨機。</li>
      <li><b>聲量條</b>集滿 100 會出現「聲量爆表」：發動大絕招（每招每局一次），或進入爆表狀態 2 回合拉票 +50%。</li>
      <li>越後期，中間選民越難拉。被攻擊 2 次會觸發<b>同情票</b>，下次拉票加倍。</li>
      <li>卡牌：📣攻擊 👥召喚 ✨魔法 🪤陷阱（蓋著等對方觸發）🌀狀態 🎪場地。</li>
      <li><b>蓋牌宣告</b>：點手牌選「蓋牌宣告」，把牌蓋著打出並宣告成任何一張牌（行程點照宣告的付），可以說實話也可以吹牛。算這回合出的牌。</li>
      <li><b>質疑</b>：對手蓋牌宣告時你有 ${RULES.respondSeconds} 秒決定。質疑要付下回合行程點 -1：抓到吹牛，對手 -${RULES.bluffPenalty} 人、聲量 -${RULES.caughtVoice}，效果作廢；猜錯，你 -${RULES.wrongChallenge} 人。</li>
    </ul>
    <div class="btns"><button class="btn primary" id="m-ok">${first ? '開始！' : '知道了'}</button></div>`, { pause: true });
  $('#m-ok').onclick = closeModal;
}

function openPrivacy() {
  if (EN) {
    openModal(`${privacyHTML_EN(CONFIG)}<div class="btns"><button class="btn primary" id="m-ok">Close</button></div>`, { pause: true });
    $('#m-ok').onclick = closeModal;
    return;
  }
  openModal(`<h2>隱私聲明</h2>
    <p>不需註冊，不蒐集姓名、電子郵件或其他聯絡資料。</p>
    <p><b>連線對戰</b>時，伺服器會暫存你輸入的暱稱、隨機產生的玩家識別碼與對局內容，只用來進行這一局；對局結束約 1 分鐘後刪除。暱稱會顯示給對手。</p>
    <p><b>暱稱審核</b>：你輸入的暱稱會送到 TypeSafe 的 Jev 模型，判斷是否冒充真實人物或官方、罵人、歧視或拉票。審核結果（只有暱稱與通過與否）在伺服器保存 7 天，避免重複審核。請不要在暱稱裡放個人資料。</p>
    <p><b>回報問題</b>：你寫的回報內容會送到 TypeSafe 的 Jev 模型自動分類；勾選時另附這局的遊戲數字與瀏覽器種類（例如 Safari、iOS、是否在 LINE 裡開啟），不含 IP 或任何識別資料。回報最多保存 7 天，彙整寄給作者後刪除。</p>
    <p><b>聯絡信箱</b>：寄到聯絡信箱的信，主旨與內文會送到 TypeSafe 的 Jev 模型自動分類（例如下架要求、錯誤回報），寄件人地址不會送出；需要處理的信會轉寄給作者本人。</p>
    <p>你的瀏覽器會在你的裝置上記住：是否靜音、是否看過教學、上次用的暱稱、進行中對局的識別碼（關閉分頁即清除），以及<b>你對戰電腦時的出牌習慣統計</b>（被抓到吹牛幾次、多常質疑），讓電腦學著猜你。這些統計只存在你的裝置上。</p>
    <p><b>對戰電腦時</b>，你蓋牌宣告的當下，伺服器可能把<b>遊戲數字</b>（回合、雙方人數、宣告的卡、上述習慣統計）送到 TypeSafe 的 Jev 模型，請它判斷你像不像在吹牛。送出的資料不含暱稱、IP 或任何個人資料。</p>
    <p><b>電腦強度</b>：每局對戰電腦結束後，伺服器會把<b>最近幾局的遊戲數字</b>（勝負、人數差距、回合數、跳過與逾時次數、局長）送到 TypeSafe 的 Jev 模型，判斷要不要讓電腦放水。不含暱稱、IP 或任何個人資料；戰績統計只存在你的裝置上。</p>
    <p><b>防機器人</b>：線上對戰時，伺服器會記錄你每個動作的反應時間（毫秒），對局結束後把<b>統計數字</b>（平均、最快、變化程度、近一小時場數）送到 TypeSafe 的 Jev 模型，判斷操作像不像腳本。被判定可疑時，會要求做一次真人驗證或暫停線上對戰一段時間。送出的資料不含暱稱、IP 或玩家識別碼。IP 只以每天更換的雜湊值暫存在伺服器記憶體，用來計算近一小時的場數；可疑標記只記在隨機玩家識別碼上，最多保留 24 小時。</p>
    <p>網站與連線伺服器由 Cloudflare 託管。Cloudflare 會為了安全與維運記錄連線資訊（例如 IP 位址），依其隱私權政策處理；若啟用真人驗證（Cloudflare Turnstile），也適用其隱私權政策。本站自行記錄的連線資訊保存不超過 30 天。本站沒有使用廣告或追蹤工具。</p>
    <p>問題或要求：<a href="mailto:${CONFIG.CONTACT_EMAIL}">${CONFIG.CONTACT_EMAIL}</a></p>
    <p class="small">本作為政治諷刺娛樂，非任何候選人、政黨或競選團隊製作，內容不代表當事人言行。角色為原創 Q 版人偶，美術由 AI 生成。</p>
    <div class="btns"><button class="btn primary" id="m-ok">關閉</button></div>`, { pause: true });
  $('#m-ok').onclick = closeModal;
}

function openMenu() {
  openModal(`<h2>${t('選單')}</h2>
    <div class="btns" style="flex-direction:column">
      <button class="btn" id="m-rules">${t('怎麼玩')}</button>
      <button class="btn" id="m-priv">${t('隱私聲明')}</button>
      <button class="btn" id="m-report">${t('回報問題')}</button>
      <button class="btn" id="m-home">${t(mode === 'online' && game && !game.over ? '離開（30 秒後判負）' : '回首頁（放棄這局）')}</button>
      <button class="btn primary" id="m-ok">${t('繼續')}</button>
    </div>
    <p class="small center">${t('電腦強度：{name}（依你的戰績自動調整）', { name: t(EASE_NAMES[ease]) })}
      ${ease > 0 ? `<button class="link" id="m-ease">${t('改回標準')}</button>` : ''}</p>`, { pause: true });
  if ($('#m-ease')) $('#m-ease').onclick = () => { ease = 0; saveJSON('bg_ease', 0); easeNotice = t('下一局電腦恢復全力'); openMenu(); };
  $('#m-rules').onclick = () => openRules();
  $('#m-priv').onclick = openPrivacy;
  $('#m-report').onclick = openReport;
  $('#m-home').onclick = goHome;
  $('#m-ok').onclick = closeModal;
}

// ── 回報問題 ───────────────────────────────
// 回報內容會送 TypeSafe 的 Jev 分類；可附上這局的遊戲狀態（數字與瀏覽器種類，不含任何識別資料）
function reportDiag() {
  const ua = navigator.userAgent;
  const inApp = /Line\//i.test(ua) ? 'LINE' : /FBAN|FBAV/i.test(ua) ? 'Facebook' : /Instagram/i.test(ua) ? 'Instagram' : 'no';
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'other';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : 'other';
  const d = { mode, browser, os, inApp, viewport: `${innerWidth}x${innerHeight}`, ease };
  if (game) Object.assign(d, { side: me, round: game.round, blue: game.players.blue.supporters, green: game.players.green.supporters, over: !!game.over, pending: !!game.pending });
  return d;
}

function openReport() {
  openModal(`<h2>${t('回報問題')}</h2>
    <p class="small">${t('遇到錯誤、覺得某張卡不妥，或有任何建議，都可以寫在這裡。請不要寫姓名、電話等個人資料。')}</p>
    <textarea id="m-text" class="input" rows="5" maxlength="1000" placeholder="${t('例如：第 3 回合按了跳過，畫面就卡住不動')}" style="min-height:120px;padding:10px 12px;resize:vertical"></textarea>
    <label class="small" style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="m-diag" checked>${t('附上這局的遊戲狀態與瀏覽器種類（幫助找錯誤）')}</label>
    <p class="small err" id="m-err"></p>
    <p class="small">${t('回報內容會送到 TypeSafe 的 Jev 模型自動分類，需要處理的會轉給作者。')}</p>
    <div class="btns"><button class="btn" id="m-cancel">${t('取消')}</button><button class="btn primary" id="m-send">${t('送出')}</button></div>`, { pause: true });
  $('#m-cancel').onclick = closeModal;
  $('#m-send').onclick = async () => {
    const text = $('#m-text').value.trim();
    if ([...text].length < 2) { $('#m-err').textContent = t('請寫下遇到的問題'); return; }
    $('#m-send').disabled = true;
    try {
      const r = await fetch('/api/report', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, diag: $('#m-diag').checked ? reportDiag() : {} }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(tr(d.error) || t('送出失敗，請稍後再試'));
      notice(t('收到了，謝謝你的回報！'));
    } catch (e) {
      $('#m-err').textContent = e.message && !/fetch/i.test(e.message) ? e.message : t('送出失敗，也可以寄信到 {mail}', { mail: CONFIG.CONTACT_EMAIL });
      $('#m-send').disabled = false;
    }
  };
}

function goHome() {
  if (mode === 'local' && game && !game.over) recordGame('quit');
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
  recordGame(w === 'draw' ? 'draw' : won ? 'win' : 'loss');
  setOppFace(w === opp ? 'win' : w === me ? 'lose' : 'idle');
  const img = w === 'draw' ? `${me}_idle` : won ? `${me}_win` : `${me}_lose`;
  const title = t(w === 'draw' ? '平手！' : won ? '你贏了！' : '你輸了…');
  openModal(`
    <img class="result-img" src="assets/${img}.webp" alt="">
    <h2 class="center">${title}</h2>
    <div class="score"><span class="b">${t('藍 {b}', { b })}</span> : <span class="g">${t('{g} 綠', { g })}</span></div>
    <p class="center small">${esc(tr(game.reason))}</p>
    <div class="btns"><button class="btn ${me}" id="m-again">${t('再玩一次')}</button><button class="btn ${opp}" id="m-swap">${t('換陣營')}</button></div>
    <div class="btns"><button class="btn" id="m-share">${t('分享')}</button><button class="btn" id="m-home">${t('回首頁')}</button></div>
    <div class="ptt center-ptt">${w === 'draw'
      ? `<span class="tag arrow">→</span><span class="id">${t('鄉民')}</span>: <span class="msg">${t('平手？這劇本誰寫的')}</span>`
      : won ? `<span class="tag push">${TONE_TAG.push}</span><span class="id">${t('鄉民')}</span>: <span class="msg">${t('恭喜！好人一生平安')}</span>`
        : `<span class="tag arrow">→</span><span class="id">${t('鄉民')}</span>: <span class="msg">${t('下一局會更好，再來一場')}</span>`}</div>
    <p class="small center">${t('遊戲結果僅供娛樂，與實際選情無關。')}</p>`, { locked: true });
  if (mode === 'online') {
    $('#m-again').textContent = t('再配對一次');
    $('#m-swap').textContent = t('對戰電腦');
    $('#m-again').onclick = () => { const s = me; leaveOnline(); randomMatch(s); };
    $('#m-swap').onclick = () => { const s = me; leaveOnline(); startGame(s); };
  } else {
    $('#m-again').onclick = () => startGame(me);
    $('#m-swap').onclick = () => startGame(opp);
  }
  $('#m-home').onclick = goHome;
  $('#m-share').onclick = async () => {
    const text = t('我在《藍綠攻防戰》用{side}打到 藍 {b} : {g} 綠，{title} 來挑戰：{url}', { side: SIDE_NAME[me], b, g, title, url: shareUrl() });
    try {
      if (navigator.share) await navigator.share({ title: GAME_TITLE, text });
      else { await navigator.clipboard.writeText(text); toast(t('已複製分享文字')); }
    } catch { /* 使用者取消 */ }
  };
}

// 分享連結：英文版帶上 ?lang=en，朋友點開直接是英文
const shareUrl = () => `${location.origin}/${EN ? '?lang=en' : ''}`;

function toggleMute() { setMuted(!isMuted()); updateMuteIcon(); }
function updateMuteIcon() { $('#mute').textContent = isMuted() ? '🔇' : '🔊'; }

// ── 連線對戰 ─────────────────────────────
let pingTimer = null, battleRoom = null, lastTurnKey = '', roomName = '';

function notice(msg) {
  openModal(`<h2>${esc(tr(msg))}</h2><div class="btns"><button class="btn primary" id="m-ok">${t('知道了')}</button></div>`);
  $('#m-ok').onclick = closeModal;
}
function savedName() { try { return localStorage.getItem('bg_name') || ''; } catch { return ''; } }

function openModeMenu(side) {
  const online = server.online;
  openModal(`<h2>${t('{side}・選擇模式', { side: SIDE_NAME[side] })}</h2>
    <div class="btns"><button class="btn ${side}" id="m-ai">${t('🤖 對戰電腦')}</button></div>
    ${online ? `
    <hr>
    <label class="small" for="m-name">${t('連線暱稱（最多 {n} 字，會顯示給對手）', { n: NAME_MAX })}</label>
    <input id="m-name" class="input" maxlength="${NAME_MAX * 2}" value="${esc(savedName())}" placeholder="${t('例如：路過的市民')}" autocomplete="nickname">
    <p class="small err" id="m-err"></p>
    <div class="btns col">
      <button class="btn primary" id="m-rand">${t('⚡ 線上隨機配對')}</button>
      <button class="btn" id="m-host">${t('🏠 開房間給朋友')}</button>
    </div>
    <div class="row-join">
      <input id="m-code" class="input" maxlength="5" placeholder="${t('朋友的 5 碼房號')}" autocapitalize="characters" autocomplete="off">
      <button class="btn" id="m-join">${t('加入')}</button>
    </div>
    <p class="small">${t('加入朋友的房間時，你會拿到房主沒選的那一邊。')}</p>`
    : `<p class="small center">${t('連線對戰暫時無法使用，先跟電腦玩吧！')}</p>`}
    <div class="btns"><button class="btn" id="m-cancel">${t('返回')}</button></div>`);
  $('#m-ai').onclick = () => startGame(side);
  $('#m-cancel').onclick = closeModal;
  if (!online) return;
  const getName = () => {
    const n = cleanName($('#m-name').value);
    const e = checkName(n);
    if (e) { $('#m-err').textContent = tr(e); return null; }
    try { localStorage.setItem('bg_name', n); } catch { /* 忽略 */ }
    return n;
  };
  $('#m-rand').onclick = () => { const n = getName(); if (n) randomMatch(side, n); };
  $('#m-host').onclick = () => { const n = getName(); if (n) hostRoom(side, n); };
  $('#m-join').onclick = () => {
    const n = getName();
    if (!n) return;
    const code = $('#m-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) { $('#m-err').textContent = t('房號是 5 碼英文或數字'); return; }
    unlock();
    connectRoom(code, n);
  };
}

// 只有伺服器判定「操作像腳本」時才會要求真人驗證（code: 'verify'），一般玩家不會看到
async function verifyHuman() {
  if (!server.turnstileSiteKey) throw new Error('turnstile not configured');
  openModal(`<h2>${t('真人驗證')}</h2><p class="small">${t('確認你不是機器人，通常點一下就好。')}</p><div id="ts-box"></div>
    <div class="btns"><button class="btn" id="m-cancel">${t('取消')}</button></div>`, { locked: true });
  let cancelled = false;
  $('#m-cancel').onclick = () => { cancelled = true; closeModal(); };
  const token = await getTurnstileToken(server.turnstileSiteKey, $('#ts-box'));
  if (cancelled) throw new Error('cancelled');
  return token;
}

// 伺服器要求驗證時：做完驗證再用 retry(token) 重試一次
async function verifyThen(retry) {
  let token;
  try { token = await verifyHuman(); } catch { notice(t('真人驗證沒有完成，請再試一次')); return; }
  retry(token);
}

async function randomMatch(side, name = savedName(), token = null) {
  if (checkName(name)) { openModeMenu(side); return; }
  unlock();
  const total = CONFIG.MATCH_SECONDS;
  openModal(`<h2>${t('配對中…')}</h2>
    <div class="count-ring" id="m-count">${total}</div>
    <p id="m-wait" class="center">${t('正在找另一個陣營的對手…')}</p>
    <p class="small center">${t('{n} 秒內沒配到，會自動改成跟電腦對戰。', { n: total })}</p>
    <div class="btns"><button class="btn ${side}" id="m-ai">${t('直接跟電腦玩')}</button><button class="btn" id="m-cancel">${t('取消')}</button></div>`, { locked: true });
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
    if (auto) toast(t('沒有配到對手，改跟電腦對戰'), side, true);
  };
  const countTimer = setInterval(() => {
    if (lobbySock !== ws) { clearInterval(countTimer); return; }
    const left = Math.max(0, total - Math.floor((Date.now() - started) / 1000));
    const el = $('#m-count');
    if (el) {
      el.textContent = left;
      el.style.setProperty('--p', `${(left / total) * 100}%`);
    }
    if (!full && $('#m-wait') && Date.now() - started > 12_000) $('#m-wait').textContent = t('改找任何陣營的對手…');
    if (left <= 0) toAI(true);
  }, 250);
  $('#m-ai').onclick = () => toAI(false);
  $('#m-cancel').onclick = () => { stop(); closeModal(); };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', pid: getPid(), name, side, turnstile: token }));
  ws.onmessage = (e) => {
    if (lobbySock !== ws) return; // 已改跟電腦玩或已取消，忽略晚到的配對結果
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'queue' && $('#m-wait')) { full = true; $('#m-wait').textContent = tr(m.msg); }
    else if (m.t === 'error' && m.code === 'verify' && !token) { stop(); verifyThen((t) => randomMatch(side, name, t)); }
    else if (m.t === 'error') { stop(); notice(m.msg); }
    else if (m.t === 'matched') { stop(); connectRoom(m.code, name); }
  };
  ws.onclose = () => { if (lobbySock === ws) { stop(); notice(t('配對連線中斷，請再試一次')); } };
}

async function hostRoom(side, name, token = null) {
  unlock();
  try {
    const r = await fetch('/api/create', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pid: getPid(), name, side, turnstile: token }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && d.code === 'verify' && !token) { verifyThen((t) => hostRoom(side, name, t)); return; }
    if (!r.ok) { notice(d.error || d.msg || t('開房失敗，請稍後再試')); return; }
    connectRoom(d.code, name);
  } catch { notice(t('開房失敗，請檢查網路')); }
}

function showWaitingRoom(code) {
  if ($('#m-roomcode')) return;
  openModal(`<h2>${t('房間開好了')}</h2><p class="center">${t('把房號傳給朋友：')}</p>
    <div class="code" id="m-roomcode">${esc(code)}</div>
    <p class="small center">${t('朋友在首頁點任一角色 →「加入」輸入房號。10 分鐘內沒人加入會自動關閉。')}</p>
    <div class="btns"><button class="btn primary" id="m-share">${t('分享房號')}</button><button class="btn" id="m-cancel">${t('取消')}</button></div>`, { locked: true });
  $('#m-share').onclick = async () => {
    const text = t('來《藍綠攻防戰》跟我對戰！房號 {code}：{url}', { code, url: shareUrl() });
    try {
      if (navigator.share) await navigator.share({ title: GAME_TITLE, text });
      else { await navigator.clipboard.writeText(text); $('#m-share').textContent = t('已複製'); }
    } catch { /* 使用者取消 */ }
  };
  $('#m-cancel').onclick = () => { leaveOnline(); closeModal(); };
}

function send(msg) {
  if (sock && sock.readyState === 1) sock.send(JSON.stringify(msg));
  else toast(t('連線中，請稍候再試'));
}

function connectRoom(code, name, token = null) {
  gen += 1;
  mode = 'online';
  roomCode = code;
  leaving = false;
  try { sessionStorage.setItem('bg_room', JSON.stringify({ code, name, at: Date.now() })); } catch { /* 忽略 */ }
  const ws = new WebSocket(wsUrl(`/room/${code}?pid=${encodeURIComponent(getPid())}&name=${encodeURIComponent(name || '')}${token ? `&ts=${encodeURIComponent(token)}` : ''}`));
  roomName = name;
  sock = ws;
  ws.onmessage = (e) => { if (sock === ws) onRoomMessage(e.data); };
  ws.onopen = () => { reconnectUntil = 0; if (game) render(); };
  ws.onclose = (e) => {
    if (sock !== ws || leaving || e.code === 4003 || e.code === 4001) return;
    if (game && game.over) return;
    if (!reconnectUntil) reconnectUntil = Date.now() + 28_000;
    if (Date.now() < reconnectUntil) {
      if (game) toast(t('連線中斷，重新連線中…'));
      setTimeout(() => { if (sock === ws && !leaving) connectRoom(code, name); }, 2000);
    } else {
      goHome();
      notice(t('連線中斷太久，這局已結束'));
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
    if (m.fatal && m.code === 'verify' && roomCode) {
      const code = roomCode, name = roomName;
      goHome();
      verifyThen((t) => connectRoom(code, name, t));
    } else if (m.fatal) { goHome(); notice(m.msg); } else if (game) toast(m.msg);
    return;
  }
  if (m.t === 'opp') {
    if (m.status === 'left') toast(t('對手斷線了，30 秒內沒回來你就獲勝'), me, true);
    else toast(t('對手回來了'), me);
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
    toast(t(game.first === me ? '你是先手！' : '對手先手，你多拿 1 張牌'), me, true);
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
    if (!game.over && game.current === me) toast(t('你的回合（第 {n} 回合）', { n: game.round }), me);
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
    if (game.pending) { $('#timer').textContent = t('暫停'); return; }
    const prev = timeLeft;
    timeLeft = Math.max(0, Math.ceil((deadline - (Date.now() + clockOffset)) / 1000));
    if (game.current === me && timeLeft <= 10 && timeLeft > 0 && timeLeft !== prev) sfx.tick();
    updateTimer();
  };
  tick();
  timerId = setInterval(tick, 250);
}

init();
