// Jev 實測案例：打正式環境的 /api/ai/read，記錄每個案例的輸入與回答，可重跑比對。
// 用法：node tools/jev_cases.mjs [BASE]    （每 IP 每分鐘上限 20 次，案例數保持在 20 以下）
// 這些案例沒有「標準答案」，看的是方向對不對：明顯老實的要低、明顯吹牛的要高、資訊不足的在中間。
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] || 'https://bluegreen-duel.pages.dev';
const base = { round: 5, apBefore: 5, skippedLastTurn: false, handSize: 3, declarerSupporters: 20, otherSupporters: 20, history: { bluffs: 0, honest: 0 } };
const CASES = [
  { name: '一般：中期宣告 2 費普通卡，沒有紀錄', expect: '中', f: { asId: 's_market' } },
  { name: '弱卡：宣告 1 費「掃街拜票」，沒有紀錄', expect: '偏低', f: { asId: 's_street', apBefore: 4 } },
  { name: '存錢後出大牌：上回合跳過、宣告 5 費史詩，過去 5 次都老實', expect: '低', f: { asId: 'g_speech', apBefore: 7, skippedLastTurn: true, history: { bluffs: 0, honest: 5 } } },
  { name: '慣犯：宣告 5 費史詩，過去 6 次都是吹牛', expect: '高', f: { asId: 'g_speech', history: { bluffs: 6, honest: 0 } } },
  { name: '一半一半：宣告 5 費史詩，過去 3 吹 3 實', expect: '中', f: { asId: 'g_speech', history: { bluffs: 3, honest: 3 } } },
  { name: '絕望一搏：第 11 回合落後 5 比 45，宣告史詩', expect: '偏高', f: { asId: 'b_vision', round: 11, declarerSupporters: 5, otherSupporters: 45 } },
  { name: '剛好能贏：40 人宣告拉 14 人的卡', expect: '中', f: { asId: 'b_vision', round: 9, declarerSupporters: 40, otherSupporters: 30 } },
  { name: '開局：第 1 回合宣告 3 費稀有卡', expect: '中', f: { asId: 's_forum', round: 1, apBefore: 3, declarerSupporters: 0, otherSupporters: 0 } },
];

const results = [];
for (const c of CASES) {
  const facts = { ...base, ...c.f, history: { ...base.history, ...(c.f.history || {}) } };
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/ai/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(facts) });
  const ms = Date.now() - t0;
  const d = await r.json().catch(() => ({}));
  results.push({ ...c, facts, status: r.status, bluff: d.bluff ?? null, model: d.model ?? null, ms });
  console.log(`${String(d.bluff ?? d.error).padEnd(6).slice(0, 6)}  預期${c.expect.padEnd(3)} ${ms}ms  ${c.name}`);
}
writeFileSync(new URL('./jev_cases_result.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2));
