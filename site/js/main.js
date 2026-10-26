import { CONFIG } from './config.js';
import { ULTS, STATUS_INFO, SIDE_NAME, SIDE_FULL } from './cards.js';
import {
  RULES, createGame, playCard, canPlay, cardCost, endTurn, takeEvents, availableUlts,
  canBurst, enterBurst, useUlt, neutral, hasStatus,
} from './engine.js';
import { aiStep } from './ai.js';
import { createCrowd } from './crowd.js';
import { unlock, sfx, isMuted, setMuted } from './sound.js';

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

function init() {
  for (const a of document.querySelectorAll('.contact-link')) {
    a.href = `mailto:${CONFIG.CONTACT_EMAIL}`;
    a.textContent = CONFIG.CONTACT_EMAIL;
  }
  if (CONFIG.SPONSOR_URL) {
    const s = $('.sponsor-link');
    s.href = CONFIG.SPONSOR_URL;
    s.classList.remove('hidden');
  }
  const reason = closedReason();
  if (reason) { $('#closed-msg').textContent = reason; show('closed'); return; }
  show('title');
  for (const b of document.querySelectorAll('.pick-btn')) b.addEventListener('click', () => startGame(b.dataset.side));
  for (const b of document.querySelectorAll('[data-open]')) b.addEventListener('click', () => (b.dataset.open === 'rules' ? openRules() : openPrivacy()));
  $('#mute').addEventListener('click', toggleMute);
  $('#menu').addEventListener('click', openMenu);
  $('#end-btn').addEventListener('click', () => { if (isMyTurn()) endMyTurn(); });
  $('#ult-btn').addEventListener('click', openUlt);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !$('#modal').dataset.locked) closeModal(); });
  updateMuteIcon();
}

// ── 開局 ─────────────────────────────────
function startGame(side) {
  const reason = closedReason();
  if (reason) { $('#closed-msg').textContent = reason; show('closed'); return; }
  unlock();
  gen += 1; // 讓上一局還在跑的電腦回合自動中止
  me = side; opp = other(side);
  game = createGame({ seed: Math.floor(Math.random() * 2 ** 31), disabledCards: CONFIG.disabledCards });
  busy = false;
  closeModal();
  show('battle');
  $('#me-mascot').src = `assets/${me}_back.webp`;
  $('#me-mascot').alt = `${SIDE_NAME[me]}（我方）`;
  setOppFace('idle');
  $('#opp-plat').className = `platform opp-plat ${opp}`;
  $('#me-plat').className = `platform me-plat ${me}`;
  crowd.reset({ me, opp });
  crowd.start();
  takeEvents(game); // 開局抽牌的事件不用播
  render();
  toast(game.first === me ? '你是先手！' : '對手先手，你多拿 1 張牌和 30 聲量', me, true);
  let seen = false;
  try { seen = localStorage.getItem('bg_seen_help') === '1'; } catch { /* 忽略 */ }
  if (!seen) {
    openRules(true);
    try { localStorage.setItem('bg_seen_help', '1'); } catch { /* 忽略 */ }
  }
  nextPhase();
}

function nextPhase() {
  if (game.over) { playEvents(); render(); return; }
  if (game.current === me) startMyTurn();
  else runAI();
}

const isMyTurn = () => game && !game.over && !busy && game.current === me;

// ── 畫面 ─────────────────────────────────
function infoHTML(side, mine) {
  const p = game.players[side];
  const pct = Math.min(100, (p.supporters / RULES.winAt) * 100);
  const chips = p.statuses.map((st) => {
    const info = STATUS_INFO[st.id];
    return `<span class="chip ${info.bad ? 'bad' : 'good'}">${info.icon}${info.name}</span>`;
  });
  for (const sm of p.summons) chips.push(`<span class="chip good">👥${sm.name}×${sm.turns}</span>`);
  if (p.traps.length) chips.push(`<span class="chip">🪤蓋牌×${p.traps.length}</span>`);
  if (!mine) chips.push(`<span class="chip">🂠手牌×${p.hand.length}</span>`);
  return `
    <div class="row"><span class="who">${SIDE_NAME[side]}<span class="small">（${SIDE_FULL[side]}）</span>${mine ? '' : ''}</span>
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
    : `<span class="small">${busy ? '對手行動中…' : ''}</span>`;

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
  if (!isMyTurn() || !playCard(game, me, uid)) return;
  closeModal();
  playEvents();
  render();
}

function endMyTurn() {
  if (!game || game.over || game.current !== me) return;
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
    </div>`);
  $('#m-cancel').onclick = closeModal;
  $('#m-play').onclick = () => doPlay(uid);
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
    </ul>
    <div class="btns"><button class="btn primary" id="m-ok">${first ? '開始！' : '知道了'}</button></div>`, { pause: true });
  $('#m-ok').onclick = closeModal;
}

function openPrivacy() {
  openModal(`<h2>隱私聲明</h2>
    <p>本遊戲目前為單機版：不需註冊，也不蒐集姓名、電子郵件或其他聯絡資料。</p>
    <p>你的瀏覽器只會在你的裝置上記住兩件事：是否靜音、是否看過教學。這些資料不會傳回我們。</p>
    <p>網站由 Cloudflare 託管。Cloudflare 會為了安全與維運記錄連線資訊（例如 IP 位址），依其隱私權政策處理。本站沒有使用廣告或追蹤工具。</p>
    <p>日後若加入連線對戰或防機器人驗證，會先更新本聲明；屆時記錄的連線資訊將於 30 天後刪除。</p>
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
      <button class="btn" id="m-home">回首頁（放棄這局）</button>
      <button class="btn primary" id="m-ok">繼續</button>
    </div>`, { pause: true });
  $('#m-rules').onclick = () => openRules();
  $('#m-priv').onclick = openPrivacy;
  $('#m-home').onclick = goHome;
  $('#m-ok').onclick = closeModal;
}

function goHome() {
  gen += 1;
  clearInterval(timerId);
  busy = false;
  game = null;
  crowd.stop();
  closeModal();
  show('title');
}

function showResult() {
  clearInterval(timerId);
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
  $('#m-again').onclick = () => startGame(me);
  $('#m-swap').onclick = () => startGame(opp);
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

init();
