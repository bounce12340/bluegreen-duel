// 電腦對手：貪婪策略，每次挑「價值 ÷ 費用」最高且付得起的卡，直到出不了牌。
// 刻意不做得太強，讓新手也能贏。
import {
  playCard, canPlay, cardCost, availableUlts, canBurst, enterBurst, useUlt, endTurn, neutral, hasStatus, decay,
  rand, RULES, CARD_BY_ID, canDeclareAny, canDeclare, declareCard, declarableCards, respond,
} from './engine.js';

function cardValue(s, side, c) {
  const me = s.players[side];
  const opp = s.players[side === 'blue' ? 'green' : 'blue'];
  const fx = c.fx;
  let v = 0;
  if (fx.pull) v += Math.min(fx.pull * decay(s.round), neutral(s));
  if (fx.poach) v += Math.min(fx.poach, opp.supporters) * 1.8;
  if (fx.voice) v += fx.voice / 10;
  if (fx.draw) v += me.hand.length <= 3 ? 2.5 * fx.draw : 1;
  if (fx.ap) v += 2.5;
  if (fx.summon) v += fx.summon.perTurn * fx.summon.turns * 0.8;
  if (fx.field) v += s.field && s.field.owner === side ? 0 : 5;
  if (fx.trap) v += me.traps.length < 2 ? 2.5 : -10;
  if (fx.applyStatus) {
    const id = fx.applyStatus.id;
    if (hasStatus(opp, id)) v -= 5;
    else v += { encircle: 6, question: 2, deflect: 2.5, gaffe: opp.voice >= 70 ? 4 : 1, exposed: opp.traps.length ? 3 : 1.5 }[id] || 1;
  }
  return v;
}

function chooseUlt(s, side) {
  const ults = availableUlts(s, side);
  if (!ults.length) return null;
  const me = s.players[side];
  const opp = s.players[side === 'blue' ? 'green' : 'blue'];
  const ids = ults.map((u) => u.id);
  const oppBuffs = opp.statuses.some((st) => ['burst', 'sympathy', 'reflect', 'ultBoost'].includes(st.id)) || opp.summons.length;
  const myBad = me.statuses.filter((st) => ['encircle', 'question', 'deflect', 'gaffe'].includes(st.id)).length;
  const oppBad = opp.statuses.filter((st) => ['encircle', 'question', 'deflect', 'gaffe'].includes(st.id)).length;
  if (ids.includes('u_report') && oppBuffs) return 'u_report';
  if (ids.includes('u_swap') && myBad > oppBad) return 'u_swap';
  if (ids.includes('u_birds') && s.round <= 9) return 'u_birds';
  if (ids.includes('u_team') && s.round <= 9) return 'u_team';
  const hasBigAttack = me.hand.some((c) => c.fx.pull >= 5);
  if (ids.includes('u_shield') && hasBigAttack) return 'u_shield';
  if (ids.includes('u_reflect')) return 'u_reflect';
  if (ids.includes('u_report')) return 'u_report';
  return null; // 留著，改用爆表
}

// 回傳這回合做了哪些動作（給畫面逐步播放用）
export function aiTakeTurn(s, side, { autoEnd = true } = {}) {
  const actions = [];
  for (let guard = 0; guard < 14; guard++) {
    const a = aiStep(s, side);
    if (!a) break;
    actions.push(a);
    // 模擬時由另一個電腦回應蓋牌宣告
    if (s.pending) {
      const ch = aiRespond(s, side === 'blue' ? 'green' : 'blue');
      respond(s, side === 'blue' ? 'green' : 'blue', ch);
      actions.push({ kind: 'respond', challenge: ch });
    }
  }
  if (autoEnd && !s.over && s.current === side) endTurn(s);
  return actions;
}

