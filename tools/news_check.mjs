// 時事卡格式檢查（不需要 Jev，部署前一定會跑）。有任何問題就停止部署。
// 檢查：id、日期（11/27 前下架）、資料來源、藍綠成對（同費用同效果）、插圖檔案
import { existsSync } from 'node:fs';
import { CARDS } from '../site/js/cards.js';
import { NEWS_CARDS, NEWS_LAST_DAY } from '../site/js/news_cards.js';

const errs = [];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ids = new Set(CARDS.map((c) => c.id));
const byId = Object.fromEntries(NEWS_CARDS.map((c) => [c.id, c]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const c of NEWS_CARDS) {
  const e = (m) => errs.push(`${c.id || '（沒有 id）'}：${m}`);
  if (!/^n_[a-z0-9_]+$/.test(c.id || '')) e('id 要用 n_ 開頭的小寫英數');
  if (ids.has(c.id)) e('id 重複'); ids.add(c.id);
  if (!['blue', 'green', 'shared'].includes(c.side)) e('side 只能是 blue／green／shared');
  if (!c.name || !c.text || !c.flavor || !c.fx || typeof c.cost !== 'number') e('缺少 name／text／flavor／fx／cost');
  if (!DATE.test(c.from || '') || !DATE.test(c.until || '')) e('from／until 要寫成 YYYY-MM-DD');
  else {
    if (c.from > c.until) e('上架日晚於下架日');
    if (c.until > NEWS_LAST_DAY) e(`下架日不能晚於 ${NEWS_LAST_DAY}（投票日前一天）`);
  }
  if (!Array.isArray(c.sources) || !c.sources.length || c.sources.some((u) => !/^https:\/\//.test(u))) e('至少要附一個 https 資料來源');
  if (c.art !== 'news' && !existsSync(new URL(`../site/assets/cards/${c.art}.webp`, import.meta.url))) e(`找不到插圖 site/assets/cards/${c.art}.webp`);
  if (c.side !== 'shared') {
    const p = byId[c.pair];
    if (!p) e('藍綠卡要用 pair 指向另一邊的對應卡');
    else if (p.side === c.side || p.pair !== c.id) e('pair 要指向「另一邊」而且互相指向');
    else if (p.type !== c.type || p.cost !== c.cost || p.rarity !== c.rarity || !same(p.fx, c.fx)) e('和對應卡的類型、費用、稀有度或效果不同（藍綠要對稱）');
    else if (p.from !== c.from || p.until !== c.until) e('和對應卡的上下架日期不同');
  }
}
console.log(`時事卡 ${NEWS_CARDS.length} 張，問題 ${errs.length} 項`);
for (const m of errs) console.log(`::error::${m}`);
process.exit(errs.length ? 1 : 0);
