// 中英切換。中文是原文：程式裡直接寫中文句子當鍵值，英文版查下面的對照表；查不到就顯示中文（不會壞掉）。
// 語言判斷順序：網址 ?lang=en|zh → 上次選擇（localStorage bg_lang）→ 瀏覽器語言（只要有中文就用中文）。
// 卡牌、大絕招、狀態的英文在這裡集中管理，載入時直接換掉卡牌物件上的文字（遊戲規則與平衡完全不變）。
import { CARDS, ULTS, STATUS_INFO, SIDE_NAME, SIDE_FULL } from './cards.js';
import { NEWS_CARDS } from './news_cards.js';

function detect() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'zh') { localStorage.setItem('bg_lang', q); return q; }
    const saved = localStorage.getItem('bg_lang');
    if (saved === 'en' || saved === 'zh') return saved;
  } catch { /* 無痕模式讀不到就看瀏覽器 */ }
  // 嵌在台北安可電視台（iframe）裡預設中文；要英文可在嵌入網址加 ?lang=en
  try { if (window.parent !== window) return 'zh'; } catch { return 'zh'; }
  const langs = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
  return langs.some((l) => /^zh/i.test(l || '')) || !langs.length ? 'zh' : 'en';
}
export const LANG = typeof window === 'undefined' ? 'zh' : detect();
export const EN = LANG === 'en';

export function setLang(lang) {
  try { localStorage.setItem('bg_lang', lang); } catch { /* 忽略 */ }
  const u = new URL(location.href);
  u.searchParams.set('lang', lang);
  location.href = u.toString();
}

