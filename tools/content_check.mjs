// 卡牌內容合規＋嘲諷對稱檢查（部署前跑）。問題與規則在 worker/src/jev.js。
// 用法：TYPESAFE_API_KEY=... node tools/content_check.mjs [--report-only]
// - 合規：任一規則機率 ≥ 0.7 → 不合格（--report-only 時只報告）；0.3–0.7 → 需要人工看
// - 對稱：每張卡「酸到哪一邊 × 有多酸」加總，比較藍綠兩邊被酸的總量
// - Jev 呼叫失敗：視為「沒檢查到」，印出警告，不當成合格或不合格
import { writeFileSync } from 'node:fs';
import { CARDS, ULTS } from '../site/js/cards.js';
import { CHATTER, TONE_TAG } from '../site/js/chatter.js';
import { judgeCard, CONTENT_RULES, NEWS_RULES, JEV_MODEL } from '../worker/src/jev.js';
import { NEWS_CARDS } from '../site/js/news_cards.js';

const KEY = process.env.TYPESAFE_API_KEY;
const REPORT_ONLY = process.argv.includes('--report-only');
const URL_OVERRIDE = process.env.JEV_URL_OVERRIDE || undefined;
const FAIL_AT = 0.7, REVIEW_AT = 0.3, SYMMETRY_TOLERANCE = 0.3;

if (!KEY) {
  console.log('::warning::沒有 TYPESAFE_API_KEY，略過內容檢查');
  process.exit(0);
}

const sideLabel = { blue: 'blue（蔣萬安陣營的卡）', green: 'green（沈伯洋陣營的卡）', shared: 'shared（雙方共用）' };
const items = [
  ...CARDS.map((c) => ({ id: c.id, card: { name: c.name, belongs_to: sideLabel[c.side], effect: c.text, flavor_text: `anonymous netizen comment: ${c.flavor}` } })),
  ...Object.entries(ULTS).flatMap(([side, list]) => list.map((u) => ({
    id: u.id, card: { name: u.name, belongs_to: sideLabel[side], kind: 'special move', effect: u.text },
  }))),
];

// 時事卡：多問「指控真人做壞事」「提到民調」；因為有附來源，「陳述真實事件」不算不合格，只列入人工確認
for (const c of NEWS_CARDS) {
  items.push({ id: c.id, news: true, card: {
    name: c.name, belongs_to: sideLabel[c.side], kind: 'topical card', effect: c.text,
    flavor_text: `anonymous netizen comment: ${c.flavor}`, about: c.topic || '', news_sources: c.sources,
  } });
}

// 群眾推文：每種情境一組，當成一張「卡」檢查（雙方通用，不屬於任何陣營）
for (const [kind, lines] of Object.entries(CHATTER)) {
  items.push({ id: `chatter_${kind}`, card: {
    name: `crowd comments (${kind})`, belongs_to: 'shared（雙方共用）', kind: 'anonymous crowd comments shown during play',
    comments: lines.map(([tone, text]) => `${TONE_TAG[tone]} ${text}`),
  } });
}

const results = [];
let failedCalls = 0;
async function worker(queue) {
  for (let it = queue.shift(); it; it = queue.shift()) {
    try {
      const r = await judgeCard(KEY, it.card, URL_OVERRIDE, { news: !!it.news });
      results.push({ ...it, scores: r.scores });
    } catch (e) {
      failedCalls += 1;
      results.push({ ...it, error: String(e).slice(0, 200) });
    }
  }
}
const queue = [...items];
await Promise.all([worker(queue), worker(queue), worker(queue), worker(queue)]);
results.sort((a, b) => items.findIndex((x) => x.id === a.id) - items.findIndex((x) => x.id === b.id));

const fails = [], reviews = [];
let blue = 0, green = 0;
const contrib = [];
for (const r of results) {
  if (!r.scores) continue;
  const rules = r.news ? [...CONTENT_RULES, ...NEWS_RULES] : CONTENT_RULES;
  for (const rule of rules) {
    const v = r.scores[rule.key];
    // 時事卡：陳述真實事件有附來源，不算不合格；指控與民調門檻放嚴到 0.5
    const failAt = r.news && rule.key === 'states_real_event' ? 2 : r.news && NEWS_RULES.includes(rule) ? 0.5 : FAIL_AT;
    if (v >= failAt) fails.push({ id: r.id, name: r.card.name, rule: rule.label, p: v });
    else if (v >= REVIEW_AT) reviews.push({ id: r.id, name: r.card.name, rule: rule.label, p: v });
  }
  const b = r.scores.pokes_blue * r.scores.harshness;
  const g = r.scores.pokes_green * r.scores.harshness;
  blue += b; green += g;
  contrib.push({ id: r.id, name: r.card.name, blue: b, green: g });
}
const imbalance = Math.abs(blue - green) / Math.max(blue, green, 0.01);
const fmt = (x) => x.toFixed(2);

const lines = [];
lines.push(`# 內容檢查報告（${new Date().toISOString()}，${JEV_MODEL}）`, '');
lines.push(`檢查 ${items.length} 張卡與大絕招；呼叫失敗 ${failedCalls} 張。`, '');
lines.push('## 合規', '');
if (!fails.length && !reviews.length) lines.push('全部通過。');
for (const f of fails) lines.push(`- ❌ 不合格｜${f.name}（${f.id}）｜${f.rule}｜${fmt(f.p)}`);
for (const f of reviews) lines.push(`- ⚠️ 請人工確認｜${f.name}（${f.id}）｜${f.rule}｜${fmt(f.p)}`);
lines.push('', '## 嘲諷對稱', '');
lines.push(`- 藍營被酸總量：${fmt(blue)}`, `- 綠營被酸總量：${fmt(green)}`, `- 差距：${(imbalance * 100).toFixed(0)}%（容許 ${SYMMETRY_TOLERANCE * 100}%）${imbalance > SYMMETRY_TOLERANCE ? ' ⚠️ 不對稱' : ' ✅'}`);
lines.push('', '酸度最高的卡（酸度＝酸到該陣營的機率 × 嚴厲程度 0–3）：');
for (const c of contrib.sort((a, b) => Math.max(b.blue, b.green) - Math.max(a.blue, a.green)).slice(0, 8)) {
  lines.push(`- ${c.name}（${c.id}）：酸藍 ${fmt(c.blue)}／酸綠 ${fmt(c.green)}`);
}
if (failedCalls) lines.push('', `⚠️ 有 ${failedCalls} 張沒有檢查到（Jev 呼叫失敗），結果不完整：`, ...results.filter((r) => r.error).map((r) => `- ${r.id}：${r.error}`));
const report = lines.join('\n');
console.log(report);
writeFileSync(new URL('./content_report.md', import.meta.url), `${report}\n`);
writeFileSync(new URL('./content_scores.json', import.meta.url), JSON.stringify(results, null, 2));

if (failedCalls) console.log(`::warning::內容檢查有 ${failedCalls} 張沒有檢查到（Jev 呼叫失敗）`);
if (imbalance > SYMMETRY_TOLERANCE) console.log(`::warning::嘲諷不對稱：藍 ${fmt(blue)}／綠 ${fmt(green)}`);
if (fails.length && !REPORT_ONLY) {
  console.log(`::error::內容檢查不合格 ${fails.length} 項，停止部署`);
  process.exit(1);
}
