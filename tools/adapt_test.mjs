// 電腦對手適應力測試：讓電腦（藍）對上四種固定風格的玩家（綠），比較「有記憶（跨局保留紀錄）」與「沒記憶」。
// 用法：node tools/adapt_test.mjs [局數]
import * as E from '../site/js/engine.js';
import { aiStep, respondDecision, observeEvents, newProfile } from '../site/js/ai.js';

const STYLES = {
  老實人: { declareHonest: 0.4, bluff: 0, challenge: 0 },
  愛吹牛: { declareHonest: 0, bluff: 0.5, challenge: 0 },
  愛質疑: { declareHonest: 0, bluff: 0, challenge: 1 },
  一般人: { declareHonest: 0.1, bluff: 0.15, challenge: 0.35 },
};

function botStep(s, side, st) {
  const me = s.players[side];
  const magic = me.hand.find((c) => c.type === 'magic' && E.canPlay(s, side, c.uid));
  if (magic) { E.playCard(s, side, magic.uid); return true; }
  const playable = me.hand.filter((c) => c.type !== 'magic' && E.canPlay(s, side, c.uid)).sort((a, b) => b.cost - a.cost);
  const r = E.rand(s);
  if (E.canDeclareAny(s, side)) {
    const targets = E.declarableCards(s, side).filter((c) => E.cardCost(s, side, c) <= me.ap).sort((a, b) => b.cost - a.cost);
    const nonTrap = me.hand.filter((c) => c.type !== 'trap').sort((a, b) => a.cost - b.cost);
    if (r < st.bluff && nonTrap.length && targets.length && targets[0].id !== nonTrap[0].id) {
      E.declareCard(s, side, nonTrap[0].uid, targets[0].id); return true;
    }
    const best = playable.find((c) => c.type !== 'trap');
    if (r < st.declareHonest && best && E.canDeclare(s, side, best.uid, best.id)) {
      E.declareCard(s, side, best.uid, best.id); return true;
    }
  }
  if (playable.length) { E.playCard(s, side, playable[0].uid); return true; }
  return false;
}

function run(styleName, learn, N) {
  const st = STYLES[styleName];
  let aiWin = 0, aiDecl = 0, aiBluff = 0, oppDecl = 0, aiChallenged = 0;
  let profile = newProfile();
  for (let i = 0; i < N; i++) {
    if (!learn) profile = newProfile();
    const s = E.createGame({ seed: 90000 + i });
    while (!s.over) {
      const side = s.current;
      if (side === 'blue') {
        for (let k = 0; k < 6 && s.current === 'blue' && !s.over; k++) {
          const a = aiStep(s, 'blue', profile);
          if (!a) break;
          if (a.kind === 'declare') { aiDecl++; if (a.why === 'bluff') aiBluff++; }
          if (s.pending) {
            const before = s.events.length;
            E.respond(s, 'green', E.rand(s) < st.challenge);
            observeEvents(profile, s.events.slice(before), 'green');
          }
        }
        if (!s.over && s.current === 'blue') E.endTurn(s);
      } else {
        for (let k = 0; k < 4 && s.current === 'green' && !s.over; k++) {
          if (!botStep(s, 'green', st)) break;
          if (s.pending) {
            oppDecl++;
            const d = respondDecision(s, 'blue', { profile });
            if (d.challenge) aiChallenged++;
            const before = s.events.length;
            E.respond(s, 'blue', d.challenge);
            observeEvents(profile, s.events.slice(before), 'green');
          }
        }
        if (!s.over && s.current === 'green') E.endTurn(s);
      }
    }
    if (s.winner === 'blue') aiWin++;
  }
  const pc = (a, b) => (b ? `${(100 * a / b).toFixed(0)}%` : '—');
  console.log(`${styleName}｜${learn ? '有記憶' : '沒記憶'}｜電腦勝率 ${pc(aiWin, N)}｜電腦質疑對方 ${pc(aiChallenged, oppDecl)}｜電腦宣告中吹牛占 ${pc(aiBluff, aiDecl)}`);
}

const N = +(process.argv[2] || 400);
for (const name of Object.keys(STYLES)) { run(name, false, N); run(name, true, N); }