// ── 卡牌 ───────────────────────────────────
export const CARD_EN = {
  s_street: { name: 'Street Canvassing', text: 'Win 4 voters', flavor: 'Walked the whole street, my hands hurt more than my feet XD' },
  s_market: { name: 'Market Visit', text: 'Win 7 voters', flavor: 'Shook hands with a market auntie and she slipped me a bunch of scallions 🥬 peak Taipei hospitality' },
  s_forum: { name: 'Policy Forum', text: 'Win 9 voters', flavor: 'Four years in three minutes, I can\'t keep up' },
  s_buzz: { name: 'Going Viral', text: 'Hype +25 (free action)', flavor: 'The algorithm served me this, liking it first and reading later 🤣' },
  s_staff: { name: 'Staff Overtime', text: 'Draw 2 (free action)', flavor: 'Will the staff\'s lunchbox ever be hot 🫠' },
  s_early: { name: 'Early Start', text: 'Action points +2 (free action)', short: 'Action points +2 (free action)', flavor: 'The park at 5:30 am is busier than a night market, who gets it 😭' },
  s_flip: { name: 'Defectors', text: 'Trap. The next time your opponent wins voters, half of them walk back to the middle', short: 'Trap: half of their next gain walks back', flavor: 'What happened to the promise? Hello??' },
  s_rain: { name: 'Rain Out', text: 'Trap. At the start of your opponent\'s next turn: their rally ends at once; with no rally, they lose 1 action point', short: 'Trap: ends their rally, or −1 action point', flavor: 'Ran out of raincoats but nobody left. Honestly moved 🥹' },
  s_expose: { name: 'Dug Up', text: 'Opponent is Exposed for 1 turn: their face-down traps are revealed and they can\'t declare', short: 'Reveal their traps; no declaring for 1 turn', flavor: 'Netizen detectives dug up comments from ten years ago' },
  s_gaffe: { name: 'Gaffe Alert', text: 'Opponent has a Gaffe for 1 turn: no special moves', short: 'No special moves for 1 turn', flavor: 'The mic was still on. Screenshotted.' },
  g_flash: { name: 'Bluebird Flash Mob', text: 'Win 5 voters, hype +10', flavor: 'Gather in five, gone in five. Peak efficiency' },
  g_question: { name: 'Puma-Style Follow-Up', text: 'Your opponent\'s next 2 cards each cost 1 more action point', short: 'Their next 2 cards cost +1', flavor: 'The follow-ups went all the way to point three. The reporters\' pens ran dry' },
  g_encircle: { name: 'Bluebird Swarm', text: 'For 2 turns, your opponent loses 2 supporters each turn', short: '−2 supporters per turn for 2 turns', flavor: 'Chirp chirp chirp, my ears aren\'t mine anymore' },
  g_folder: { name: 'Bulging Folders', text: 'Take 5 supporters from your opponent', flavor: 'Attachment: 47 pages. Receipts included.' },
  g_volunteer: { name: 'Volunteer Rally', text: 'For 3 turns, win 3 voters each turn', short: '+3 per turn for 3 turns', flavor: 'The volunteer uncle\'s vest has more energy than me, not even kidding 💪' },
  g_youth: { name: 'Youth Squad Online', text: 'For 2 turns, win 3 voters each turn', short: '+3 per turn for 2 turns', flavor: 'Story\'s up, everyone please share 🙏' },
  g_rally: { name: 'Big Rally', text: 'Venue: for 2 turns, win 3 extra voters each turn', short: '+3 extra per turn for 2 turns', flavor: 'Lights up and the whole crowd stands. Goosebumps everywhere 😳' },
  g_speech: { name: 'Fiery Speech', text: 'Win 14 voters', flavor: 'The mic is overheating and the hype keeps climbing' },
  b_news: { name: 'City Hall Bulletin', text: 'Win 5 voters, hype +10', flavor: 'Nice infographic. Upvote first, read later' },
  b_dodge: { name: 'Answer Another Question', text: 'Your opponent\'s next attack has a 50% chance to miss', short: 'Their next attack: 50% to miss', flavor: 'Question goes left, answer flies right. Take it seriously and you lose' },
  b_encircle: { name: 'City Team Blockade', text: 'For 2 turns, your opponent loses 2 supporters each turn', short: '−2 supporters per turn for 2 turns', flavor: 'Hard hats lined up wall to wall, no way around' },
  b_briefing: { name: 'Policy Slideshow', text: 'Take 5 supporters from your opponent', flavor: 'Slide 103. Receipts included.' },
  b_service: { name: 'Neighborhood Crew', text: 'For 3 turns, win 3 voters each turn', short: '+3 per turn for 3 turns', flavor: 'The borough chief says the streetlight is fixed. Our alley finally has light ✨' },
  b_editor: { name: 'Social Team Online', text: 'For 2 turns, win 3 voters each turn', short: '+3 per turn for 2 turns', flavor: 'The social media team drops a meme every three minutes. Do they even sleep 🤣' },
  b_rally: { name: 'Big Rally', text: 'Venue: for 2 turns, win 3 extra voters each turn', short: '+3 extra per turn for 2 turns', flavor: 'Lights up and the whole crowd stands. Goosebumps everywhere 😳' },
  b_vision: { name: 'Grand Vision Launch', text: 'Win 14 voters', flavor: 'The blueprint is bigger than the table. Zoom in' },
};
// 手機手牌空間很小：英文版手牌上用更短的說明（點開卡牌仍看完整說明）
const HAND_EN = {
  s_buzz: 'Hype +25 · free', s_staff: 'Draw 2 · free', s_early: 'Action pts +2 · free',
  s_flip: 'Trap: half their next gain leaves', s_rain: 'Trap: end their rally or −1 point',
  s_expose: 'Reveal traps; no face-down 1 turn', s_gaffe: 'No special moves 1 turn',
  g_flash: 'Win 5, hype +10', b_news: 'Win 5, hype +10',
  g_question: 'Their next 2 cards cost +1', b_dodge: 'Their next attack: 50% miss',
  g_encircle: 'Them −2/turn, 2 turns', b_encircle: 'Them −2/turn, 2 turns',
  g_folder: 'Take 5 supporters', b_briefing: 'Take 5 supporters',
  g_volunteer: '+3/turn, 3 turns', b_service: '+3/turn, 3 turns',
  g_youth: '+3/turn, 2 turns', b_editor: '+3/turn, 2 turns',
  g_rally: 'Extra +3/turn, 2 turns', b_rally: 'Extra +3/turn, 2 turns',
};

export const ULT_EN = {
  u_shield: { name: 'Resist China, Protect Taiwan', text: 'Double voter gains this turn, and clear 1 of your negative statuses' },
  u_birds: { name: 'Summon the Bluebirds', text: 'A bluebird flock stays for 3 turns, winning 3 voters each turn' },
  u_swap: { name: 'Image Makeover', text: 'Swap all statuses between both sides, and win extra voters based on the round (from round 6)' },
  u_reflect: { name: 'Grand Deflection', text: 'Your opponent\'s next attack bounces back at them' },
  u_team: { name: 'Summon the City Team', text: 'The city team stays for 3 turns, winning 3 voters each turn' },
  u_report: { name: 'City Report Card', text: 'Clear all your opponent\'s buffs, and win extra voters based on the round (from round 6)' },
};
const STATUS_EN = {
  encircle: 'Surrounded', question: 'Grilled', deflect: 'Dizzy', gaffe: 'Gaffe', exposed: 'Exposed',
  sympathy: 'Sympathy vote', burst: 'Hype burst', ultBoost: 'Double gains', reflect: 'Deflect ready',
};
const SUMMON_EN = { 志工團: 'Volunteers', 青年軍: 'Youth Squad', 服務隊: 'Service Crew', 小編團: 'Social Team', 青鳥群: 'Bluebird Flock', 市政團隊: 'City Team' };

