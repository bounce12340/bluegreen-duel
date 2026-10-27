// 時事卡：跟著新聞上架、到期自動下架的卡。新增方式與規則見 docs/時事卡.md。
// 每張都要：上架日 from、下架日 until（含當天，台北時間）、資料來源 sources（https 網址）。
// 藍綠成對：藍卡與綠卡同費用、同稀有度、同效果，用 pair 互相指向；共用卡（shared）不必成對。
// 部署前會自動檢查：tools/news_check.mjs（格式、日期、成對）＋ tools/content_check.mjs（Jev 內容審查）。

// 投票日（11/28）前一天必須全部下架；11/18 起依選罷法不得出現任何民調內容
export const NEWS_LAST_DAY = '2026-11-27';

export const NEWS_CARDS = [
  // 範本（複製後改掉內容；id 一律 n_ 開頭）：
  // { id: 'n_example_b', pair: 'n_example_g', side: 'blue', type: 'attack', cost: 2, rarity: 'common',
  //   name: '卡名', text: '拉 6 人', fx: { pull: 6 }, flavor: '匿名網友留言（不能是真人發言）', tone: 'push',
  //   from: '2026-11-01', until: '2026-11-10', sources: ['https://…'], topic: '這張卡在講哪則新聞',
  //   en: { name: 'Card name', text: 'Win 6 voters', flavor: 'Anonymous netizen comment' } },  // 英文版用；沒填就顯示中文
];

// 沒有專屬插圖的時事卡用通用的「快訊」圖
for (const c of NEWS_CARDS) { c.news = true; if (!c.art) c.art = 'news'; }

// 今天（YYYY-MM-DD，台北時間）上架中的時事卡 id；today 傳 'all' 時回傳全部（平衡模擬用）
export function activeNewsIds(today) {
  if (today === 'all') return NEWS_CARDS.map((c) => c.id);
  if (!today) return [];
  return NEWS_CARDS.filter((c) => c.from <= today && today <= c.until && today <= NEWS_LAST_DAY).map((c) => c.id);
}
