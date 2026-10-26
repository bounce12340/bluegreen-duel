// 卡池資料。所有文字為原創的競選行為描寫，不引用、不捏造當事人發言。
// 停用某張卡：把 id 加進 config.js 的 disabledCards，不需改這裡。
// 雙方卡牌一一對應（同費用、同強度），只是名稱與風味文字不同。

export const RARITY_WEIGHT = { common: 60, rare: 30, epic: 10 };

export const CARDS = [
  // ── 共用卡池 ─────────────────────────────
  { id: 's_street', side: 'shared', type: 'attack', cost: 1, rarity: 'common', name: '掃街拜票',
    text: '拉 4 人', fx: { pull: 4 }, flavor: '一條街，一百次握手。' },
  { id: 's_market', side: 'shared', type: 'attack', cost: 2, rarity: 'common', name: '菜市場握手',
    text: '拉 7 人', fx: { pull: 7 }, flavor: '攤販阿姨的眼神最誠實。' },
  { id: 's_forum', side: 'shared', type: 'attack', cost: 3, rarity: 'rare', name: '政見發表會',
    text: '拉 9 人', fx: { pull: 9 }, flavor: '三分鐘，講完四年。' },
  { id: 's_buzz', side: 'shared', type: 'magic', cost: 1, rarity: 'common', name: '網路聲量衝高',
    text: '聲量 +25（不佔回合）', fx: { voice: 25 }, flavor: '留言區比你還早醒。' },
  { id: 's_staff', side: 'shared', type: 'magic', cost: 1, rarity: 'common', name: '幕僚加班',
    text: '抽 2 張（不佔回合）', fx: { draw: 2 }, flavor: '便當已經冷了。' },
  { id: 's_early', short: '行程點 +2（不佔回合）', side: 'shared', type: 'magic', cost: 0, rarity: 'rare', name: '早起跑行程',
    text: '行程點 +2（不佔回合）', fx: { ap: 2 }, flavor: '五點半的公園最熱鬧。' },
  { id: 's_flip', short: '蓋牌：對方下次拉票，一半跑回中間', side: 'shared', type: 'trap', cost: 2, rarity: 'rare', name: '跑票',
    text: '蓋牌。對方下一次拉票，一半的人走回中間', fx: { trap: 'flip' }, flavor: '說好的呢？' },
  { id: 's_rain', short: '蓋牌：對方晚會中止，或行程點 -1', side: 'shared', type: 'trap', cost: 1, rarity: 'common', name: '下雨了',
    text: '蓋牌。對方下回合開始時：造勢晚會立即結束；沒有晚會則行程點 -1', fx: { trap: 'rain' }, flavor: '雨衣發完了。' },
  { id: 's_expose', short: '翻開對方陷阱，1 回合不能蓋牌宣告', side: 'shared', type: 'status', cost: 2, rarity: 'rare', name: '被起底',
    text: '對方「被起底」1 回合：已蓋的陷阱全部翻開，且不能蓋牌宣告', fx: { applyStatus: { id: 'exposed', turns: 1 } }, flavor: '十年前的留言也翻得出來。' },
  { id: 's_gaffe', short: '對方 1 回合不能放絕招', side: 'shared', type: 'status', cost: 2, rarity: 'rare', name: '失言警報',
    text: '對方「失言」1 回合：不能發動絕招', fx: { applyStatus: { id: 'gaffe', turns: 1 } }, flavor: '麥克風沒關。' },

  // ── 綠方 ─────────────────────────────
  { id: 'g_flash', side: 'green', type: 'attack', cost: 2, rarity: 'common', name: '青鳥快閃',
    text: '拉 5 人，聲量 +10', fx: { pull: 5, voice: 10 }, flavor: '五分鐘集合，五分鐘解散。' },
  { id: 'g_question', short: '對方下 2 張卡各 +1 費', side: 'green', type: 'status', cost: 1, rarity: 'common', name: '伯洋式追問',
    text: '對方接下來 2 張卡各多花 1 行程點', fx: { applyStatus: { id: 'question', turns: 2 } }, flavor: '請問，第三點呢？' },
  { id: 'g_encircle', short: '對方 2 回合，每回合 -2 人', side: 'green', type: 'status', cost: 3, rarity: 'rare', name: '青鳥包圍',
    text: '對方 2 回合內，每回合被拉走 2 人', fx: { applyStatus: { id: 'encircle', turns: 2 } }, flavor: '嘰嘰喳喳，從四面八方。' },
  { id: 'g_folder', side: 'green', type: 'attack', cost: 3, rarity: 'rare', name: '資料夾滿滿',
    text: '從對方挖 5 人', fx: { poach: 5 }, flavor: '附件一共四十七頁。' },
  { id: 'g_volunteer', short: '3 回合，每回合 +3 人', side: 'green', type: 'summon', cost: 4, rarity: 'rare', name: '志工大集合',
    text: '3 回合內，每回合自動拉 3 人', fx: { summon: { perTurn: 3, turns: 3, name: '志工團' } }, flavor: '背心一穿就出門。' },
  { id: 'g_youth', short: '2 回合，每回合 +3 人', side: 'green', type: 'summon', cost: 2, rarity: 'common', name: '青年軍上線',
    text: '2 回合內，每回合自動拉 3 人', fx: { summon: { perTurn: 3, turns: 2, name: '青年軍' } }, flavor: '限動已發。' },
  { id: 'g_rally', short: '2 回合，每回合額外 +3 人', side: 'green', type: 'field', cost: 4, rarity: 'epic', name: '造勢晚會',
    text: '場地：2 回合內，每回合額外拉 3 人', fx: { field: 'rally' }, flavor: '燈一亮，全場站起來。' },
  { id: 'g_speech', side: 'green', type: 'attack', cost: 5, rarity: 'epic', name: '熱血演講',
    text: '拉 14 人', fx: { pull: 14 }, flavor: '喉嚨啞了，聲量沒啞。' },

  // ── 藍方 ─────────────────────────────
  { id: 'b_news', side: 'blue', type: 'attack', cost: 2, rarity: 'common', name: '市政快報',
    text: '拉 5 人，聲量 +10', fx: { pull: 5, voice: 10 }, flavor: '圖卡已排版完成。' },
  { id: 'b_dodge', short: '對方下張攻擊 50% 打歪', side: 'blue', type: 'status', cost: 1, rarity: 'common', name: '問A答B',
    text: '對方下一張攻擊卡 50% 機率打歪', fx: { applyStatus: { id: 'deflect', turns: 2 } }, flavor: '這個問題問得很好，我們來談談另一件事。' },
  { id: 'b_encircle', short: '對方 2 回合，每回合 -2 人', side: 'blue', type: 'status', cost: 3, rarity: 'rare', name: '市政團隊圍堵',
    text: '對方 2 回合內，每回合被拉走 2 人', fx: { applyStatus: { id: 'encircle', turns: 2 } }, flavor: '工程帽小人，請就位。' },
  { id: 'b_briefing', side: 'blue', type: 'attack', cost: 3, rarity: 'rare', name: '施政簡報',
    text: '從對方挖 5 人', fx: { poach: 5 }, flavor: '投影片第一百零三張。' },
  { id: 'b_service', short: '3 回合，每回合 +3 人', side: 'blue', type: 'summon', cost: 4, rarity: 'rare', name: '里民服務隊',
    text: '3 回合內，每回合自動拉 3 人', fx: { summon: { perTurn: 3, turns: 3, name: '服務隊' } }, flavor: '路燈壞了？馬上到。' },
  { id: 'b_editor', short: '2 回合，每回合 +3 人', side: 'blue', type: 'summon', cost: 2, rarity: 'common', name: '小編上線',
    text: '2 回合內，每回合自動拉 3 人', fx: { summon: { perTurn: 3, turns: 2, name: '小編團' } }, flavor: '梗圖三分鐘出爐。' },
  { id: 'b_rally', short: '2 回合，每回合額外 +3 人', side: 'blue', type: 'field', cost: 4, rarity: 'epic', name: '造勢晚會',
    text: '場地：2 回合內，每回合額外拉 3 人', fx: { field: 'rally' }, flavor: '燈一亮，全場站起來。' },
  { id: 'b_vision', side: 'blue', type: 'attack', cost: 5, rarity: 'epic', name: '願景發表',
    text: '拉 14 人', fx: { pull: 14 }, flavor: '藍圖展開，比桌子還大。' },
];

