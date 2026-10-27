// 規則引擎：純邏輯，不碰畫面。瀏覽器與 Node 模擬共用同一份。
// 所有亂數都從 state.rngState 來，同一個種子可重現整局，方便除錯與平衡模擬。
// 整局狀態都是純資料（可 JSON 化），伺服器休眠後可以從儲存空間原樣還原。
import { CARDS, RARITY_WEIGHT, ULTS, POLICIES, VENUES, VENUE_ROUNDS, VENUE_LENGTH, COMBO_BONUS } from './cards.js';
import { NEWS_CARDS, activeNewsIds } from './news_cards.js';

export const RULES = {
  totalVoters: 100,
  winAt: 51,          // 過半即勝：中間選民只有 100 人，達 100 人實務上不會發生
  maxRounds: 12,
  handMax: 5,
  openingHand: 4,
  drawPerTurn: 1,     // 一回合只出一張主牌，所以只抽 1 張
  apPerTurn: 3,       // 行程點存錢制：每回合 +3，可累積
  apCap: 10,
  // 一回合一個動作：打一張主牌（攻擊、召喚、狀態、場地、陷阱）或蓋牌宣告後自動換人；
  // 魔法卡、大絕招、聲量爆表不佔回合（魔法卡每回合最多 1 張）
  pityTurns: 3,       // 連續幾回合沒抽到攻擊卡就保底
  hitsForSympathy: 2,
  // 質疑
  bluffPenalty: 5,      // 吹牛被抓，出牌方回到中間的人數（聲量爆表時加倍）
  wrongChallenge: 3,    // 冤枉對手，質疑方回到中間的人數
  catchVoice: 15,       // 抓到吹牛，質疑方聲量
  caughtVoice: 20,      // 吹牛被抓，出牌方聲量也扣（避免前期沒支持者時吹牛零風險）
  honestVoice: 10,      // 被冤枉，出牌方聲量
  respondSeconds: 8,    // 對手決定要不要質疑的時間
  policyOffers: 3,      // 開局可選的競選策略張數
  policySeconds: 15,    // 選策略的時間（連線對戰）
};

// mulberry32：狀態只有一個整數，存在 s.rngState
export function rand(s) {
  s.rngState = (s.rngState + 0x6d2b79f5) >>> 0;
  let t = s.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const CARD_BY_ID = Object.fromEntries([...CARDS, ...NEWS_CARDS].map((c) => [c.id, c]));
const poolOf = (s) => s.poolIds.map((id) => CARD_BY_ID[id]).filter(Boolean);

const other = (side) => (side === 'blue' ? 'green' : 'blue');

function newPlayer(side) {
  return {
    side, supporters: 0, ap: 0, apBonus: 0, hand: [], voice: 0,
    statuses: [], summons: [], traps: [], usedUlts: [],
    noAttackStreak: 0, hits: 0, emptyHandBonus: 0, uid: 0,
    policy: null,       // 競選策略 id
  };
}

// today：台北日期（YYYY-MM-DD），決定哪些時事卡上架；'all'＝全部（平衡模擬）；不給＝不含時事卡
export function createGame({ seed = Date.now(), firstSide, disabledCards = [], today = null } = {}) {
  const s = {
    seed, rngState: seed >>> 0, round: 1, turnIndex: 0, over: false, winner: null, reason: '',
    players: { blue: newPlayer('blue'), green: newPlayer('green') },
    first: null, current: null, field: null, events: [], log: [],
    pending: null, declaredThisTurn: false, // 蓋牌宣告等待對手回應
    magicThisTurn: false,
    poolIds: [...CARDS.map((c) => c.id), ...activeNewsIds(today)].filter((id) => !disabledCards.includes(id)),
    nextUid: 1,
    phase: 'policy',     // 'policy' 開局選競選策略｜'play' 對戰中
    offers: { blue: [], green: [] },
    venue: null, venueRound: 0, comboTag: null,
  };
  s.first = firstSide || (rand(s) < 0.5 ? 'blue' : 'green');
  s.current = s.first;
  const second = other(s.first);
  for (let i = 0; i < RULES.openingHand; i++) { drawCard(s, s.first); drawCard(s, second); }
  drawCard(s, second); // 後手補償：多 1 張牌（先手首回合不抽牌）
  for (const side of ['blue', 'green']) s.offers[side] = pickIds(s, POLICIES.map((x) => x.id), RULES.policyOffers);
  return s;
}

// 從清單隨機挑 n 個不重複的
function pickIds(s, ids, n) {
  const pool = [...ids], out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand(s) * pool.length), 1)[0]);
  return out;
}

