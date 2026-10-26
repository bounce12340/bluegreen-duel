// 電腦對手：期望值（EV）決策＋對手習慣紀錄。
// - 出牌、跳過、吹牛、質疑都算期望值，選期望值高的做法。
// - profile 記錄「這位對手」的習慣（被抓過幾次吹牛、多常質疑），跨局累積，用來估計機率。
// - 質疑時可以另外傳入 Jev 對「這次像不像吹牛」的判斷（jevBluff），和歷史紀錄加權合併。
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


// ── 價值換算（單位：約等於「我方多 1 位支持者」）────────────
const W = {
  oppSupporter: 0.8,  // 對手掉 1 人（回到中間）
  voicePoint: 0.06,   // 1 點聲量
  apPoint: 2.0,       // 1 點行程點
  future: 0.5,        // 留在手上的牌，未來價值打折
};

// ── 對手習慣紀錄 ──────────────────────────────
export function newProfile() {
  return { bluffs: 0, honest: 0, challenges: 0, passes: 0, games: 0 };
}
// 從事件更新紀錄。oppSide＝被記錄的那位（對手）
export function observeEvents(profile, events, oppSide) {
  if (!profile) return;
  for (const ev of events) {
    if (ev.type === 'challenge') {
      if (ev.side === oppSide) profile.challenges += 1;          // 對手質疑了我
      else if (ev.caught) profile.bluffs += 1;                    // 我抓到對手吹牛
      else profile.honest += 1;                                   // 我冤枉了對手
    } else if (ev.type === 'pass' && ev.side === oppSide) {
      profile.passes += 1;                                        // 對手放行了我
    }
  }
}
// 對手這次在吹牛的機率（只看歷史，Beta 先驗：平均 0.3）
export function bluffRateFromHistory(profile) {
  const p = profile || newProfile();
  return (p.bluffs + 1.5) / (p.bluffs + p.honest + 5);
}
// 對手會質疑我的機率（Beta 先驗：平均約 0.33）
export function challengeRateFromHistory(profile) {
  const p = profile || newProfile();
  return (p.challenges + 2) / (p.challenges + p.passes + 6);
}

// 回傳這回合做了哪些動作（給畫面逐步播放用）。profiles：{ blue, green } 各自記錄對手
export function aiTakeTurn(s, side, { autoEnd = true, profiles = null } = {}) {
  const actions = [];
  const oppSide = side === 'blue' ? 'green' : 'blue';
  for (let guard = 0; guard < 14; guard++) {
    const a = aiStep(s, side, profiles && profiles[side]);
    if (!a) break;
    actions.push(a);
    // 模擬時由另一個電腦回應蓋牌宣告
    if (s.pending) {
      const ch = aiRespond(s, oppSide, { profile: profiles && profiles[oppSide] });
      const before = s.events.length;
      respond(s, oppSide, ch);
      const evs = s.events.slice(before);
      if (profiles) { observeEvents(profiles[side], evs, oppSide); observeEvents(profiles[oppSide], evs, side); }
      actions.push({ kind: 'respond', challenge: ch });
    }
  }
  if (autoEnd && !s.over && s.current === side) endTurn(s);
  return actions;
}

// 只做一個動作，讓畫面可以一步一步播放；沒事可做時回傳 null（＝跳過）
export function aiStep(s, side, profile = null) {
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
  const best = bestMainCard(s, side);
  const decl = planDeclare(s, side, best, profile);
  if (decl) {
    declareCard(s, side, decl.uid, decl.asId);
    return { kind: 'declare', uid: decl.uid, asId: decl.asId, why: decl.why };
  }
  if (!best || shouldSave(s, side, best)) return null;
  playCard(s, side, best.uid);
  return { kind: 'play', uid: best.uid, id: best.id };
}

