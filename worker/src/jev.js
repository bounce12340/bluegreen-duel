// Jev（TypeSafe）判斷：所有問題、狀態格式、模型版本都集中在這個檔案，方便檢查與修改。
// 原則：Jev 只做「判斷」（這次像不像吹牛），要不要質疑由遊戲程式算期望值決定（site/js/ai.js）。
// 送出的資料只有遊戲數字與卡牌效果，不含暱稱、IP 或任何個人資料。
import { CARD_BY_ID } from '../../site/js/engine.js';

export const JEV_MODEL = 'jev-1.14.0'; // 固定版本，結果可重現；換版本前先重跑測試案例
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_TIMEOUT_MS = 2500;     // 玩家有 8 秒，留足時間給畫面

// 卡牌效果的英文描述（給 Jev 看懂這張卡有多強）
export function describeCard(c) {
  const fx = c.fx;
  const parts = [];
  if (fx.pull) parts.push(`wins over ${fx.pull} undecided voters`);
  if (fx.poach) parts.push(`takes ${fx.poach} supporters away from the opponent`);
  if (fx.voice) parts.push(`adds ${fx.voice} hype points`);
  if (fx.draw) parts.push(`draws ${fx.draw} cards`);
  if (fx.ap) parts.push(`gives ${fx.ap} extra action points`);
  if (fx.summon) parts.push(`adds ${fx.summon.perTurn} supporters per turn for ${fx.summon.turns} turns`);
  if (fx.field) parts.push('starts a rally that adds 3 supporters per turn for 2 turns');
  if (fx.applyStatus) {
    const what = {
      encircle: 'makes the opponent lose 2 supporters per turn for 2 turns',
      question: 'makes the opponent\'s next 2 cards cost 1 more point',
      deflect: 'gives the opponent\'s next attack a 50% chance to miss',
      gaffe: 'stops the opponent from using their special move for 1 turn',
      exposed: 'reveals the opponent\'s hidden traps and stops them declaring for 1 turn',
    }[fx.applyStatus.id];
    if (what) parts.push(what);
  }
  return parts.join('; ');
}

const RARITY_EN = { common: 'common', rare: 'rare', epic: 'epic (the strongest kind)' };

// 依照前端送來、已驗證的數字組出 state。只放判斷需要的欄位。
export function buildState(f) {
  const as = CARD_BY_ID[f.asId];
  return {
    rules: {
      summary: 'Two-player card game. Each turn a player plays one card. Instead of playing it face up, a player may place any card face down and declare it to be a card of their choice; the declaration can be true or a bluff. The declared card\'s cost is paid either way.',
      if_caught_bluffing: 'The bluffer loses 5 supporters and 20 hype points, and the declared effect is cancelled.',
      if_wrongly_challenged: 'The challenger loses 3 supporters, and the declared effect happens.',
      how_strong_cards_are: 'Costs range from 0 to 5 action points. Most cards cost 1 to 3. Players gain 3 action points per turn and can save unused points, up to 10.',
    },
    declaration: {
      declared_card: `${as.name}: ${describeCard(as)}`,
      declared_card_cost: as.cost,
      declared_card_rarity: RARITY_EN[as.rarity],
      round: `${f.round} of 12`,
      action_points_declarer_had_before_declaring: f.apBefore,
      declarer_skipped_their_previous_turn_to_save_points: f.skippedLastTurn,
      cards_in_declarer_hand_after_declaring: f.handSize,
      declarer_supporters: f.declarerSupporters,
      other_player_supporters: f.otherSupporters,
      supporters_needed_to_win: 51,
    },
    declarer_history_with_this_opponent: {
      declarations_shown_to_be_bluffs: f.history.bluffs,
      declarations_shown_to_be_true: f.history.honest,
      note: f.history.bluffs + f.history.honest === 0
        ? 'No earlier declarations by this player have been revealed.'
        : 'Only declarations that were challenged get revealed; the rest are unknown.',
    },
  };
}