// 中文卡名 → 英文卡名（伺服器送來的事件裡是中文名，連線時用這個換）
// 時事卡在 news_cards.js 裡自帶英文：en: { name, text, flavor }
for (const c of NEWS_CARDS) if (c.en && c.en.name) CARD_EN[c.id] = c.en;
const NAME_ZH_TO_EN = {};
for (const c of [...CARDS, ...NEWS_CARDS]) if (CARD_EN[c.id]) NAME_ZH_TO_EN[c.name] = CARD_EN[c.id].name;
for (const list of Object.values(ULTS)) for (const u of list) if (ULT_EN[u.id]) NAME_ZH_TO_EN[u.name] = ULT_EN[u.id].name;
Object.assign(NAME_ZH_TO_EN, SUMMON_EN);
export const nameEN = (zh) => (EN ? NAME_ZH_TO_EN[zh] || zh : zh);

if (EN) {
  for (const c of [...CARDS, ...NEWS_CARDS]) {
    const e = CARD_EN[c.id];
    if (!e) continue;
    c.name = e.name; c.text = e.text; c.flavor = e.flavor;
    if (c.short) c.short = e.short || e.text;
    c.hand = HAND_EN[c.id] || e.hand;
    if (c.fx.summon) c.fx.summon.name = SUMMON_EN[c.fx.summon.name] || c.fx.summon.name;
  }
  for (const list of Object.values(ULTS)) for (const u of list) Object.assign(u, ULT_EN[u.id] || {});
  for (const [k, v] of Object.entries(STATUS_EN)) if (STATUS_INFO[k]) STATUS_INFO[k].name = v;
  SIDE_NAME.blue = 'Little Wayne'; SIDE_NAME.green = 'Little Puma';
  SIDE_FULL.blue = 'Wayne Chiang'; SIDE_FULL.green = 'Puma Shen';
}