// ── 競選策略 ───────────────────────────
export const POLICY_BY_ID = Object.fromEntries(POLICIES.map((x) => [x.id, x]));
export const VENUE_BY_ID = Object.fromEntries(VENUES.map((x) => [x.id, x]));
const hasPolicy = (p, id) => p.policy === id;
const venueIs = (s, id) => !!(s.venue && s.venue.id === id);

export function choosePolicy(s, side, id) {
  if (s.phase !== 'policy' || s.players[side].policy || !s.offers[side].includes(id)) return false;
  s.players[side].policy = id;
  emit(s, { type: 'policyChosen', side });
  if (s.players.blue.policy && s.players.green.policy) {
    s.phase = 'play';
    emit(s, { type: 'policies', blue: s.players.blue.policy, green: s.players.green.policy });
    for (const sd of ['blue', 'green']) if (hasPolicy(s.players[sd], 'p_early')) pull(s, sd, 3, { raw: true }); // 早鳥行程：開局先拉 3 人
    startTurn(s);
  }
  return true;
}

export const neutral = (s) => RULES.totalVoters - s.players.blue.supporters - s.players.green.supporters;

function emit(s, ev) {
  s.events.push(ev);
  if (ev.msg) { s.log.push(ev.msg); if (s.log.length > 30) s.log.shift(); }
}

// ── 抽牌 ───────────────────────────────
function pickCard(s, side, forceAttack) {
  let pool = poolOf(s).filter((c) => c.side === side || c.side === 'shared');
  if (forceAttack) pool = pool.filter((c) => c.type === 'attack');
  const total = Object.values(RARITY_WEIGHT).reduce((a, b) => a + b, 0);
  let r = rand(s) * total;
  let rarity = 'common';
  for (const [k, w] of Object.entries(RARITY_WEIGHT)) { if ((r -= w) < 0) { rarity = k; break; } }
  let bucket = pool.filter((c) => c.rarity === rarity);
  if (!bucket.length) bucket = pool;
  return bucket[Math.floor(rand(s) * bucket.length)];
}

function drawCard(s, side, forceAttack = false) {
  const p = s.players[side];
  const c = pickCard(s, side, forceAttack);
  if (!c) return null;
  if (p.hand.length >= RULES.handMax) {
    emit(s, { type: 'discard', side, card: c.id, msg: `${c.name} 因手牌已滿被棄掉` });
    return null;
  }
  const inst = { ...c, uid: s.nextUid++ };
  p.hand.push(inst);
  emit(s, { type: 'draw', side, card: c.id });
  return inst;
}

// ── 狀態 ───────────────────────────────
export const hasStatus = (p, id) => p.statuses.some((x) => x.id === id);
const removeStatus = (p, id) => { p.statuses = p.statuses.filter((x) => x.id !== id); };
function addStatus(s, side, id, turns, from) {
  const p = s.players[side];
  removeStatus(p, id);
  p.statuses.push({ id, turns, from, charges: id === 'question' ? 2 : 1 });
  emit(s, { type: 'status', side, status: id });
}