export const QUESTIONS = {
  is_bluff: {
    type: 'noul',
    instructions: 'Is the face-down card a bluff, different from the card named in `declaration.declared_card`?',
    criteria: {
      true: 'The player placed some other, weaker card face down and named a card they do not have.',
      false: 'The face-down card really is the card the player named.',
    },
  },
};

// 驗證並清理前端送來的資料；不合格回傳 null。只接受數字與已知卡牌 id，不接受任何自由文字。
export function parseFacts(body) {
  if (!body || typeof body !== 'object') return null;
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const as = CARD_BY_ID[body.asId];
  if (!as || as.type === 'trap') return null;
  const h = body.history || {};
  const f = {
    asId: as.id,
    round: int(body.round, 1, 12),
    apBefore: int(body.apBefore, 0, 12),
    skippedLastTurn: body.skippedLastTurn === true,
    handSize: int(body.handSize, 0, 5),
    declarerSupporters: int(body.declarerSupporters, 0, 100),
    otherSupporters: int(body.otherSupporters, 0, 100),
    history: { bluffs: int(h.bluffs, 0, 100000), honest: int(h.honest, 0, 100000) },
  };
  const values = [f.round, f.apBefore, f.handSize, f.declarerSupporters, f.otherSupporters, f.history.bluffs, f.history.honest];
  if (values.some((v) => v === null)) return null;
  return f;
}

