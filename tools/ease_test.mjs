// 難度檢查：全力電腦 vs 放水電腦（ease 0～3），放水越多應該輸越多。用法：node tools/ease_test.mjs [局數]
import { createGame, endTurn, respond } from '../site/js/engine.js';
import { aiStep, aiRespond, newProfile, EASE_MAX } from '../site/js/ai.js';
const N = Number(process.argv[2] || 600);
for (let ease = 0; ease <= EASE_MAX; ease++) {
  let strongWins = 0;
  for (let i = 0; i < N; i++) {
    const s = createGame({ seed: 5000 + i });
    const strong = i % 2 ? 'blue' : 'green'; // 輪流換邊，抵消陣營差異
    const easeOf = (side) => (side === strong ? 0 : ease);
    const prof = { blue: newProfile(), green: newProfile() };
    for (let guard = 0; guard < 400 && !s.over; guard++) {
      const side = s.current;
      let acted = false;
      for (let k = 0; k < 14 && !s.over && s.current === side; k++) {
        const a = aiStep(s, side, prof[side], { ease: easeOf(side) });
        if (!a) break;
        acted = true;
        if (s.pending) {
          const o = side === 'blue' ? 'green' : 'blue';
          respond(s, o, aiRespond(s, o, { profile: prof[o], ease: easeOf(o) }));
        }
      }
      if (!s.over && s.current === side) endTurn(s);
    }
    if (s.winner === strong) strongWins++;
  }
  console.log(`ease ${ease}：全力電腦勝率 ${(strongWins / N * 100).toFixed(1)}%`);
}