// 主牌：價值扣掉行程點的機會成本，挑最高的
function bestMainCard(s, side) {
  let best = null, bestScore = 1.5;
  for (const c of s.players[side].hand) {
    if (c.type === 'magic' || !canPlay(s, side, c.uid)) continue;
    const score = cardValue(s, side, c) - 0.35 * cardCost(s, side, c);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

// 跳過存錢的期望值：下回合才付得起的大牌 vs 現在出這張
function shouldSave(s, side, best) {
  const me = s.players[side];
  const next = me.ap + RULES.apPerTurn;
  const big = me.hand.filter((c) => c.type !== 'magic' && cardCost(s, side, c) > me.ap && cardCost(s, side, c) <= next)
    .reduce((a, c) => (!a || cardValue(s, side, c) > cardValue(s, side, a) ? c : a), null);
  if (!big) return false;
  const afterPlay = me.ap - cardCost(s, side, best) + RULES.apPerTurn;
  if (afterPlay >= cardCost(s, side, big)) return false; // 出了這張，下回合還是付得起大牌
  const evPlayNow = cardValue(s, side, best);
  const evSave = 0.85 * cardValue(s, side, big) - cardValue(s, side, best) * W.future; // 晚一回合打折
  return evSave > evPlayNow;
}

// 要不要蓋牌宣告：比較「正常打出」「蓋著說實話（釣質疑）」「拿爛牌吹牛」三種做法的期望值。
// 為了節奏，只有部分回合會考慮蓋牌（不然每回合都跳質疑視窗）。
function planDeclare(s, side, best, profile) {
  if (!canDeclareAny(s, side)) return null;
  const me = s.players[side];
  const opp = s.players[side === 'blue' ? 'green' : 'blue'];
  const hand = me.hand.filter((c) => c.type !== 'trap');
  if (!hand.length) return null;
  const q = challengeRateFromHistory(profile); // 對手會質疑的機率
  const wrongGain = W.oppSupporter * Math.min(RULES.wrongChallenge, opp.supporters) + RULES.honestVoice * W.voicePoint + W.apPoint;
  const caughtLoss = Math.min(RULES.bluffPenalty * (hasStatus(me, 'burst') ? 2 : 1), me.supporters) + RULES.caughtVoice * W.voicePoint;

  const options = [];
  const evPlain = best ? cardValue(s, side, best) : 0;
  if (best && best.type !== 'trap' && canDeclare(s, side, best.uid, best.id)) {
    options.push({ uid: best.uid, asId: best.id, why: 'bait', ev: evPlain + q * wrongGain });
  }
  const junk = hand.reduce((a, b) => (cardValue(s, side, b) < cardValue(s, side, a) ? b : a));
  let target = null, tv = -Infinity;
  for (const c of declarableCards(s, side)) {
    if (cardCost(s, side, c) > me.ap) continue;
    const v = cardValue(s, side, c);
    if (v > tv) { target = c; tv = v; }
  }
  if (target && target.id !== junk.id) {
    // 吹牛成功拿到宣告效果；被抓則效果作廢、掉人掉聲量。好處是爛牌出掉、好牌留著
    const kept = best && best.uid !== junk.uid ? W.future * (cardValue(s, side, best) - cardValue(s, side, junk)) : 0;
    options.push({ uid: junk.uid, asId: target.id, why: 'bluff', ev: (1 - q) * tv - q * caughtLoss + kept });
  }
  if (!options.length) return null;
  const top = options.reduce((a, b) => (b.ev > a.ev ? b : a));
  if (top.ev < evPlain + 0.5) return null;
  // 節奏：大約三成的回合才蓋牌；明顯划算時（差距大）多一點
  const gate = Math.min(0.5, 0.18 + 0.04 * (top.ev - evPlain));
  if (rand(s) >= gate) return null;
  return top;
}

// 面對對手的蓋牌宣告要不要質疑：估計對手吹牛的機率 p，比較質疑與放行的期望值。
// profile：對手的歷史紀錄；jevBluff：Jev 對「這次像不像吹牛」的判斷（0–1），沒有就只用歷史。
export function aiRespond(s, side, { profile = null, jevBluff = null } = {}) {
  return respondDecision(s, side, { profile, jevBluff }).challenge;
}

export function respondDecision(s, side, { profile = null, jevBluff = null } = {}) {
  const pd = s.pending;
  if (!pd) return { challenge: false };
  const as = CARD_BY_ID[pd.asId];
  const declarer = s.players[pd.side];
  const me = s.players[side];
  // 吹牛機率：歷史紀錄 + Jev。紀錄越多，越相信紀錄
  const pHist = bluffRateFromHistory(profile);
  const seen = profile ? profile.bluffs + profile.honest : 0;
  const wJev = typeof jevBluff === 'number' ? 0.5 * (5 / (5 + seen)) : 0;
  const p = wJev * jevBluff + (1 - wJev) * pHist;

  // 宣告效果對對手的價值；生效就輸的話視為極大
  let V = cardValue(s, pd.side, as);
  const gain = (as.fx.pull || 0) + (as.fx.poach || 0);
  if (declarer.supporters + gain >= RULES.winAt) V = 50;
  const nCaught = Math.min(RULES.bluffPenalty * (hasStatus(declarer, 'burst') ? 2 : 1), declarer.supporters);
  const nWrong = Math.min(RULES.wrongChallenge, me.supporters);
  const evChallenge = p * (V + W.oppSupporter * nCaught + (RULES.caughtVoice + RULES.catchVoice) * W.voicePoint)
    - (1 - p) * (nWrong + RULES.honestVoice * W.voicePoint)
    - W.apPoint;
  // 期望值相近時加一點隨機，不要被摸透
  const noise = (rand(s) - 0.5) * 0.8;
  return { challenge: evChallenge > noise, p, pHist, wJev, ev: evChallenge };
}
