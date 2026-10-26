// 電腦對手：貪婪策略，每次挑「價值 ÷ 費用」最高且付得起的卡，直到出不了牌。
// 刻意不做得太強，讓新手也能贏。
import { playCard, canPlay, cardCost, availableUlts, canBurst, enterBurst, useUlt, endTurn, neutral, hasStatus, decay } from './engine.js';

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
    else v += { encircle: 6, question: 2, deflect: 2.5, gaffe: opp.voice >= 70 ? 4 : 1 }[id] || 1;
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
  }
  if (autoEnd && !s.over) endTurn(s);
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
  let best = null, bestScore = 0.5;
  for (const c of me.hand) {
    if (!canPlay(s, side, c.uid)) continue;
    const cost = Math.max(1, cardCost(s, side, c));
    const score = cardValue(s, side, c) / cost;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  if (!best) return null;
  playCard(s, side, best.uid);
  return { kind: 'play', uid: best.uid, id: best.id };
}