// 只做一個動作，讓畫面可以一步一步播放；沒事可做時回傳 null
export function aiStep(s, side) {
  if (s.over || s.current !== side) return null;
  if (canBurst(s, side)) {
    const u = chooseUlt(s, side);
    if (u) { useUlt(s, side, u); return { kind: 'ult', id: u }; }
    enterBurst(s, side);
    return { kind: 'burst' };
  }
  const me = s.players[side];
  // 魔法卡不佔回合，有用就先用
  for (const c of me.hand) {
    if (c.type !== 'magic' || !canPlay(s, side, c.uid)) continue;
    if (cardValue(s, side, c) >= 2) { playCard(s, side, c.uid); return { kind: 'play', uid: c.uid, id: c.id }; }
  }
  // 主牌：挑價值最高、付得起的；稍微偏好便宜的，留行程點
  let best = null, bestScore = 1.5;
  for (const c of me.hand) {
    if (c.type === 'magic' || !canPlay(s, side, c.uid)) continue;
    const score = cardValue(s, side, c) - 0.35 * cardCost(s, side, c);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  // 存錢：手上有付不起的大牌，而眼前的牌不怎麼樣，就跳過這回合
  const big = me.hand.filter((c) => c.type !== 'magic' && cardCost(s, side, c) > me.ap && cardCost(s, side, c) <= me.ap + RULES.apPerTurn)
    .reduce((a, c) => (!a || cardValue(s, side, c) > cardValue(s, side, a) ? c : a), null);
  if (big && (!best || cardValue(s, side, best) < 0.45 * cardValue(s, side, big))) best = null;
  const bluff = planDeclare(s, side, best);
  if (bluff) {
    declareCard(s, side, bluff.uid, bluff.asId);
    return { kind: 'declare', uid: bluff.uid, asId: bluff.asId };
  }
  if (!best) return null;
  playCard(s, side, best.uid);
  return { kind: 'play', uid: best.uid, id: best.id };
}

// 要不要蓋牌宣告：拿手上最沒用的牌假裝成強牌（吹牛），或偶爾把強牌蓋著打出去釣對手質疑
function planDeclare(s, side, bestNormal) {
  if (!canDeclareAny(s, side)) return null;
  const me = s.players[side];
  const hand = me.hand.filter((c) => c.type !== 'trap');
  if (!hand.length) return null;
  // 說實話的釣魚：強牌偶爾蓋著打
  if (bestNormal && bestNormal.type !== 'trap' && cardValue(s, side, bestNormal) >= 4 && rand(s) < 0.2
      && canDeclare(s, side, bestNormal.uid, bestNormal.id)) {
    return { uid: bestNormal.uid, asId: bestNormal.id };
  }
  // 吹牛：最沒用的牌 → 付得起的最強宣告
  const junk = hand.reduce((a, b) => (cardValue(s, side, b) < cardValue(s, side, a) ? b : a));
  let target = null, tv = -Infinity;
  for (const c of declarableCards(s, side)) {
    if (cardCost(s, side, c) > me.ap) continue;
    const v = cardValue(s, side, c);
    if (v > tv) { target = c; tv = v; }
  }
  if (!target || target.id === junk.id) return null;
  if (tv - cardValue(s, side, junk) < 4) return null;
  // 吹牛被抓會掉人，落後太多時不敢亂來；聲量爆表時懲罰加倍，也少吹
  let p = 0.12;
  if (hasStatus(me, 'burst')) p -= 0.15;
  if (me.supporters < RULES.bluffPenalty) p += 0.1; // 沒什麼人可掉，反而敢吹
  if (rand(s) >= p) return null;
  return { uid: junk.uid, asId: target.id };
}

// 面對對手的蓋牌宣告要不要質疑。只看公開資訊，不偷看蓋著的牌。
export function aiRespond(s, side) {
  const pd = s.pending;
  if (!pd) return false;
  const as = CARD_BY_ID[pd.asId];
  const declarer = s.players[pd.side];
  const me = s.players[side];
  let p = 0.25;
  if (as.rarity === 'epic') p += 0.2;
  if (as.cost >= 4) p += 0.1;
  const gain = (as.fx.pull || 0) + (as.fx.poach || 0) + (as.fx.field ? 6 : 0);
  if (declarer.supporters + gain >= RULES.winAt) p += 0.35; // 讓它生效就輸了，拼一下
  if (me.supporters < RULES.wrongChallenge) p += 0.05;      // 質疑錯也掉不了幾個人
  if (s.round <= 2) p -= 0.1;                               // 前期行程點少，-1 很痛
  return rand(s) < Math.max(0.05, Math.min(0.9, p));
}