// ── 介面文字：中文原句 → 英文（{x} 是變數）─────────────────
const DICT = {
  // 首頁與固定畫面
  '藍綠攻防戰｜政治諷刺卡牌遊戲': 'Blue–Green Showdown | Political satire card game',
  '拉攏中間選民，先過半的人贏！': 'Win over the undecided voters. First to a majority wins!',
  '蔣萬安陣營': 'Wayne Chiang\'s camp', '沈伯洋陣營': 'Puma Shen\'s camp',
  '選一邊開始，對手由電腦操控': 'Pick a side to start. The computer plays the other side.',
  '怎麼玩': 'How to play', '隱私聲明': 'Privacy', '回報問題': 'Report a problem', '贊助': 'Support',
  '本作為政治諷刺娛樂，非任何候選人、政黨或競選團隊製作，內容不代表當事人言行。角色為原創 Q 版人偶，美術由 AI 生成。':
    'Political satire for entertainment. Not made by or affiliated with any candidate, party or campaign; nothing here represents what any real person said or did. The mascots are original cartoon characters, and the artwork is AI-generated.',
  '非官方製作・美術由 AI 生成': 'Unofficial fan-made satire · AI-generated art',
  '聯絡：': 'Contact: ',
  '靜音': 'Mute', '選單': 'Menu', '🔥 聲量爆表': '🔥 Hype burst', '跳過': 'Skip', '🎪 造勢晚會': '🎪 Big rally',
  '系統維護中，請稍後再來。': 'Down for maintenance. Please come back later.',
  '依選罷法規定，投票日暫停服務。': 'Closed on election day, as required by Taiwan\'s election law.',
  '中文': '中文', English: 'English',
  萬安號: 'Little Wayne', 伯洋號: 'Little Puma',

  // 對戰畫面
  '第 {r} / {m} 回合': 'Round {r} / {m}', '中間選民 {n}': 'Undecided {n}',
  '（我方）': ' (you)', '（對手）': ' (opponent)', '（你）': ' (you)',
  '🪤蓋牌×{n}': '🪤Traps ×{n}', '🂠手牌×{n}': '🂠Hand ×{n}',
  '支持者（{n} 過半）': 'Supporters ({n} to win)', '聲量 {n}': 'Hype {n}',
  '我方': 'You', '對手': 'Opponent',
  '🎪 {who}造勢晚會・剩 {n} 回合': '🎪 {who}: big rally · {n} turns left',
  '行程點 {a}/{c}': 'Action points {a}/{c}',
  '魔法卡用過了，還可以出 1 張牌': 'Magic card used. You can still play 1 card.',
  '每回合 +{n}，沒用完會存著': '+{n} per turn; unused points carry over',
  '對手思考中…': 'Opponent is thinking…', '對手行動中…': 'Opponent\'s turn…',
  '你是先手！': 'You go first!', '對手先手，你多拿 1 張牌': 'Your opponent goes first, so you get 1 extra card',
  '你蓋了一張陷阱': 'You set a trap', '對手蓋了一張陷阱': 'Your opponent set a trap',
  '你打出': 'You played', '對手打出': 'Opponent played',
  '放行，宣告生效': 'Allowed. The declaration takes effect',
  '抓到吹牛！宣告「{name}」其實是': 'Bluff caught! The declared "{name}" was really',
  '質疑失敗！是真的': 'Wrong call! It was real',
  '你的大絕招': 'Your special move', '對手的大絕招': 'Opponent\'s special move',
  '鄉民': 'netizen', '脆友': 'threads_user',
  '{who}挖走 {n} 人': '{who} poached {n} supporters',
  '{who}：{icon}{name}': '{who}: {icon}{name}',
  '{who}大絕招「{name}」！': '{who}: special move "{name}"!',
  '{who}聲量爆表！2 回合拉票 +50%': '{who}: hype burst! +50% voter gains for 2 turns',
  '{who}召喚「{name}」': '{who} summoned "{name}"',
  '對手蓋了一張牌…': 'Your opponent set a card face down…',
  '聲量 -{n}': 'Hype −{n}', '-{n} 人、': '−{n} supporters, ',
  '抓到吹牛！其實是「{actual}」，對手{lost}聲量 -{v}': 'Bluff caught! It was really "{actual}". Opponent: {lost}hype −{v}',
  '被抓包！你宣告的其實是「{actual}」，{lost}聲量 -{v}': 'Caught! Your card was really "{actual}". You: {lost}hype −{v}',
  '，{who} -{n} 人': '; {who} −{n} supporters', '你': 'you',
  '質疑失敗！「{name}」是真的{tail}': 'Wrong call! "{name}" was real{tail}',
  '對手質疑失敗！「{name}」是真的{tail}': 'Your opponent called it wrong! "{name}" was real{tail}',
  '你的陷阱被翻開了：{list}': 'Your traps were revealed: {list}',
  '對手的陷阱翻開了：{list}': 'Opponent\'s traps revealed: {list}',
  '你的回合（第 {n} 回合）': 'Your turn (round {n})',
  '跳過，行程點 {n} 點存著': 'Skipped. {n} action points saved',
  '時間到，自動跳過': 'Time\'s up. Turn skipped',
  '對手跳過，存了 {n} 點行程點': 'Opponent skipped and saved {n} action points',
  '暫停': 'Paused',
  // 卡牌彈窗
  '現在不是你的回合': 'It\'s not your turn',
  '最多同時蓋 2 張陷阱': 'You can have at most 2 traps set',
  '行程點不足（需要 {n}）': 'Not enough action points (need {n})',
  攻擊: 'Attack', 召喚: 'Summon', 魔法: 'Magic', 陷阱: 'Trap', 狀態: 'Status', 場地: 'Venue',
  普通: 'Common', 稀有: 'Rare', 史詩: 'Epic',
  '{type}卡・{rar}・行程點 {cost}': '{type} · {rar} · {cost} action points',
  '（被追問 +1）': ' (grilled +1)', '・不佔回合': ' · free action', '・打出後換對手': ' · ends your turn',
  '取消': 'Cancel', '打出': 'Play', '🂠 蓋牌宣告…': '🂠 Play face down…',
  '被起底中，這回合不能蓋牌宣告': 'You\'re exposed: no face-down plays this turn',
  '每回合只能蓋牌宣告 1 次': 'Only 1 face-down play per turn',
  '把這張蓋著打出，宣告成任何一張牌。對手可以質疑。': 'Play this card face down and declare it as any card. Your opponent may challenge.',
  '蓋牌宣告': 'Play face down', '（說實話）': ' (the truth)',
  '手上這張是「{name}」。要宣告成哪一張？行程點照宣告的那張付（你有 {ap} 點）。宣告後換對手。':
    'This card is "{name}". What will you declare it as? You pay the declared card\'s cost (you have {ap}). Then it\'s your opponent\'s turn.',
  '吹牛被抓：你 -{b} 人（聲量爆表時加倍）、聲量 -{v}，效果作廢。對手冤枉你：對手 -{w} 人，效果照常。':
    'Caught bluffing: you lose {b} supporters (double during a hype burst) and {v} hype, and the effect is cancelled. Wrongly accused: your opponent loses {w} supporters and the effect happens.',
  '返回': 'Back',
  '電腦研判你吹牛的機率：{p}%': 'Computer\'s estimate that you bluffed: {p}%', '（含 Jev 判斷）': ' (with Jev)',
  '電腦這局會手下留情一點（強度：{name}）': 'The computer will go easier this game ({name})',
  '你變強了！電腦恢復全力': 'You\'ve improved! The computer is back to full strength',
  '電腦認真一點了（強度：{name}）': 'The computer is playing harder now ({name})',
  標準: 'Standard', 溫和: 'Gentle', 很溫和: 'Very gentle', 新手: 'Beginner',
  // 質疑
  '對手蓋牌宣告': 'Your opponent played face down', '宣告': 'Declared',
  '{type}卡・行程點 {cost}': '{type} · {cost} action points',
  '質疑要付出：你下回合行程點 -1。<br>抓到吹牛 → 對手 -{b} 人、聲量 -{v}、效果作廢；猜錯 → 你 -{w} 人。':
    'Challenging costs you 1 action point next turn.<br>Catch a bluff → opponent −{b} supporters, −{v} hype, effect cancelled. Wrong → you −{w} supporters.',
  '放行': 'Allow', '🔍 質疑！': '🔍 Challenge!',
  '等對手決定…': 'Waiting for your opponent…', '你蓋牌宣告了「{name}」': 'You declared "{name}"',
  '對手正在決定要質疑還是放行': 'Your opponent is deciding whether to challenge',
  // 大絕招
  '（本局已用過）': ' (already used)', '（失言中，不能發動）': ' (gaffe: unavailable)', '（第 {n} 回合後）': ' (from round {n})',
  '🔥 聲量爆表！擇一': '🔥 Hype burst! Choose one', '進入爆表狀態': 'Go into hype burst', '2 回合內拉票 +50%': '+50% voter gains for 2 turns',
  '先不要': 'Not now',
  // 選單、結果
  '離開（30 秒後判負）': 'Leave (you lose after 30 s)', '回首頁（放棄這局）': 'Home (forfeit this game)', '繼續': 'Resume',
  '電腦強度：{name}（依你的戰績自動調整）': 'Computer strength: {name} (adjusts to your results)', '改回標準': 'Reset to standard',
  '下一局電腦恢復全力': 'The computer will play at full strength next game',
  '已靜音': 'Muted', '已開啟音效': 'Sound on',
  '平手！': 'Draw!', '你贏了！': 'You win!', '你輸了…': 'You lose…',
  '藍 {b}': 'Blue {b}', '{g} 綠': '{g} Green',
  '再玩一次': 'Play again', '換陣營': 'Switch sides', '分享': 'Share', '回首頁': 'Home',
  '平手？這劇本誰寫的': 'A draw? Who wrote this script', '恭喜！好人一生平安': 'Congrats! GG well played', '下一局會更好，再來一場': 'Next one\'s yours. Run it back',
  '遊戲結果僅供娛樂，與實際選情無關。': 'Results are for fun and have nothing to do with the real election.',
  '再配對一次': 'Find another match', '對戰電腦': 'Play the computer',
  '我在《藍綠攻防戰》用{side}打到 藍 {b} : {g} 綠，{title} 來挑戰：{url}': 'I played {side} in Blue–Green Showdown: Blue {b} : {g} Green. {title} Your turn: {url}',
  '已複製分享文字': 'Share text copied',
  '知道了': 'OK', '關閉': 'Close', '開始！': 'Start!',
  // 回報
  '遇到錯誤、覺得某張卡不妥，或有任何建議，都可以寫在這裡。請不要寫姓名、電話等個人資料。': 'Found a bug, a card that seems unfair, or have a suggestion? Tell us here. Please don\'t include names, phone numbers or other personal details.',
  '例如：第 3 回合按了跳過，畫面就卡住不動': 'e.g. "After I pressed Skip in round 3, the screen froze"',
  '附上這局的遊戲狀態與瀏覽器種類（幫助找錯誤）': 'Attach this game\'s state and your browser type (helps us find bugs)',
  '回報內容會送到 TypeSafe 的 Jev 模型自動分類，需要處理的會轉給作者。': 'Reports are sorted automatically by TypeSafe\'s Jev model; anything that needs attention goes to the author.',
  '送出': 'Send', '請寫下遇到的問題': 'Please describe the problem', '送出失敗，請稍後再試': 'Couldn\'t send. Please try again later',
  '收到了，謝謝你的回報！': 'Got it. Thanks for the report!', '送出失敗，也可以寄信到 {mail}': 'Couldn\'t send. You can also email {mail}',
  // 連線
  '{side}・選擇模式': '{side} · Choose a mode', '🤖 對戰電腦': '🤖 Play the computer',
  '連線暱稱（最多 {n} 字，會顯示給對手）': 'Online nickname (up to {n} characters, shown to your opponent)',
  '例如：路過的市民': 'e.g. Passing Citizen', '⚡ 線上隨機配對': '⚡ Random online match', '🏠 開房間給朋友': '🏠 Create a room for a friend',
  '朋友的 5 碼房號': 'Friend\'s 5-character room code', '加入': 'Join',
  '加入朋友的房間時，你會拿到房主沒選的那一邊。': 'When you join a friend\'s room, you play the side they didn\'t pick.',
  '連線對戰暫時無法使用，先跟電腦玩吧！': 'Online play is unavailable right now. Play the computer instead!',
  '房號是 5 碼英文或數字': 'Room codes are 5 letters or digits',
  '真人驗證': 'Human check', '確認你不是機器人，通常點一下就好。': 'Confirm you\'re not a bot. Usually one tap is enough.',
  '真人驗證沒有完成，請再試一次': 'The human check wasn\'t completed. Please try again',
  '配對中…': 'Finding a match…', '正在找另一個陣營的對手…': 'Looking for an opponent from the other camp…',
  '{n} 秒內沒配到，會自動改成跟電腦對戰。': 'If no one is found within {n} seconds, you\'ll play the computer.',
  '直接跟電腦玩': 'Play the computer now', '沒有配到對手，改跟電腦對戰': 'No opponent found. Playing the computer',
  '改找任何陣營的對手…': 'Now looking for an opponent from either camp…', '配對連線中斷，請再試一次': 'Matchmaking connection lost. Please try again',
  '開房失敗，請稍後再試': 'Couldn\'t create a room. Please try again later', '開房失敗，請檢查網路': 'Couldn\'t create a room. Check your connection',
  '房間開好了': 'Room ready', '把房號傳給朋友：': 'Send this code to your friend:',
  '朋友在首頁點任一角色 →「加入」輸入房號。10 分鐘內沒人加入會自動關閉。': 'Your friend taps either mascot on the home screen, then "Join" with this code. The room closes if no one joins within 10 minutes.',
  '分享房號': 'Share code', '已複製': 'Copied',
  '來《藍綠攻防戰》跟我對戰！房號 {code}：{url}': 'Play me in Blue–Green Showdown! Room code {code}: {url}',
  '連線中，請稍候再試': 'Connecting. Please try again in a moment', '連線中斷，重新連線中…': 'Connection lost. Reconnecting…',
  '連線中斷太久，這局已結束': 'The connection was lost too long. This game has ended',
  '對手斷線了，30 秒內沒回來你就獲勝': 'Your opponent disconnected. If they don\'t return within 30 s, you win',
  '對手回來了': 'Your opponent is back',
  // 暱稱檢查（前端與伺服器）
  '請輸入暱稱': 'Please enter a nickname', '暱稱最多 {n} 個字': 'Nicknames can be at most {n} characters', '這個暱稱不能使用，請換一個': 'That nickname isn\'t allowed. Please choose another',
  '這個暱稱像是在冒充真實政治人物或其團隊，請換一個': 'That nickname looks like it impersonates a real politician or their team. Please choose another',
  '這個暱稱像是在冒充官方或遊戲管理員，請換一個': 'That nickname looks like it impersonates an official body or a game admin. Please choose another',
  '暱稱不能有投票或罷免呼籲，請換一個': 'Nicknames can\'t ask people to vote or recall anyone. Please choose another',
  '這個暱稱含有罵人的字眼，請換一個': 'That nickname contains an insult. Please choose another',
  '這個暱稱有歧視或貶低特定族群的意味，請換一個': 'That nickname puts down a group of people. Please choose another',
  // 伺服器訊息
  '資料格式錯誤': 'Invalid request', '找不到這個房號': 'Room not found', '這個房間已經開始或結束了': 'That room has already started or ended',
  '等太久了，房間已關閉': 'The room closed after waiting too long', '目前房間已滿，請稍後再試': 'All rooms are full. Please try again later',
  '目前房間已滿，排隊中…': 'All rooms are full. Waiting in line…', '還沒輪到你': 'It\'s not your turn yet',
  '等對手決定要不要質疑': 'Waiting for your opponent to decide on a challenge', '這個動作現在不能做': 'You can\'t do that right now',
  '真人驗證失敗，請重試': 'Human check failed. Please try again', '請先完成真人驗證': 'Please complete the human check first',
  '內容格式不對，請寫 2～1000 字': 'Please write 2 to 1,000 characters', '回報太頻繁了，請過幾分鐘再試': 'Too many reports. Please try again in a few minutes',
  '今天的回報已經很多了，明天再試，或寄信到聯絡信箱': 'We\'ve received a lot of reports today. Please try again tomorrow or email us',
  // 結束原因
  支持者過半: 'Majority reached', '第 12 回合結束，支持者較多': 'Round 12 ended with more supporters',
  '支持者同數，比手牌': 'Tied on supporters; more cards in hand wins', '支持者與手牌同數，比聲量': 'Tied on supporters and cards; more hype wins',
  完全平手: 'A perfect tie', '對手未連線或斷線超過 30 秒': 'The opponent never connected or was gone for over 30 seconds',
  // 規則引擎事件
  '{name} 因手牌已滿被棄掉': '{name} was discarded because your hand is full',
  '同情票觸發：下次拉票加倍': 'Sympathy vote: your next voter gain is doubled',
  '陷阱「跑票」：{n} 人走回中間': 'Trap "Defectors": {n} voters walk back to the middle',
  '陷阱「下雨了」：造勢晚會提前結束': 'Trap "Rain Out": the big rally ends early',
  '陷阱「下雨了」：行程點 -1': 'Trap "Rain Out": −1 action point',
  '被包圍，流失 {n} 人': ' is surrounded and loses {n} supporters',
  '問A答B・大反射：攻擊轉向！': 'Grand Deflection: the attack bounces back!',
  '頭暈轉圈，這張打歪了': ' is dizzy. That card missed',
  '造勢晚會開始！': ': the big rally begins!',
  '時間到，自動結束回合': ': time\'s up, turn ended', '沒有回應，視同放行': ': no response, counted as allow',
};
// 有變數、從伺服器或規則引擎送來的句子：用樣式比對
const PATTERNS = [
  [/^暱稱最多 (\d+) 個字$/, (m) => `Nicknames can be at most ${m[1]} characters`],
  [/^系統偵測到不像真人的操作，線上對戰暫停到 (\d+:\d+)，先跟電腦玩吧$/, (m) => `That looked like automated play. Online matches are paused until ${m[1]} (Taipei time). You can play the computer meanwhile.`],
  [/^對局超過 20 分鐘，(.+)$/, (m) => `Game passed 20 minutes. ${tr(m[1])}`],
  [/^(.+) 因手牌已滿被棄掉$/, (m) => `${nameEN(m[1])} was discarded because your hand is full`],
  [/^陷阱「跑票」：(\d+) 人走回中間$/, (m) => `Trap "Defectors": ${m[1]} voters walk back to the middle`],
  [/^被包圍，流失 (\d+) 人$/, (m) => ` is surrounded and loses ${m[1]} supporters`],
];

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`)) : s);
// t：程式裡的中文句子（可帶 {變數}）
export function t(zh, vars) {
  if (!EN) return fill(zh, vars);
  return fill(DICT[zh] ?? zh, vars);
}
// tr：伺服器或規則引擎已經組好的中文句子（不帶變數）
export function tr(zh) {
  if (!EN || typeof zh !== 'string') return zh;
  if (DICT[zh] !== undefined) return DICT[zh];
  for (const [re, f] of PATTERNS) { const m = zh.match(re); if (m) return f(m); }
  return zh;
}

// 套用到 HTML 上標了 data-i18n 的元素（內容是中文原句）
export function applyStatic(root = document) {
  if (!EN) return;
  document.documentElement.lang = 'en';
  document.title = DICT['藍綠攻防戰｜政治諷刺卡牌遊戲'];
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.textContent.trim());
  for (const el of root.querySelectorAll('[data-i18n-alt]')) el.alt = t(el.alt);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.getAttribute('aria-label')));
  for (const el of root.querySelectorAll('.logo')) el.innerHTML = '<span class="b">Blue</span>–<span class="g">Green</span> Showdown';
}

// ── 長篇說明（規則、隱私）──────────────────────
export function rulesHTML_EN(R, C) {
  return `<h2>How to play</h2><ul>
    <li>There are 100 grey <b>undecided voters</b>. Win over <b>${R.winAt} (a majority)</b> first and you win. If nobody does by the end of round ${R.maxRounds}, whoever has more supporters wins.</li>
    <li><b>One card per turn</b>: tap a card to read it, press "Play", and your turn ends. You can also "Skip". Each turn has a ${C.TURN_SECONDS}-second limit.</li>
    <li><b>Action points</b> (gold dots): +${R.apPerTurn} each turn. Unused points carry over, up to ${R.apCap}, so you can save up for big cards.</li>
    <li>✨<b>Magic cards are free actions</b>: you can still play another card afterwards (max 1 magic card per turn). Special moves are free too.</li>
    <li>You draw 1 card per turn and can hold up to 5. The deck is endless and fully random.</li>
    <li>Fill the <b>hype bar</b> to 100 for a <b>hype burst</b>: use a special move (each once per game), or boost voter gains by 50% for 2 turns.</li>
    <li>Voters get harder to win later in the game. Get hit twice and a <b>sympathy vote</b> doubles your next gain.</li>
    <li>Card types: 📣 Attack 👥 Summon ✨ Magic 🪤 Trap (set face down, triggered by your opponent) 🌀 Status 🎪 Venue.</li>
    <li><b>Play face down</b>: tap a card and choose "Play face down" to declare it as any card (you pay the declared cost). Tell the truth or bluff. It counts as your card for the turn.</li>
    <li><b>Challenge</b>: when your opponent plays face down, you have ${R.respondSeconds} seconds to decide. Challenging costs 1 action point next turn. Catch a bluff and they lose ${R.bluffPenalty} supporters and ${R.caughtVoice} hype, and the effect is cancelled. Guess wrong and you lose ${R.wrongChallenge} supporters.</li>
  </ul>`;
}
export function privacyHTML_EN(C) {
  return `<h2>Privacy</h2>
    <p>No sign-up. We don't collect names, email addresses or other contact details.</p>
    <p><b>Online play</b>: the server temporarily keeps your nickname, a random player ID and the game itself, only to run the game. They're deleted about a minute after the game ends. Your nickname is shown to your opponent.</p>
    <p><b>Nickname check</b>: your nickname is sent to TypeSafe's Jev model to check for impersonating real people or officials, insults, slurs or calls to vote. The result (only the nickname and pass/fail) is kept for 7 days so it isn't checked twice. Please don't put personal details in your nickname.</p>
    <p><b>Problem reports</b>: what you write is sent to TypeSafe's Jev model to be sorted automatically. If you tick the box, this game's numbers and your browser type (e.g. Safari, iOS, opened inside LINE) are attached; no IP address or identifying data. Reports are kept for up to 7 days and deleted after the daily summary goes to the author.</p>
    <p><b>Contact email</b>: the subject and body of emails to our contact address are sent to TypeSafe's Jev model for sorting (e.g. takedown requests, bug reports). The sender's address is not sent. Emails that need attention are forwarded to the author.</p>
    <p>Your browser remembers on your device: mute, whether you've seen the tutorial, your last nickname, your current game ID (cleared when you close the tab), your language, and <b>your play-style stats against the computer</b> (how often you were caught bluffing and how often you challenge), so the computer can learn to read you. These stats stay on your device.</p>
    <p><b>Against the computer</b>, when you play face down the server may send <b>game numbers</b> (round, both sides' supporters, the declared card, the stats above) to TypeSafe's Jev model to estimate whether you're bluffing. No nickname, IP or personal data is sent.</p>
    <p><b>Computer strength</b>: after each game against the computer, the server sends <b>your last few games' numbers</b> (wins and losses, supporter margins, rounds, skips and timeouts, game length) to TypeSafe's Jev model to decide whether the computer should go easier. No nickname, IP or personal data; your results stay on your device.</p>
    <p><b>Bot protection</b>: in online games the server records how long each of your actions takes (in milliseconds). After the game it sends <b>statistics</b> (average, fastest, variation, games in the last hour) to TypeSafe's Jev model to check whether the play looks scripted. If it looks suspicious, you'll be asked to complete a human check or online play pauses for a while. No nickname, IP or player ID is sent. IP addresses are held only as a hash that changes daily, in server memory, to count recent games; flags are tied only to the random player ID and last at most 24 hours.</p>
    <p>The site and game server are hosted by Cloudflare, which logs connection data such as IP addresses for security and operations under its own privacy policy; Cloudflare Turnstile's policy also applies if a human check is shown. Connection data we log ourselves is kept no longer than 30 days. We use no ads or trackers.</p>
    <p>Questions or requests: <a href="mailto:${C.CONTACT_EMAIL}">${C.CONTACT_EMAIL}</a></p>
    <p class="small">Political satire for entertainment. Not made by or affiliated with any candidate, party or campaign; nothing here represents what any real person said or did. The mascots are original cartoon characters, and the artwork is AI-generated.</p>`;
}