// 大絕招：聲量爆表時擇一發動，每招每局 1 次。
export const ULTS = {
  green: [
    { id: 'u_shield', name: '抗中保台', text: '本回合拉票 ×2，並淨化自己 1 個負面狀態' },
    { id: 'u_birds', name: '召喚青鳥', text: '青鳥群停留 3 回合，每回合自動拉 3 人' },
    { id: 'u_swap', name: '改變人設', text: '雙方所有狀態互換，並依回合數額外拉人（第 6 回合後）', minRound: 6 },
  ],
  blue: [
    { id: 'u_reflect', name: '問A答B・大反射', text: '對方下一張攻擊卡轉向，效果改由對方承受' },
    { id: 'u_team', name: '召喚市政團隊', text: '市政團隊停留 3 回合，每回合自動拉 3 人' },
    { id: 'u_report', name: '市政成績單', text: '清除對方所有增益，並依回合數額外拉人（第 6 回合後）', minRound: 6 },
  ],
};

export const STATUS_INFO = {
  encircle: { name: '被包圍', bad: true, icon: '🌀' },
  question: { name: '被追問', bad: true, icon: '❓' },
  deflect: { name: '頭暈轉圈', bad: true, icon: '💫' },
  gaffe: { name: '失言', bad: true, icon: '🤐' },
  exposed: { name: '被起底', bad: true, icon: '🔍' },
  sympathy: { name: '同情票', bad: false, icon: '🥺' },
  burst: { name: '聲量爆表', bad: false, icon: '🔥' },
  ultBoost: { name: '拉票加倍', bad: false, icon: '🛡️' },
  reflect: { name: '反射待命', bad: false, icon: '🔀' },
};

export const SIDE_NAME = { blue: '萬安號', green: '伯洋號' };
export const SIDE_FULL = { blue: '蔣萬安', green: '沈伯洋' };
