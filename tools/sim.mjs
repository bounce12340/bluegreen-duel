// 電腦對電腦平衡模擬
import { createGame } from '../site/js/engine.js';
import { aiTakeTurn, newProfile, aiChoosePolicy } from '../site/js/ai.js';
import { POLICIES } from '../site/js/cards.js';
// POLICY=random：雙方隨機選策略，量測每張策略的勝率
const POLICY_MODE = process.env.POLICY || 'best';
const pol = {}; for (const p of POLICIES) pol[p.id] = { picks: 0, wins: 0 };
let combos = 0, venues = {};
const N = +(process.argv[2] || 1000);
const res = { blue: 0, green: 0, draw: 0 }, firstWin = { yes: 0, no: 0 };
let rounds = 0, byMajority = 0, margins = 0;
const ultUse = {}, cardPlays = {};
let declares = 0, bluffs = 0, challenges = 0, caught = 0;
for (let i = 0; i < N; i++) {
  const s = createGame({ seed: 1000 + i, today: 'all' }); // 含所有時事卡，確認加了也不失衡
  const profiles = { blue: newProfile(), green: newProfile() };
  aiChoosePolicy(s, 'blue', { mode: POLICY_MODE }); aiChoosePolicy(s, 'green', { mode: POLICY_MODE });
  while (!s.over) {
    for (const ev of s.events) { if (ev.type === 'combo') combos++; if (ev.type === 'venue') venues[ev.id] = (venues[ev.id] || 0) + 1; }
    s.events = [];
    const acts = aiTakeTurn(s, s.current, { profiles });
    for (const ev of s.log) { /* log 只保留最近 30 筆，統計改看 actions */ }
    for (const a of acts) {
      if (a.kind === 'declare') { declares++; }
      if (a.kind === 'respond' && a.challenge) challenges++;
    }
    for (const a of acts.filter((x) => x.kind === 'play' || x.kind === 'ult' || x.kind === 'burst')) { const k = a.kind === 'play' ? a.id : a.kind === 'ult' ? a.id : 'burst'; (a.kind==='play'?cardPlays:ultUse)[k] = ((a.kind==='play'?cardPlays:ultUse)[k] || 0) + 1; }
  }
  for (const ev of s.events) if (ev.type === 'combo') combos++;
  s.events = [];
  for (const sd of ['blue', 'green']) { const id = s.players[sd].policy; pol[id].picks++; if (s.winner === sd) pol[id].wins++; }
  res[s.winner]++;
  if (s.winner !== 'draw') firstWin[s.winner === s.first ? 'yes' : 'no']++;
  rounds += Math.min(s.round, 12);
  if (s.reason === '支持者過半') byMajority++;
  margins += Math.abs(s.players.blue.supporters - s.players.green.supporters);
}
const pct = (x) => (100 * x / N).toFixed(1) + '%';
console.log('藍勝', pct(res.blue), '綠勝', pct(res.green), '平手', pct(res.draw));
console.log('先手勝率', (100 * firstWin.yes / (firstWin.yes + firstWin.no)).toFixed(1) + '%');
console.log('平均結束回合', (rounds / N).toFixed(1), '過半提前結束', pct(byMajority), '平均差距', (margins / N).toFixed(1));
console.log('每局平均：蓋牌宣告', (declares / N).toFixed(2), '次，被質疑', (challenges / N).toFixed(2), '次');
console.log('絕招/爆表', ultUse);
console.log('每局平均連擊', (combos / N).toFixed(2), '次；場地事件', venues);
console.log(`競選策略（${POLICY_MODE}）勝率`, Object.entries(pol).map(([k, v]) => `${k}:${v.picks ? (100 * v.wins / v.picks).toFixed(1) : '-'}%(${v.picks})`).join(' '));
console.log('出牌次數', Object.entries(cardPlays).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join(' '));
// 部署前檢查：任一方勝率超出 40–60% 就視為失衡，讓 CI 失敗
const blueRate = res.blue / N;
if (blueRate < 0.4 || blueRate > 0.6) { console.error('平衡檢查失敗：藍方勝率', blueRate); process.exit(1); }
