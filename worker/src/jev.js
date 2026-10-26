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

// 呼叫 Jev。失敗一律丟出錯誤（不要把失敗當成「不是吹牛」）。
export async function askJev(apiKey, facts, url = JEV_URL) {
  const payload = { model: JEV_MODEL, state: buildState(facts), questions: QUESTIONS };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), JEV_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`jev http ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    const p = d?.answers?.is_bluff?.noul;
    if (typeof p !== 'number' || p < 0 || p > 1) throw new Error('jev bad answer');
    return { bluff: p, model: d.model, usage: d.usage, payload };
  } finally {
    clearTimeout(timer);
  }
}
