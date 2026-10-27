// 卡池資料。所有文字為原創的競選行為描寫，不引用、不捏造當事人發言。
// 卡牌台詞（flavor）是匿名網友留言：tone = push（推）／boo（噓）／arrow（→）為鄉民推文，threads 為脆文；不代表任何真實人物。
// 停用某張卡：把 id 加進 config.js 的 disabledCards，不需改這裡。
// 雙方卡牌一一對應（同費用、同強度），只是名稱與風味文字不同。

export const RARITY_WEIGHT = { common: 60, rare: 30, epic: 10 };

export const CARDS = [
  // ── 共用卡池 ─────────────────────────────
  { id: 's_street', side: 'shared', type: 'attack', cost: 1, rarity: 'common', name: '掃街拜票',
    text: '拉 4 人', fx: { pull: 4 }, flavor: '一條街走完，手比腳還痠 XD', tone: 'push' },
  { id: 's_market', side: 'shared', type: 'attack', cost: 2, rarity: 'common', name: '菜市場握手',
    text: '拉 7 人', fx: { pull: 7 }, flavor: '菜市場阿姨握完手還塞我一把蔥🥬 這就是台北人情味吧', tone: 'threads' },
  { id: 's_forum', side: 'shared', type: 'attack', cost: 3, rarity: 'rare', name: '政見發表會',
    text: '拉 9 人', fx: { pull: 9 }, flavor: '三分鐘講完四年，這節奏我跟不上', tone: 'arrow' },
  { id: 's_buzz', side: 'shared', type: 'magic', cost: 1, rarity: 'common', name: '網路聲量衝高',
    text: '聲量 +25（不佔回合）', fx: { voice: 25 }, flavor: '被演算法推到這篇 先+1再說🤣', tone: 'threads' },
  { id: 's_staff', side: 'shared', type: 'magic', cost: 1, rarity: 'common', name: '幕僚加班',
    text: '抽 2 張（不佔回合）', fx: { draw: 2 }, flavor: '幕僚的便當到底什麼時候會是熱的🫠', tone: 'threads' },
  { id: 's_early', short: '行程點 +2（不佔回合）', side: 'shared', type: 'magic', cost: 0, rarity: 'rare', name: '早起跑行程',
    text: '行程點 +2（不佔回合）', fx: { ap: 2 }, flavor: '早上五點半的公園比夜市還擠 誰懂😭', tone: 'threads' },
  { id: 's_flip', short: '蓋牌：對方下次拉票，一半跑回中間', side: 'shared', type: 'trap', cost: 2, rarity: 'rare', name: '跑票',
    text: '蓋牌。對方下一次拉票，一半的人走回中間', fx: { trap: 'flip' }, flavor: '說好的呢？是在哈囉', tone: 'boo' },
  { id: 's_rain', short: '蓋牌：對方晚會中止，或行程點 -1', side: 'shared', type: 'trap', cost: 1, rarity: 'common', name: '下雨了',
    text: '蓋牌。對方下回合開始時：造勢晚會立即結束；沒有晚會則行程點 -1', fx: { trap: 'rain' }, flavor: '雨衣發完了 但大家都沒走 有被感動到🥹', tone: 'threads' },
  { id: 's_expose', short: '翻開對方陷阱，1 回合不能蓋牌宣告', side: 'shared', type: 'status', cost: 2, rarity: 'rare', name: '被起底',
    text: '對方「被起底」1 回合：已蓋的陷阱全部翻開，且不能蓋牌宣告', fx: { applyStatus: { id: 'exposed', turns: 1 } }, flavor: '鄉民辦案，十年前的留言都挖出來了', tone: 'push' },
  { id: 's_gaffe', short: '對方 1 回合不能放絕招', side: 'shared', type: 'status', cost: 2, rarity: 'rare', name: '失言警報',
    text: '對方「失言」1 回合：不能發動絕招', fx: { applyStatus: { id: 'gaffe', turns: 1 } }, flavor: '麥克風沒關，已截圖存證', tone: 'push' },

  // ── 綠方 ─────────────────────────────
  { id: 'g_flash', side: 'green', type: 'attack', cost: 2, rarity: 'common', name: '青鳥快閃',
    text: '拉 5 人，聲量 +10', fx: { pull: 5, voice: 10 }, flavor: '五分鐘集合五分鐘解散，效率滿分', tone: 'push' },
  { id: 'g_question', short: '對方下 2 張卡各 +1 費', side: 'green', type: 'status', cost: 1, rarity: 'common', name: '伯洋式追問',
    text: '對方接下來 2 張卡各多花 1 行程點', fx: { applyStatus: { id: 'question', turns: 2 } }, flavor: '追問一路追到第三點，記者筆都沒水了', tone: 'push' },
  { id: 'g_encircle', short: '對方 2 回合，每回合 -2 人', side: 'green', type: 'status', cost: 3, rarity: 'rare', name: '青鳥包圍',
    text: '對方 2 回合內，每回合被拉走 2 人', fx: { applyStatus: { id: 'encircle', turns: 2 } }, flavor: '嘰嘰喳喳，耳朵已經不是我的了', tone: 'arrow' },
  { id: 'g_folder', side: 'green', type: 'attack', cost: 3, rarity: 'rare', name: '資料夾滿滿',
    text: '從對方挖 5 人', fx: { poach: 5 }, flavor: '附件四十七頁，有圖有真相', tone: 'push' },
  { id: 'g_volunteer', short: '3 回合，每回合 +3 人', side: 'green', type: 'summon', cost: 4, rarity: 'rare', name: '志工大集合',
    text: '3 回合內，每回合自動拉 3 人', fx: { summon: { perTurn: 3, turns: 3, name: '志工團' } }, flavor: '志工阿伯的背心比我還有精神 真心不騙💪', tone: 'threads' },
  { id: 'g_youth', short: '2 回合，每回合 +3 人', side: 'green', type: 'summon', cost: 2, rarity: 'common', name: '青年軍上線',
    text: '2 回合內，每回合自動拉 3 人', fx: { summon: { perTurn: 3, turns: 2, name: '青年軍' } }, flavor: '限動發完了 大家幫轉一下🙏', tone: 'threads' },
  { id: 'g_rally', short: '2 回合，每回合額外 +3 人', side: 'green', type: 'field', cost: 4, rarity: 'epic', name: '造勢晚會',
    text: '場地：2 回合內，每回合額外拉 3 人', fx: { field: 'rally' }, flavor: '燈一亮全場站起來 雞皮疙瘩掉滿地😳', tone: 'threads' },
  { id: 'g_speech', side: 'green', type: 'attack', cost: 5, rarity: 'epic', name: '熱血演講',
    text: '拉 14 人', fx: { pull: 14 }, flavor: '麥克風燙了，聲量還在漲', tone: 'push' },

  // ── 藍方 ─────────────────────────────
  { id: 'b_news', side: 'blue', type: 'attack', cost: 2, rarity: 'common', name: '市政快報',
    text: '拉 5 人，聲量 +10', fx: { pull: 5, voice: 10 }, flavor: '圖卡排版好看，先推再看', tone: 'push' },
  { id: 'b_dodge', short: '對方下張攻擊 50% 打歪', side: 'blue', type: 'status', cost: 1, rarity: 'common', name: '問A答B',
    text: '對方下一張攻擊卡 50% 機率打歪', fx: { applyStatus: { id: 'deflect', turns: 2 } }, flavor: '問題往左丟，答案往右飛，認真你就輸了', tone: 'arrow' },
  { id: 'b_encircle', short: '對方 2 回合，每回合 -2 人', side: 'blue', type: 'status', cost: 3, rarity: 'rare', name: '市政團隊圍堵',
    text: '對方 2 回合內，每回合被拉走 2 人', fx: { applyStatus: { id: 'encircle', turns: 2 } }, flavor: '工程帽一字排開，路都繞不過去', tone: 'arrow' },
  { id: 'b_briefing', side: 'blue', type: 'attack', cost: 3, rarity: 'rare', name: '施政簡報',
    text: '從對方挖 5 人', fx: { poach: 5 }, flavor: '投影片第一百零三張，有圖有真相', tone: 'push' },
  { id: 'b_service', short: '3 回合，每回合 +3 人', side: 'blue', type: 'summon', cost: 4, rarity: 'rare', name: '里民服務隊',
    text: '3 回合內，每回合自動拉 3 人', fx: { summon: { perTurn: 3, turns: 3, name: '服務隊' } }, flavor: '里長伯說路燈修好了 巷口終於有光了✨', tone: 'threads' },
  { id: 'b_editor', short: '2 回合，每回合 +3 人', side: 'blue', type: 'summon', cost: 2, rarity: 'common', name: '小編上線',
    text: '2 回合內，每回合自動拉 3 人', fx: { summon: { perTurn: 3, turns: 2, name: '小編團' } }, flavor: '小編三分鐘出一張梗圖 是不是根本不用睡🤣', tone: 'threads' },
  { id: 'b_rally', short: '2 回合，每回合額外 +3 人', side: 'blue', type: 'field', cost: 4, rarity: 'epic', name: '造勢晚會',
    text: '場地：2 回合內，每回合額外拉 3 人', fx: { field: 'rally' }, flavor: '燈一亮全場站起來 雞皮疙瘩掉滿地😳', tone: 'threads' },
  { id: 'b_vision', side: 'blue', type: 'attack', cost: 5, rarity: 'epic', name: '願景發表',
    text: '拉 14 人', fx: { pull: 14 }, flavor: '藍圖比桌子還大，眼睛要放大', tone: 'push' },
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
