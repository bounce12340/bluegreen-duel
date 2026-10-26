// 電腦對電腦平衡模擬
import { createGame } from '../site/js/engine.js';
import { aiTakeTurn } from '../site/js/ai.js';
const N = +(process.argv[2] || 1000);
const res = { blue: 0, green: 0, draw: 0 }, firstWin = { yes: 0, no: 0 };
let rounds = 0, byMajority = 0, margins = 0;
const ultUse = {}, cardPlays = {};
let declares = 0, bluffs = 0, challenges = 0, caught = 0;
for (let i = 0; i < N; i++) {
  const s = createGame({ seed: 1000 + i });
  while (!s.over) {
    const acts = aiTakeTurn(s, s.current);
    for (const ev of s.log) { /* log 只保留最近 30 筆，統計改看 actions */ }
    for (const a of acts) {
      if (a.kind === 'declare') { declares++; }
      if (a.kind === 'respond' && a.challenge) challenges++;
    }
    for (const a of acts.filter((x) => x.kind === 'play' || x.kind === 'ult' || x.kind === 'burst')) { const k = a.kind === 'play' ? a.id : a.kind === 'ult' ? a.id : 'burst'; (a.kind==='play'?cardPlays:ultUse)[k] = ((a.kind==='play'?cardPlays:ultUse)[k] || 0) + 1; }
  }
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
console.log('出牌次數', Object.entries(cardPlays).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join(' '));
// 部署前檢查：任一方勝率超出 40–60% 就視為失衡，讓 CI 失敗
const blueRate = res.blue / N;
if (blueRate < 0.4 || blueRate > 0.6) { console.error('平衡檢查失敗：藍方勝率', blueRate); process.exit(1); }