// ── 通用呼叫 ───────────────────────────────
// 呼叫 Jev。失敗一律丟出錯誤（不要把失敗當成「否」）。回傳 { answers, model, usage, payload }
export async function callJev(apiKey, state, questions, { url = JEV_URL, timeoutMs = JEV_TIMEOUT_MS } = {}) {
  const payload = { model: JEV_MODEL, state, questions };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`jev http ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    for (const k of Object.keys(questions)) {
      if (!d?.answers?.[k]) throw new Error(`jev missing answer ${k}`);
    }
    return { answers: d.answers, model: d.model, usage: d.usage, payload };
  } finally {
    clearTimeout(timer);
  }
}
const noul = (answers, k) => {
  const v = answers[k]?.noul;
  if (typeof v !== 'number' || v < 0 || v > 1) throw new Error(`jev bad noul ${k}`);
  return v;
};

// ── 1. 電腦對手：這次像不像吹牛 ───────────────
export async function askJev(apiKey, facts, url = JEV_URL) {
  const r = await callJev(apiKey, buildState(facts), QUESTIONS, { url });
  return { bluff: noul(r.answers, 'is_bluff'), model: r.model, usage: r.usage, payload: r.payload };
}

// ── 2. 暱稱審核 ───────────────────────────────
// 關鍵字清單先擋明顯的（免費）；Jev 抓諧音、空格、注音等繞法。
export const NICKNAME_CONTEXT = 'A player typed this nickname for an online card game that satirizes the 2026 Taipei mayoral race between 蔣萬安 (Kuomintang, KMT, the blue camp) and 沈伯洋 (Democratic Progressive Party, DPP, the green camp). The opponent will see it. People sometimes hide words with spaces, homophones, Zhuyin symbols (ㄅㄆㄇ), or English spellings.';
export const NICKNAME_QUESTIONS = {
  claims_politician: {
    type: 'noul',
    instructions: 'Does `nickname` claim that the player is a real politician or a member of their campaign team?',
    criteria: {
      true: 'The nickname presents the player as 蔣萬安, 沈伯洋, another real politician, or their staff, for example "萬安本人" or "伯洋競選團隊".',
      false: 'The nickname is an ordinary handle, or only jokes about politics without claiming to be a politician or their staff.',
    },
  },
  claims_official: {
    type: 'noul',
    instructions: 'Does `nickname` claim to be a government office, the election commission, a political party, or the game\'s staff?',
    criteria: {
      true: 'The nickname presents the player as an official body or as staff, for example "中選會公告", "國民黨黨部", or "遊戲管理員".',
      false: 'The nickname is a personal handle that does not claim any official role.',
    },
  },
  insults: {
    type: 'noul',
    instructions: 'Does `nickname` swear at or insult someone?',
    criteria: {
      true: 'The nickname contains swearing, slurs, or name-calling, including disguised spellings or homophones.',
      false: 'The nickname is friendly, neutral, or gently self-deprecating.',
    },
  },
  demeans_group: {
    type: 'noul',
    instructions: 'Does `nickname` put down a group of people, such as supporters of a party, an ethnic group, or people from a place?',
    criteria: {
      true: 'The nickname uses a label or joke that belittles a whole group, for example calling one camp\'s supporters animals.',
      false: 'The nickname does not target any group of people.',
    },
  },
  campaigns: {
    type: 'noul',
    instructions: 'Does `nickname` urge people to vote for or against a candidate or party?',
    criteria: {
      true: 'The nickname asks people to vote, or not vote, for someone, for example "投給二號" or "罷免某某".',
      false: 'The nickname does not ask anyone to vote in any way.',
    },
  },
};
// 判斷規則（程式決定）：暱稱寧可錯擋——擋錯了玩家換一個名字就好，放過歧視或冒充則有法律與聲譽風險，所以一律 0.5
export const NICKNAME_RULES = [
  { key: 'claims_politician', threshold: 0.5, msg: '這個暱稱像是在冒充真實政治人物或其團隊，請換一個' },
  { key: 'claims_official', threshold: 0.5, msg: '這個暱稱像是在冒充官方或遊戲管理員，請換一個' },
  { key: 'campaigns', threshold: 0.5, msg: '暱稱不能有投票或罷免呼籲，請換一個' },
  { key: 'insults', threshold: 0.5, msg: '這個暱稱含有罵人的字眼，請換一個' },
  { key: 'demeans_group', threshold: 0.5, msg: '這個暱稱有歧視或貶低特定族群的意味，請換一個' },
];
// 快取存「判斷」（各題機率），決定在讀取時用上面的規則算，改門檻不必重問；改問題就換版本號
export const NICKNAME_QVER = `n${JSON.stringify(NICKNAME_QUESTIONS).length}`;
export function nicknameDecision(scores) {
  const hit = NICKNAME_RULES.find((rule) => scores[rule.key] >= rule.threshold);
  return { ok: !hit, msg: hit ? hit.msg : null };
}
export async function judgeNickname(apiKey, nickname, url = JEV_URL) {
  const r = await callJev(apiKey, { nickname, context: NICKNAME_CONTEXT }, NICKNAME_QUESTIONS, { url });
  const scores = Object.fromEntries(Object.keys(NICKNAME_QUESTIONS).map((k) => [k, noul(r.answers, k)]));
  return { ...nicknameDecision(scores), scores, model: r.model, usage: r.usage };
}

// ── 3. 聯絡信箱分流 ───────────────────────────
// 寄件人地址不送給 Jev，只送主旨與內文（截斷）。
export const MAIL_CONTEXT = 'This email was sent to the public contact address of 藍綠攻防戰, a free online political-satire card game about the 2026 Taipei mayoral race between 蔣萬安 (KMT) and 沈伯洋 (DPP). The game is not made by any candidate, party, or campaign.';
export const MAIL_QUESTIONS = {
  asks_removal: {
    type: 'noul',
    instructions: 'Does `email` ask for the game, or something in it, to be taken down or removed?',
    criteria: {
      true: 'The writer asks for the game, a card, or other content to be removed, taken down, or toned down.',
      false: 'The writer only praises the game, reports a problem, or suggests adding new features.',
    },
  },
  speaks_for_official: { type: 'noul', instructions: 'Does the writer of `email` say they represent a candidate, a campaign, a political party, a government agency, or the election commission?' },
  mentions_legal: { type: 'noul', instructions: 'Does `email` mention legal action, a lawyer, a court, or a specific law?' },
  reports_bug: { type: 'noul', instructions: 'Does `email` describe the game not working, such as an error, a freeze, or something broken?' },
  from_press: { type: 'noul', instructions: 'Does the writer of `email` say they are a journalist or work for a media outlet?' },
  about_money: { type: 'noul', instructions: 'Is `email` about donating, sponsoring, or paying money to the game?' },
  money_for_content: {
    type: 'noul',
    instructions: 'Does `email` offer money in exchange for adding, removing, or changing content in the game?',
    criteria: {
      true: 'The writer ties a payment or donation to a content change, for example "I will sponsor you if you add a card attacking one side".',
      false: 'Any money mentioned comes with no request to change the game\'s content.',
    },
  },
  abusive: {
    type: 'noul',
    instructions: 'Is `email` abusive toward the reader?',
    criteria: {
      true: 'It insults or curses at the reader, uses slurs, or threatens violence or harassment.',
      false: 'It is rude at most, or it firmly asks for something, including saying the writer will take legal action.',
    },
  },
  // 評分題：回傳 0–3 的期望值（不是機率）
  urgency: {
    type: 'score',
    instructions: 'How urgently does the author of the game need to read `email`?',
    criteria: [
      'Spam, advertising, or a message that needs no attention.',
      'General feedback, a question, a compliment, or a bug report. It can wait a day.',
      'It needs the author personally, such as a media interview request, a formal complaint, or a sponsorship offer, but it sets no deadline.',
      'It sets a deadline or warns of consequences, such as a lawyer\'s letter, an official demand to remove content by a date, or a report of a security problem.',
    ],
  },
};
const NOUL_MAIL_KEYS = Object.keys(MAIL_QUESTIONS).filter((k) => MAIL_QUESTIONS[k].type === 'noul');

// 緊急程度（0–3）：Jev 的分級打底，再用是非題當安全網——
// 自稱官方、提到法律、用錢換內容、記者來信，至少算 2 級（一定轉寄）；
// 提到法律又要求下架或自稱官方（像律師函），直接算 3 級。
// 單純「要求拿掉某張卡」不強制升級，由 Jev 分級判斷（網友建議通常是 1 級，進晚上彙整）。
//   3 特急：立即轉寄　2 需本人處理：轉寄　1 一般：晚上彙整　0 垃圾：只貼標籤
export const MAIL_LEVEL_CUTS = [0.5, 1.5, 2.5];
export function mailLevel(scores) {
  const u = scores.urgency;
  let level = MAIL_LEVEL_CUTS.filter((c) => u >= c).length;
  const urgentKeys = ['speaks_for_official', 'mentions_legal', 'money_for_content'];
  const ruleUrgent = urgentKeys.some((k) => scores[k] >= 0.5);
  if (ruleUrgent || scores.from_press >= 0.7) level = Math.max(level, 2);
  if (scores.mentions_legal >= 0.5 && (scores.asks_removal >= 0.5 || scores.speaks_for_official >= 0.5)) level = 3;
  if (level < 1 && (scores.reports_bug >= 0.7 || scores.about_money >= 0.7 || scores.asks_removal >= 0.5)) level = 1; // 不算垃圾
  return { level, ruleUrgent };
}

// 判斷規則：類別標籤＋緊急程度 prio-0～3；2 級以上轉寄作者
export function mailDecision(scores) {
  const { level, ruleUrgent } = mailLevel(scores);
  const labels = [`prio-${level}`];
  const urgent = ruleUrgent;
  if (level === 3) labels.push('critical');
  if (urgent) labels.push('urgent');
  if (scores.asks_removal >= 0.5) labels.push('takedown');
  if (scores.speaks_for_official >= 0.5) labels.push('official');
  if (scores.mentions_legal >= 0.5) labels.push('legal');
  if (scores.money_for_content >= 0.5) labels.push('conditional-sponsor');
  else if (scores.about_money >= 0.7) labels.push('sponsor');
  if (scores.reports_bug >= 0.7) labels.push('bug');
  if (scores.from_press >= 0.7) labels.push('press');
  if (scores.abusive >= 0.7) labels.push('abusive');
  if (!labels.some((l) => !l.startsWith('prio-') && l !== 'critical')) labels.push('other'); // 沒有任何類別
  return { labels, level, forward: level >= 2, urgent };
}
// 遊戲內「回報問題」表單也用同一套問題與分級，只是說明文字不同
export const REPORT_CONTEXT = 'This message was typed into the "report a problem" form inside 藍綠攻防戰, a free online political-satire card game about the 2026 Taipei mayoral race between 蔣萬安 (KMT) and 沈伯洋 (DPP). The game is not made by any candidate, party, or campaign. The message is written by a player.';
export async function judgeMail(apiKey, subject, body, url = JEV_URL, { context = MAIL_CONTEXT } = {}) {
  const email = { subject: String(subject || '').slice(0, 300), body: String(body || '').slice(0, 6000) };
  const r = await callJev(apiKey, { email, context }, MAIL_QUESTIONS, { url, timeoutMs: 8000 });
  const scores = Object.fromEntries(NOUL_MAIL_KEYS.map((k) => [k, noul(r.answers, k)]));
  const u = r.answers.urgency;
  if (typeof u?.score !== 'number') throw new Error('jev bad score urgency'); // 失敗不當答案：交給呼叫端轉寄
  scores.urgency = u.score;
  return { scores, ...mailDecision(scores), model: r.model, usage: r.usage };
}

// ── 5. 玩家心情：決定電腦要不要放水（對戰電腦）──────────
// 只送遊戲數字（勝負、差距、回合數、跳過與逾時次數、局長），不含暱稱、IP 或任何個人資料。
// Jev 只判斷「玩家是不是快放棄了」「電腦是不是太好打」；升降一級由前端程式決定（site/js/main.js）。
export const MOOD_CONTEXT = 'A person is playing a turn-based political-satire card game against a computer opponent in a web browser. A game lasts at most 12 rounds and a player wins by reaching 51 supporters first. The game wants new players to keep enjoying it, so it can make the computer opponent easier or harder.';
export const MOOD_QUESTIONS = {
  frustrated: {
    type: 'noul',
    instructions: 'Is the player in `recent_games` likely frustrated and close to giving up on the game?',
    criteria: {
      true: 'The player keeps losing, often by a wide margin, quits games before they end, or lets turns run out of time.',
      false: 'The player wins some games, loses close games, or keeps playing whole games.',
    },
  },
  too_easy: {
    type: 'noul',
    instructions: 'Is the computer opponent too easy for the player in `recent_games`?',
    criteria: {
      true: 'The player wins most of the recent games, often by a wide margin.',
      false: 'The player loses some recent games or wins only narrowly.',
    },
  },
};
const MOOD_RESULTS = ['win', 'loss', 'draw', 'quit'];
const DIFFICULTY_EN = ['normal', 'a little easier', 'much easier', 'beginner level'];
// 只接受固定欄位的數字與列舉值；不合格回傳 null
export function parseMood(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.recent)) return null;
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  if (body.recent.length < 1 || body.recent.length > 8) return null;
  const recent = body.recent.map((g) => ({
    result: MOOD_RESULTS.includes(g?.r) ? g.r : null,
    margin: int(g?.margin, -100, 100),
    rounds: int(g?.rounds, 1, 12),
    skips: int(g?.skips, 0, 12),
    timeouts: int(g?.timeouts, 0, 12),
    minutes: int(g?.minutes, 0, 120),
  }));
  if (recent.some((g) => Object.values(g).some((v) => v === null))) return null;
  const ease = int(body.ease, 0, DIFFICULTY_EN.length - 1);
  const games = int(body.games, 1, 10000);
  if (ease === null || games === null) return null;
  return { recent, ease, games };
}
export function buildMoodState(m) {
  return {
    context: MOOD_CONTEXT,
    recent_games: m.recent.map((g) => ({
      result: g.result === 'quit' ? 'left the game before it ended' : g.result,
      supporter_margin_player_minus_computer: g.margin,
      rounds_played: g.rounds,
      turns_the_player_skipped: g.skips,
      turns_that_ran_out_of_time: g.timeouts,
      minutes: g.minutes,
    })),
    note: 'recent_games is ordered from oldest to newest.',
    games_played_on_this_device: m.games,
    current_computer_difficulty: DIFFICULTY_EN[m.ease],
  };
}
export async function judgeMood(apiKey, mood, url = JEV_URL) {
  const r = await callJev(apiKey, buildMoodState(mood), MOOD_QUESTIONS, { url });
  return { frustrated: noul(r.answers, 'frustrated'), tooEasy: noul(r.answers, 'too_easy'), model: r.model, usage: r.usage, payload: r.payload };
}

// ── 6. 機器人／腳本行為（線上對戰結束後）──────────────
// 只送反應時間的統計數字與近一小時場數，不含玩家識別碼、暱稱或 IP。要不要驗證由程式決定（index.js）。
export const BOT_CONTEXT = 'Timing statistics from one online game of a turn-based card game played in a web browser. On each turn a person reads their cards, thinks, and taps; each turn allows up to 30 seconds and players often take several seconds. A script or bot tends to act faster than a person could read the screen, with almost the same delay every time, and may play many games in a row.';
export const BOT_QUESTIONS = {
  looks_scripted: {
    type: 'noul',
    instructions: 'Does the timing in `stats` look like a script or bot rather than a person playing?',
    criteria: {
      true: 'Most actions come faster than a person could read the screen, or the delays are nearly identical from action to action, or the player has played an unusually large number of games in the last hour.',
      false: 'The delays vary the way a person\'s do, with some quick and some slow decisions, and the number of games is ordinary.',
    },
  },
};
// 由一局的反應時間（毫秒）算統計。少於 6 個動作就不判斷（資料太少）
export function botStats(rts, { timeouts = 0, gamesLastHour = 1 } = {}) {
  const xs = rts.filter((x) => Number.isFinite(x) && x >= 0);
  if (xs.length < 6) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  let steady = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - xs[i - 1]) < 80) steady++;
  return {
    actions: xs.length,
    median_ms: Math.round(sorted[Math.floor(sorted.length / 2)]),
    mean_ms: Math.round(mean),
    fastest_ms: Math.round(sorted[0]),
    spread_ms: Math.round(sd),
    share_of_actions_under_600_ms: Math.round((xs.filter((x) => x < 600).length / xs.length) * 100) / 100,
    share_of_consecutive_actions_with_nearly_identical_delay: Math.round((steady / (xs.length - 1)) * 100) / 100,
    turns_that_ran_out_of_time: timeouts,
    online_games_finished_in_the_last_hour: gamesLastHour,
  };
}
export async function judgeBot(apiKey, stats, url = JEV_URL) {
  const r = await callJev(apiKey, { context: BOT_CONTEXT, stats }, BOT_QUESTIONS, { url });
  return { scripted: noul(r.answers, 'looks_scripted'), model: r.model, usage: r.usage, payload: r.payload };
}

// ── 4. 卡牌合規＋嘲諷對稱（部署前檢查用）─────────
export const CONTENT_CONTEXT = 'This is one card from 藍綠攻防戰, a political-satire card game about the 2026 Taipei mayoral race. 萬安號 is a cartoon mascot for 蔣萬安 (KMT, blue camp); 伯洋號 is a cartoon mascot for 沈伯洋 (DPP, green camp). "Blue" cards are played by the 蔣萬安 side and "green" cards by the 沈伯洋 side; "shared" cards can be played by either.';
export const CONTENT_QUESTIONS = {
  quotes_real_person: {
    type: 'noul',
    instructions: 'Does `card` present words as something a real person said?',
    criteria: {
      true: 'The card text reads as a line spoken by a real politician, for example a quotation attributed to 蔣萬安 or 沈伯洋 or written in their voice.',
      false: 'The text is narration, a description, or a line from an anonymous or fictional speaker.',
    },
  },
  mocks_looks_family_health: { type: 'noul', instructions: 'Does `card` mock someone\'s looks, body, family, or health?' },
  demeans_group: {
    type: 'noul',
    instructions: 'Does `card` put down supporters of a party, an ethnic group, or people from a place?',
    criteria: {
      true: 'The card belittles a whole group, for example calling one camp\'s supporters sheep, brainwashed, or stupid.',
      false: 'The card shows supporters, volunteers, or staff doing campaign activities without belittling them, or does not mention any group.',
    },
  },
  asks_to_vote: { type: 'noul', instructions: 'Does `card` tell the reader to vote, or not to vote, for someone?' },
  states_real_event: {
    type: 'noul',
    instructions: 'Does `card` state a specific real-world event or action by a real person as fact?',
    criteria: {
      true: 'The card asserts that a named real person did a specific thing, for example "沈伯洋 was fined" or "蔣萬安 cancelled a project".',
      false: 'The card describes generic campaign activity or a fictional game effect.',
    },
  },
  pokes_blue: { type: 'noul', instructions: 'Does `card` poke fun at 蔣萬安, the KMT, or blue-camp supporters?' },
  pokes_green: { type: 'noul', instructions: 'Does `card` poke fun at 沈伯洋, the DPP, or green-camp supporters?' },
  harshness: {
    type: 'score',
    instructions: 'How harsh is any joke in `card`?',
    criteria: [
      'The card has no joke or teasing at all.',
      'Gentle, friendly teasing that the target could laugh along with.',
      'Pointed teasing about a well-known habit or speaking style.',
      'Harsh mockery that could embarrass or hurt the target.',
    ],
  },
};
export const CONTENT_RULES = [
  { key: 'quotes_real_person', label: '把話安在真實人物嘴上' },
  { key: 'mocks_looks_family_health', label: '嘲笑外貌、家人或健康' },
  { key: 'demeans_group', label: '貶低族群或支持者' },
  { key: 'asks_to_vote', label: '投票呼籲' },
  { key: 'states_real_event', label: '把真實事件當事實陳述' },
];
// 時事卡另外加問：指控真人做壞事、提到民調（11/18 起依選罷法不得出現）
export const NEWS_CONTEXT = ' This is a topical card about recent news; it lists its news sources, so it may mention a real event.';
export const NEWS_QUESTIONS = {
  accuses_wrongdoing: {
    type: 'noul',
    instructions: 'Does `card` accuse a real person or party of wrongdoing, such as breaking the law, corruption, or lying?',
    criteria: {
      true: 'The card says or implies that a real person or party did something illegal, corrupt, or dishonest.',
      false: 'The card describes an event or teases a habit without accusing anyone of wrongdoing.',
    },
  },
  mentions_polls: { type: 'noul', instructions: 'Does `card` mention opinion polls, poll numbers, or who is ahead in a poll?' },
};
export const NEWS_RULES = [
  { key: 'accuses_wrongdoing', label: '指控真人違法、貪腐或說謊' },
  { key: 'mentions_polls', label: '提到民調' },
];
export async function judgeCard(apiKey, card, url = JEV_URL, { news = false } = {}) {
  const questions = news ? { ...CONTENT_QUESTIONS, ...NEWS_QUESTIONS } : CONTENT_QUESTIONS;
  const context = news ? CONTENT_CONTEXT + NEWS_CONTEXT : CONTENT_CONTEXT;
  const r = await callJev(apiKey, { card, context }, questions, { url, timeoutMs: 10000 });
  const scores = {};
  for (const k of Object.keys(questions)) {
    if (questions[k].type === 'noul') scores[k] = noul(r.answers, k);
  }
  // 嘲諷強度：Score 的 score 是各級機率的加權平均（0＝沒有玩笑 … 3＝尖酸），保留分布方便檢查
  const h = r.answers.harshness;
  if (typeof h?.score !== 'number') throw new Error('jev bad score harshness');
  scores.harshness = h.score;
  return { scores, harshnessProbs: h.probabilities || {}, model: r.model, usage: r.usage, payload: r.payload };
}
