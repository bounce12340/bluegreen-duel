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
  asks_removal: { type: 'noul', instructions: 'Does `email` ask for the game, or something in it, to be taken down, removed, or changed?' },
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
};
// 判斷規則：任一緊急條件 ≥ 0.5 → 標「urgent」並轉寄作者；媒體來信也轉寄
export function mailDecision(scores) {
  const urgentKeys = ['asks_removal', 'speaks_for_official', 'mentions_legal', 'money_for_content'];
  const labels = [];
  const urgent = urgentKeys.some((k) => scores[k] >= 0.5);
  if (urgent) labels.push('urgent');
  if (scores.asks_removal >= 0.5) labels.push('takedown');
  if (scores.speaks_for_official >= 0.5) labels.push('official');
  if (scores.mentions_legal >= 0.5) labels.push('legal');
  if (scores.money_for_content >= 0.5) labels.push('conditional-sponsor');
  else if (scores.about_money >= 0.7) labels.push('sponsor');
  if (scores.reports_bug >= 0.7) labels.push('bug');
  if (scores.from_press >= 0.7) labels.push('press');
  if (scores.abusive >= 0.7) labels.push('abusive');
  if (!labels.length) labels.push('other');
  return { labels, forward: urgent || labels.includes('press'), urgent };
}
export async function judgeMail(apiKey, subject, body, url = JEV_URL) {
  const email = { subject: String(subject || '').slice(0, 300), body: String(body || '').slice(0, 6000) };
  const r = await callJev(apiKey, { email, context: MAIL_CONTEXT }, MAIL_QUESTIONS, { url, timeoutMs: 8000 });
  const scores = Object.fromEntries(Object.keys(MAIL_QUESTIONS).map((k) => [k, noul(r.answers, k)]));
  return { scores, ...mailDecision(scores), model: r.model, usage: r.usage };
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
export async function judgeCard(apiKey, card, url = JEV_URL) {
  const r = await callJev(apiKey, { card, context: CONTENT_CONTEXT }, CONTENT_QUESTIONS, { url, timeoutMs: 10000 });
  const scores = {};
  for (const k of Object.keys(CONTENT_QUESTIONS)) {
    if (CONTENT_QUESTIONS[k].type === 'noul') scores[k] = noul(r.answers, k);
  }
  // 嘲諷強度：Score 的 score 是各級機率的加權平均（0＝沒有玩笑 … 3＝尖酸），保留分布方便檢查
  const h = r.answers.harshness;
  if (typeof h?.score !== 'number') throw new Error('jev bad score harshness');
  scores.harshness = h.score;
  return { scores, harshnessProbs: h.probabilities || {}, model: r.model, usage: r.usage, payload: r.payload };
}