function registerHit(s, side) {
  const p = s.players[side];
  p.voice = Math.min(100, p.voice + 8);
  p.hits += 1;
  if (p.hits >= RULES.hitsForSympathy && !hasStatus(p, 'sympathy')) {
    p.hits = 0;
    addStatus(s, side, 'sympathy', 99, side);
    emit(s, { type: 'sympathy', side, msg: '同情票觸發：下次拉票加倍' });
  }
}

// ── 拉票與挖角 ─────────────────────────
export function decay(round) { return Math.max(0.67, 1 - 0.03 * (round - 1)); } // 後期中間選民較難動搖

function movePull(s, side, n) {
  const got = Math.max(0, Math.min(n, neutral(s)));
  s.players[side].supporters += got;
  return got;
}

function pull(s, side, base, { fromCard = false, raw = false } = {}) {
  const p = s.players[side];
  let mult = 1;
  if (!raw) {
    if (hasStatus(p, 'burst')) mult *= 1.5;
    if (hasStatus(p, 'ultBoost')) mult *= 2;
    if (fromCard && hasStatus(p, 'sympathy')) { mult *= 2; removeStatus(p, 'sympathy'); }
  }
  if (fromCard) base += (hasPolicy(p, 'p_crowd') && base >= 5 ? 1 : 0) + (venueIs(s, 'v_newyear') ? 2 : 0);
  let amount = Math.max(1, Math.round(base * decay(s.round) * mult));
  let got = movePull(s, side, amount);
  if (fromCard && got > 0) {
    const opp = s.players[other(side)];
    const trapIdx = opp.traps.findIndex((t) => t.fx.trap === 'flip');
    if (trapIdx >= 0) {
      const back = Math.floor(got / 2);
      opp.traps.splice(trapIdx, 1);
      p.supporters -= back;
      got -= back;
      emit(s, { type: 'trap', side: other(side), trap: 'flip', msg: `陷阱「跑票」：${back} 人走回中間` });
    }
    p.voice = Math.min(100, p.voice + 5);
  }
  emit(s, { type: 'pull', side, n: got });
  return got;
}

function poach(s, side, base) {
  const victim = s.players[other(side)];
  const n = Math.min(victim.supporters, Math.max(0, base - (hasPolicy(victim, 'p_steady') ? 2 : 0)));
  victim.supporters -= n;
  s.players[side].supporters += n;
  emit(s, { type: 'poach', side, n });
  if (n > 0) registerHit(s, other(side));
  return n;
}

