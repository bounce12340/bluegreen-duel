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

  // ── 2026-10-28 上架（10/29 起）。內容經作者核准；事實出處見 sources ──
  // 共用：首場電視辯論（10/31 中午，TVBS 攝影棚，TVBS 與三立共同主辦）
  { id: 'n_debate_lunch', side: 'shared', type: 'magic', cost: 1, rarity: 'common',
    name: '午間辯論', text: '聲量 +25（不佔回合）', fx: { voice: 25 }, flavor: '中午12點開打 剛好配便當看', tone: 'push',
    from: '2026-10-29', until: '2026-11-14',
    sources: ['https://focustaiwan.tw/politics/202610150028', 'https://news.ltn.com.tw/news/politics/breakingnews/5607610'],
    topic: '北市長首場電視辯論訂 10/31 中午舉行',
    en: { name: 'Lunchtime Debate', text: 'Voice +25 (free action)', flavor: 'Debate kicks off at noon — perfect with a bento.' } },
  // 共用：薔琵颱風，台北 10/23 停班停課，雙方都暫停拜票行程
  { id: 'n_typhoon_qiangpi', side: 'shared', type: 'trap', cost: 1, rarity: 'common',
    name: '薔琵颱風假', short: '蓋牌：對方晚會中止，或行程點 -1',
    text: '蓋牌。對方下回合開始時：造勢晚會立即結束；沒有晚會則行程點 -1', fx: { trap: 'rain' },
    flavor: '颱風假 掃街全暫停 先顧好家裡再說', tone: 'arrow',
    from: '2026-10-29', until: '2026-11-13',
    sources: ['https://news.ltn.com.tw/news/life/breakingnews/5615834', 'https://news.ltn.com.tw/news/politics/paper/1775850', 'https://news.ltn.com.tw/news/politics/breakingnews/5615672'],
    topic: '颱風薔琵來襲，台北 10/23 停班停課，雙方暫停拜票',
    en: { name: 'Typhoon Day Off', text: 'Set face down. At the start of your opponent\'s next turn: their rally ends at once; if there\'s no rally, they lose 1 AP', flavor: 'Typhoon day — campaigning\'s on pause, stay safe first.' } },
  // 都更政策交鋒
  { id: 'n_renewal_half', pair: 'n_renewal_exit', side: 'blue', type: 'attack', cost: 3, rarity: 'rare',
    name: '都更門檻減半', text: '拉 8 人', fx: { pull: 8 }, flavor: '老公寓住戶：這次終於輪到我們了嗎', tone: 'push',
    from: '2026-10-29', until: '2026-11-27',
    sources: ['https://focustaiwan.tw/politics/202610160018', 'https://money.udn.com/money/story/5621/9823097'],
    topic: '蔣萬安提公辦都更初期門檻 75% 降至 50%',
    en: { name: 'Renewal Bar Halved', text: 'Win 8 voters', flavor: 'Old-walkup residents: is it finally our turn?' } },
  { id: 'n_renewal_exit', pair: 'n_renewal_half', side: 'green', type: 'attack', cost: 3, rarity: 'rare',
    name: '入口寬出口窄', text: '拉 8 人', fx: { pull: 8 }, flavor: '掛號變好掛 但看診還是要排隊吧', tone: 'arrow',
    from: '2026-10-29', until: '2026-11-27',
    sources: ['https://newtalk.tw/news/view/2026-10-20/1066529', 'https://money.udn.com/money/story/5621/9823097'],
    topic: '沈伯洋批都更「入口寬出口窄」，主張打通後段瓶頸',
    en: { name: 'Wide In, Narrow Out', text: 'Win 8 voters', flavor: 'Easier to register, still a long wait to see the doctor.' } },
  // 競選總部開張
  { id: 'n_hq_encore', pair: 'n_hq_livingroom', side: 'blue', type: 'summon', cost: 4, rarity: 'rare',
    name: '八年級競辦', short: '3 回合，每回合 +3 人', text: '3 回合內，每回合自動拉 3 人', fx: { summon: { perTurn: 3, turns: 3, name: '競辦小隊' } },
    flavor: '競辦平均30歲 簡報跟梗圖應該都很強', tone: 'push',
    from: '2026-10-29', until: '2026-11-27',
    sources: ['https://www.mirrormedia.mg/external/setn_1914573'],
    topic: '蔣萬安競辦成立，核心團隊平均約 30 歲',
    en: { name: 'Gen-80s Campaign Office', text: 'For 3 turns, win 3 voters each turn', flavor: 'Avg age 30 — slides and memes must be top-tier.' } },
  { id: 'n_hq_livingroom', pair: 'n_hq_encore', side: 'green', type: 'summon', cost: 4, rarity: 'rare',
    name: '台北的客廳', short: '3 回合，每回合 +3 人', text: '3 回合內，每回合自動拉 3 人', fx: { summon: { perTurn: 3, turns: 3, name: '競辦小隊' } },
    flavor: '競總有人工草皮還有陀螺 週末帶小孩去', tone: 'push',
    from: '2026-10-29', until: '2026-11-27',
    sources: ['https://focustaiwan.tw/politics/202610040012', 'https://www.nownews.com/news/6879240'],
    topic: '沈伯洋競總以「台北的客廳」設計，擺出陀螺收藏',
    en: { name: 'Taipei\'s Living Room', text: 'For 3 turns, win 3 voters each turn', flavor: 'Fake grass and spinning tops at HQ? Bringing the kids this weekend.' } },
  // 競選周邊話題
  { id: 'n_merch_homerun', pair: 'n_merch_scarf', side: 'blue', type: 'magic', cost: 1, rarity: 'common',
    name: '全壘打周邊組', text: '聲量 +25（不佔回合）', fx: { voice: 25 }, flavor: '88888那組 是要買給整個里用嗎', tone: 'arrow',
    from: '2026-10-29', until: '2026-11-27',
    sources: ['https://www.mirrormedia.mg/external/setn_1914573'],
    topic: '蔣萬安陣營推「台北安可」周邊，最高一組 NT$88,888',
    en: { name: 'Home-Run Merch Set', text: 'Voice +25 (free action)', flavor: 'The NT$88,888 bundle — buying for the whole neighborhood?' } },
  { id: 'n_merch_scarf', pair: 'n_merch_homerun', side: 'green', type: 'magic', cost: 1, rarity: 'common',
    name: '洋流絲巾', text: '聲量 +25（不佔回合）', fx: { voice: 25 }, flavor: '顏色撞到競選色 衣櫃翻出來就算應援', tone: 'push',
    from: '2026-10-29', until: '2026-11-27',
    sources: ['https://www.mirrormedia.mg/story/20261013hea06'],
    topic: '網友以撞色絲巾應援沈伯洋，掀起代購潮',
    en: { name: 'Ocean-Current Scarf', text: 'Voice +25 (free action)', flavor: 'Matches the campaign color — closet find counts as fan gear.' } },
  // 主打政見
  { id: 'n_childcare_45', pair: 'n_policy_island', side: 'blue', type: 'attack', cost: 2, rarity: 'common',
    name: '托嬰4變45', text: '拉 5 人，聲量 +10', fx: { pull: 5, voice: 10 }, flavor: '4變45？爸媽快查離家最近是哪間', tone: 'arrow',
    from: '2026-10-29', until: '2026-11-27',
    sources: ['https://focustaiwan.tw/politics/202610180010'],
    topic: '蔣萬安細數政績：公共托嬰中心由 4 處增至 45 處（陣營公布的數字）',
    en: { name: 'Daycare 4→45', text: 'Win 5 voters, Voice +10', flavor: '4 to 45? Parents, go find the nearest one.' } },
  { id: 'n_policy_island', pair: 'n_childcare_45', side: 'green', type: 'attack', cost: 2, rarity: 'common',
    name: '心政策島', text: '拉 5 人，聲量 +10', fx: { pull: 5, voice: 10 }, flavor: '逛政見像在玩動森 還能找隱藏公仔', tone: 'push',
    from: '2026-10-29', until: '2026-11-27',
    sources: ['https://news.ltn.com.tw/news/politics/breakingnews/5615672', 'https://news.ltn.com.tw/news/focus/breakingnews/5617731'],
    topic: '沈伯洋推遊戲化政見網站「HEART 政策島」，14 主題 94 項政見',
    en: { name: 'Heart Policy Island', text: 'Win 5 voters, Voice +10', flavor: 'Browsing policies like Animal Crossing, with hidden figurines.' } },
  // 城市大構想：松山機場遷建 vs 市民大道南北縫合（兩案都引發各方討論，卡面只描述構想本身）
  { id: 'n_airport_ai', pair: 'n_civic_stitch', side: 'blue', type: 'attack', cost: 3, rarity: 'rare',
    name: '松機變AI園區', text: '拉 7 人，聲量 +10', fx: { pull: 7, voice: 10 }, flavor: '飛機搬走那天 松山的天空會不會太安靜', tone: 'push',
    from: '2026-10-29', until: '2026-11-27',
    sources: ['https://news.pts.org.tw/article/831340'],
    topic: '蔣萬安 10/8 提出遷移松山機場，原址與周邊約 300 公頃打造「台北 AI 園區」',
    en: { name: 'Airport to AI Park', text: 'Win 7 voters, Voice +10', flavor: 'The day the planes move out — will the Songshan sky be too quiet?' } },
  { id: 'n_civic_stitch', pair: 'n_airport_ai', side: 'green', type: 'attack', cost: 3, rarity: 'rare',
    name: '市民大道南北縫合', text: '拉 7 人，聲量 +10', fx: { pull: 7, voice: 10 }, flavor: '高架橋下變廊道 先幫我留一個攤位', tone: 'push',
    from: '2026-10-29', until: '2026-11-27',
    sources: ['https://udn.com/news/story/124652/9839703', 'https://tw.news.yahoo.com/%E6%9F%AF%E6%96%87%E5%93%B2%E5%A4%A7%E7%BF%BB%E8%BB%8A-%E7%A8%B1%E5%B8%82%E6%B0%91%E5%A4%A7%E9%81%93%E7%B8%AB%E5%90%88%E8%81%BD%E4%B8%8D%E6%87%82-%E6%B2%88%E4%BC%AF%E6%B4%8B%E5%BC%95%E6%9F%AF%E5%B8%82%E5%BA%9C%E8%A8%88%E7%95%AB%E7%8B%A0%E6%89%93%E8%87%89-053632944.html'],
    topic: '沈伯洋提城市廊道構想：市民大道高架橋下空間活化，讓南北兩側重新「縫合」',
    en: { name: 'Stitch the Boulevard', text: 'Win 7 voters, Voice +10', flavor: 'Turning the space under the overpass into a corridor? Save me a stall.' } },
  // 候選人的興趣圈：動漫與棒球（作者指定加入動漫梗，藍營配球迷梗成對）
  { id: 'n_baseball_fan', pair: 'n_otaku_hq', side: 'blue', type: 'attack', cost: 2, rarity: 'common',
    name: '資深球迷', text: '拉 4 人，聲量 +15', fx: { pull: 4, voice: 15 }, flavor: '封王貼文發得比球團小編還快', tone: 'arrow',
    from: '2026-10-29', until: '2026-11-27',
    sources: ['https://news.tvbs.com.tw/politics/4041583', 'https://news.nextapple.com/politics/20261026/3725C1469E6A0EF9411BD6A97461D7C7'],
    topic: '自稱資深球迷的蔣萬安，在台灣大賽於大巨蛋封王後第一時間發文祝賀',
    en: { name: 'Veteran Fan', text: 'Win 4 voters, Voice +15', flavor: 'Posted the title congrats faster than the team\'s own social media.' } },
  { id: 'n_otaku_hq', pair: 'n_baseball_fan', side: 'green', type: 'attack', cost: 2, rarity: 'common',
    name: '二次元競總', text: '拉 4 人，聲量 +15', fx: { pull: 4, voice: 15 }, flavor: '競總逛起來比動漫店還好逛', tone: 'push',
    from: '2026-10-29', until: '2026-11-27',
    sources: ['https://www.setn.com/news/1914958', 'https://news.ltn.com.tw/news/politics/breakingnews/5553130', 'https://www.businesstoday.com.tw/article/category/183027/post/202610040012/'],
    topic: '沈伯洋競總擺滿動漫周邊與模型，募款方案用 3939 致敬虛擬歌手，演講引用漫畫台詞',
    en: { name: 'Otaku HQ', text: 'Win 4 voters, Voice +15', flavor: 'The HQ is more fun to browse than an anime shop.' } },
];

// 沒有專屬插圖的時事卡用通用的「快訊」圖
for (const c of NEWS_CARDS) { c.news = true; if (!c.art) c.art = 'news'; }

// 今天（YYYY-MM-DD，台北時間）上架中的時事卡 id；today 傳 'all' 時回傳全部（平衡模擬用）
export function activeNewsIds(today) {
  if (today === 'all') return NEWS_CARDS.map((c) => c.id);
  if (!today) return [];
  return NEWS_CARDS.filter((c) => c.from <= today && today <= c.until && today <= NEWS_LAST_DAY).map((c) => c.id);
}