// ── 回合流程 ───────────────────────────
function startTurn(s) {
  const side = s.current;
  s.declaredThisTurn = false;
  s.comboTag = null;
  const p = s.players[side];
  const opp = s.players[other(side)];

  // 場地事件：第 3、6、9 回合開始時翻一張，持續 3 回合
  if (s.venue && s.round >= s.venue.until) { emit(s, { type: 'venueEnd', id: s.venue.id }); s.venue = null; }
  if (side === s.first && VENUE_ROUNDS.includes(s.round) && s.venueRound !== s.round) {
    const used = s.venuesSeen || [];
    const ids = VENUES.map((v) => v.id).filter((id) => !used.includes(id));
    const id = pickIds(s, ids.length ? ids : VENUES.map((v) => v.id), 1)[0];
    s.venue = { id, until: s.round + VENUE_LENGTH };
    s.venueRound = s.round;
    s.venuesSeen = [...used, id];
    emit(s, { type: 'venue', id });
  }

  p.turns = (p.turns || 0) + 1;
  p.ap = Math.max(0, Math.min(RULES.apCap, p.ap + RULES.apPerTurn + p.apBonus - (venueIs(s, 'v_typhoon') ? 1 : 0)));
  p.apBonus = 0;
  s.magicThisTurn = false;

  // 對方的「下雨了」在這回合開始時觸發
  const rainIdx = opp.traps.findIndex((t) => t.fx.trap === 'rain');
  if (rainIdx >= 0) {
    opp.traps.splice(rainIdx, 1);
    if (s.field && s.field.owner === side) {
      s.field = null;
      emit(s, { type: 'trap', side: other(side), trap: 'rain', msg: '陷阱「下雨了」：造勢晚會提前結束' });
    } else {
      p.ap = Math.max(0, p.ap - 1);
      emit(s, { type: 'trap', side: other(side), trap: 'rain', msg: '陷阱「下雨了」：行程點 -1' });
    }
  }

  // 抽牌與保底（資料控：第 4、8 回合多抽 1 張）
  const dataBonus = hasPolicy(p, 'p_data') && (s.round === 4 || s.round === 8) ? 1 : 0;
  const draws = RULES.drawPerTurn + p.emptyHandBonus + dataBonus - (s.turnIndex === 0 ? 1 : 0); // 先手首回合不抽牌
  p.emptyHandBonus = 0;
  let gotAttack = false;
  for (let i = 0; i < draws; i++) {
    const force = i === draws - 1 && !gotAttack && p.noAttackStreak >= RULES.pityTurns;
    const c = drawCard(s, side, force);
    if (c && c.type === 'attack') gotAttack = true;
  }
  p.noAttackStreak = gotAttack ? 0 : p.noAttackStreak + 1;

  // 聲量自然成長，後期加速（網路先行 +5、迷因爆紅 +10）
  p.voice = Math.min(100, p.voice + (s.round >= 7 ? 15 : 10) + (hasPolicy(p, 'p_online') ? 5 : 0) + (venueIs(s, 'v_meme') ? 10 : 0));

  // 被包圍：每回合被對方拉走 2 人
  for (const st of p.statuses) {
    if (st.id === 'encircle') {
      const n = Math.min(2, p.supporters);
      p.supporters -= n;
      s.players[st.from].supporters += n;
      emit(s, { type: 'encircle', side, n, msg: `被包圍，流失 ${n} 人` });
    }
  }

  // 召喚物與場地
  for (const sm of p.summons) {
    pull(s, side, venueIs(s, 'v_mrt') ? 1 : sm.perTurn, { raw: true });
    sm.turns -= 1;
  }
  p.summons = p.summons.filter((sm) => sm.turns > 0);
  if (hasPolicy(p, 'p_turnout') && s.round >= 9) pull(s, side, 1, { raw: true });
  if (s.field && s.field.owner === side) {
    pull(s, side, venueIs(s, 'v_artnight') ? 5 : 3, { raw: true });
    s.field.turns -= 1;
    if (s.field.turns <= 0) s.field = null;
  }
  emit(s, { type: 'turnStart', side, round: s.round });
  checkWin(s);
}

export function endTurn(s) {
  if (s.over || s.phase === 'policy') return;
  if (s.pending) { respond(s, other(s.pending.side), false); return; } // 沒回應視同放行（結算後會自動換人）
  const side = s.current;
  const p = s.players[side];
  for (const st of p.statuses) st.turns -= 1;
  p.statuses = p.statuses.filter((st) => st.turns > 0);
  if (p.hand.length === 0) p.emptyHandBonus = 1;
  emit(s, { type: 'turnEnd', side });

  s.turnIndex += 1;
  s.current = other(side);
  if (s.current === s.first) s.round += 1;
  if (s.round > RULES.maxRounds) return finishByCount(s);
  startTurn(s);
}

function checkWin(s) {
  for (const side of ['blue', 'green']) {
    if (s.players[side].supporters >= RULES.winAt) {
      s.over = true; s.winner = side; s.reason = '支持者過半';
      emit(s, { type: 'gameOver', winner: side });
      return true;
    }
  }
  return false;
}

export function finishByCount(s) {
  const b = s.players.blue, g = s.players.green;
  let w;
  if (b.supporters !== g.supporters) { w = b.supporters > g.supporters ? 'blue' : 'green'; s.reason = '第 12 回合結束，支持者較多'; }
  else if (b.hand.length !== g.hand.length) { w = b.hand.length > g.hand.length ? 'blue' : 'green'; s.reason = '支持者同數，比手牌'; }
  else if (b.voice !== g.voice) { w = b.voice > g.voice ? 'blue' : 'green'; s.reason = '支持者與手牌同數，比聲量'; }
  else { w = 'draw'; s.reason = '完全平手'; }
  s.over = true; s.winner = w;
  emit(s, { type: 'gameOver', winner: w });
}

// ── 出牌 ───────────────────────────────
export function cardCost(s, side, card) {
  let c = card.cost + (hasStatus(s.players[side], 'question') ? 1 : 0);
  if (venueIs(s, 'v_market') && card.type === 'attack') c = Math.max(1, c - 1);
  return c;
}

export function canPlay(s, side, uid) {
  if (s.over || s.phase === 'policy' || s.current !== side || s.pending) return false;
  const p = s.players[side];
  const c = p.hand.find((x) => x.uid === uid);
  if (!c) return false;
  if (c.type === 'trap' && p.traps.length >= 2) return false;
  if (c.type === 'magic' && s.magicThisTurn) return false;
  return cardCost(s, side, c) <= p.ap;
}

// 主牌打完就換人；魔法卡不佔回合
function afterMainAction(s) {
  if (!s.over && !s.pending) endTurn(s);
}

export function playCard(s, side, uid) {
  if (!canPlay(s, side, uid)) return false;
  const p = s.players[side];
  const oppSide = other(side);
  const opp = s.players[oppSide];
  const idx = p.hand.findIndex((x) => x.uid === uid);
  const c = p.hand[idx];
  payCost(s, side, c);
  p.hand.splice(idx, 1);
  if (c.type === 'trap') emit(s, { type: 'play', side, hidden: true }); // 陷阱是蓋牌，不公開名稱
  else emit(s, { type: 'play', side, card: c.id, name: c.name, msg: `${side === 'blue' ? '藍' : '綠'}方打出「${c.name}」` });
  resolveEffect(s, side, c);
  if (c.type === 'magic') { s.magicThisTurn = true; s.comboTag = c.combo || null; }
  else afterMainAction(s);
  return true;
}

function payCost(s, side, card) {
  const p = s.players[side];
  p.ap -= cardCost(s, side, card);
  const q = p.statuses.find((x) => x.id === 'question');
  if (q && --q.charges <= 0) removeStatus(p, 'question');
}

// 卡牌效果結算：一般出牌與「宣告的卡」共用
function resolveEffect(s, side, c) {
  const p = s.players[side];
  const oppSide = other(side);
  const opp = s.players[oppSide];
  const fx = c.fx;
  const isAttack = fx.pull || fx.poach;

  if (isAttack) {
    // 對方的大反射：攻擊轉向
    if (hasStatus(opp, 'reflect')) {
      removeStatus(opp, 'reflect');
      emit(s, { type: 'reflect', side: oppSide, msg: '問A答B・大反射：攻擊轉向！' });
      if (fx.pull) pull(s, oppSide, fx.pull, { raw: true });
      if (fx.poach) poach(s, oppSide, fx.poach);
      checkWin(s);
      return;
    }
    // 自己頭暈：50% 打歪
    if (hasStatus(p, 'deflect')) {
      removeStatus(p, 'deflect');
      if (rand(s) < 0.5) {
        emit(s, { type: 'miss', side, msg: '頭暈轉圈，這張打歪了' });
        return;
      }
    }
  }

  if (fx.pull) pull(s, side, fx.pull, { fromCard: true });
  if (fx.poach) poach(s, side, fx.poach);
  if (fx.voice) p.voice = Math.min(100, p.voice + fx.voice);
  if (fx.draw) for (let i = 0; i < fx.draw; i++) drawCard(s, side);
  if (fx.ap) p.ap += fx.ap;
  if (fx.applyStatus) {
    addStatus(s, oppSide, fx.applyStatus.id, fx.applyStatus.turns, side);
    registerHit(s, oppSide);
    if (fx.applyStatus.id === 'exposed' && opp.traps.length) {
      emit(s, { type: 'expose', side: oppSide, traps: opp.traps.map((t) => t.name), msg: `對方的蓋牌被翻開：${opp.traps.map((t) => t.name).join('、')}` });
    }
  }
  if (fx.summon) {
    p.summons.push({ ...fx.summon, turns: fx.summon.turns + (hasPolicy(p, 'p_grassroots') ? 1 : 0) });
    emit(s, { type: 'summon', side, name: fx.summon.name });
  }
  if (fx.field) {
    s.field = { owner: side, turns: 2, card: c.id };
    emit(s, { type: 'field', side, msg: '造勢晚會開始！' });
  }
  if (fx.trap) { p.traps.push(c); emit(s, { type: 'setTrap', side }); }
  // 連擊：這回合先打了同系列的魔法卡
  if (c.type !== 'magic' && c.combo && s.comboTag === c.combo && s.current === side) {
    s.comboTag = null;
    emit(s, { type: 'combo', side, tag: c.combo });
    pull(s, side, COMBO_BONUS.pull, { raw: true });
    p.voice = Math.min(100, p.voice + COMBO_BONUS.voice);
  }
  checkWin(s);
}

// ── 質疑：蓋牌宣告 ─────────────────────
// 可以宣告成己方或共用卡池裡任何一張非陷阱卡；行程點照宣告的那張付。
export function declarableCards(s, side) {
  return poolOf(s).filter((c) => (c.side === side || c.side === 'shared') && c.type !== 'trap');
}

export function canDeclareAny(s, side) {
  const p = s.players[side];
  return !s.over && s.phase !== 'policy' && !s.pending && s.current === side && !s.declaredThisTurn
    && !hasStatus(p, 'exposed') && p.hand.some((c) => c.type !== 'trap');
}

export function canDeclare(s, side, uid, asId) {
  if (!canDeclareAny(s, side)) return false;
  const p = s.players[side];
  const c = p.hand.find((x) => x.uid === uid);
  const as = declarableCards(s, side).find((x) => x.id === asId);
  if (!c || c.type === 'trap' || !as) return false;
  return cardCost(s, side, as) <= p.ap;
}

export function declareCard(s, side, uid, asId) {
  if (!canDeclare(s, side, uid, asId)) return false;
  const p = s.players[side];
  const idx = p.hand.findIndex((x) => x.uid === uid);
  const c = p.hand[idx];
  const as = CARD_BY_ID[asId];
  payCost(s, side, as);
  p.hand.splice(idx, 1);
  s.declaredThisTurn = true;
  s.pending = { side, cardId: c.id, asId };
  emit(s, { type: 'declare', side, asId, name: as.name, text: as.text, msg: `${side === 'blue' ? '藍' : '綠'}方蓋牌宣告「${as.name}」` });
  return true;
}

// 對手回應：challenge=true 質疑（下回合行程點 -1）；false 放行
export function respond(s, side, challenge) {
  const pd = s.pending;
  if (!pd || s.over || side === pd.side) return false;
  const liarSide = pd.side;
  const liar = s.players[liarSide];
  const me = s.players[side];
  const as = CARD_BY_ID[pd.asId];
  const actual = CARD_BY_ID[pd.cardId];
  s.pending = null;

  if (!challenge) {
    emit(s, { type: 'pass', side, asId: as.id, name: as.name, msg: `放行，「${as.name}」生效` });
    resolveEffect(s, liarSide, as);
    afterMainAction(s);
    return true;
  }

  me.apBonus -= 1;
  const honest = pd.cardId === pd.asId;
  const debate = venueIs(s, 'v_debate') ? 2 : 0;
  if (honest) {
    const n = Math.min(Math.max(0, RULES.wrongChallenge + debate - (hasPolicy(me, 'p_debater') ? 2 : 0)), me.supporters);
    me.supporters -= n;
    liar.voice = Math.min(100, liar.voice + RULES.honestVoice);
    emit(s, { type: 'challenge', side, caught: false, n, asId: as.id, name: as.name, msg: `質疑失敗！「${as.name}」是真的` });
    resolveEffect(s, liarSide, as);
  } else {
    const penalty = RULES.bluffPenalty * (hasStatus(liar, 'burst') ? 2 : 1) + debate + (hasPolicy(me, 'p_debater') ? 3 : 0);
    const n = Math.min(penalty, liar.supporters);
    liar.supporters -= n;
    liar.voice = Math.max(0, liar.voice - RULES.caughtVoice);
    me.voice = Math.min(100, me.voice + RULES.catchVoice);
    emit(s, { type: 'challenge', side, caught: true, n, asId: as.id, actualId: actual.id, name: as.name, actual: actual.name,
      msg: `抓到吹牛！宣告「${as.name}」其實是「${actual.name}」` });
    checkWin(s);
  }
  afterMainAction(s);
  return true;
}

// ── 聲量爆表：大絕招或爆表狀態 ─────────
export function availableUlts(s, side) {
  const p = s.players[side];
  if (s.over || s.phase === 'policy' || s.current !== side || s.pending || p.voice < 100 || hasStatus(p, 'gaffe')) return [];
  return ULTS[side].filter((u) => !p.usedUlts.includes(u.id) && (!u.minRound || s.round >= u.minRound));
}
export const canBurst = (s, side) => {
  const p = s.players[side];
  return !s.over && s.phase !== 'policy' && !s.pending && s.current === side && p.voice >= 100;
};

export function enterBurst(s, side) {
  if (!canBurst(s, side)) return false;
  const p = s.players[side];
  p.voice = 0;
  addStatus(s, side, 'burst', 2, side);
  emit(s, { type: 'burst', side, msg: '聲量爆表！2 回合拉票 +50%' });
  return true;
}

export function useUlt(s, side, ultId) {
  const u = availableUlts(s, side).find((x) => x.id === ultId);
  if (!u) return false;
  const p = s.players[side];
  const oppSide = other(side);
  const opp = s.players[oppSide];
  p.voice = 0;
  p.usedUlts.push(u.id);
  emit(s, { type: 'ult', side, ult: u.id, name: u.name, msg: `大絕招「${u.name}」！` });
  switch (u.id) {
    case 'u_shield': {
      addStatus(s, side, 'ultBoost', 1, side);
      const bad = p.statuses.find((st) => ['encircle', 'question', 'deflect', 'gaffe'].includes(st.id));
      if (bad) removeStatus(p, bad.id);
      break;
    }
    case 'u_birds': p.summons.push({ perTurn: 3, turns: 3 + (hasPolicy(p, 'p_grassroots') ? 1 : 0), name: '青鳥群' }); break;
    case 'u_team': p.summons.push({ perTurn: 3, turns: 3 + (hasPolicy(p, 'p_grassroots') ? 1 : 0), name: '市政團隊' }); break;
    case 'u_reflect': addStatus(s, side, 'reflect', 2, side); break;
    case 'u_swap': {
      const mine = p.statuses, theirs = opp.statuses;
      p.statuses = theirs.map((st) => ({ ...st, from: st.from === side ? oppSide : side }));
      opp.statuses = mine.map((st) => ({ ...st, from: st.from === side ? oppSide : side }));
      pull(s, side, Math.floor(s.round / 2), { raw: true }); // 與市政成績單對等
      break;
    }
    case 'u_report': {
      opp.statuses = opp.statuses.filter((st) => !['burst', 'sympathy', 'ultBoost', 'reflect'].includes(st.id));
      if (s.field && s.field.owner === oppSide) s.field = null;
      pull(s, side, Math.floor(s.round / 2), { raw: true });
      break;
    }
  }
  checkWin(s);
  return true;
}

// 讓畫面取走並清空事件
export function takeEvents(s) { const e = s.events; s.events = []; return e; }
