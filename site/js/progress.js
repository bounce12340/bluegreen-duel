// 玩家進度：成就、累計統計、卡牌圖鑑、每日挑戰紀錄。全部只存在這台裝置的瀏覽器（localStorage），不上傳。
// 由 main.js 在每批事件播放時呼叫 track()，對局結束時呼叫 finishGame()；回傳新解鎖的成就讓畫面提示。

const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 無痕模式存不了就算了 */ } };

let stats = load('bg_stats', {});
let ach = load('bg_ach', {});
let seen = new Set(load('bg_seen_cards', []));
let daily = load('bg_daily', {});

// 成就清單（中文原文；英文在 i18n.js）
export const ACHIEVEMENTS = [
  { id: 'first_win', icon: '🎉', name: '初登場勝利', text: '贏得第一場對戰' },
  { id: 'win_both', icon: '⚖️', name: '兩邊都贏過', text: '分別用藍營與綠營各贏一場' },
  { id: 'catch_10', icon: '🔍', name: '抓包達人', text: '累計抓到 10 次吹牛' },
  { id: 'bluff_5', icon: '🃏', name: '臉不紅氣不喘', text: '累計 5 次吹牛成功過關' },
  { id: 'combo_1', icon: '🔗', name: '第一次連擊', text: '打出一次連擊' },
  { id: 'combo_10', icon: '⛓️', name: '連擊大師', text: '累計打出 10 次連擊' },
  { id: 'traps_3', icon: '🪤', name: '陷阱專家', text: '一局內觸發 3 次自己的陷阱' },
  { id: 'big_win', icon: '🏔️', name: '壓倒性勝利', text: '以 25 人以上的差距獲勝' },
  { id: 'comeback', icon: '🔄', name: '逆轉勝', text: '曾經落後 15 人以上還贏了' },
  { id: 'ult_all', icon: '🔥', name: '大絕招圖鑑', text: '六種大絕招都發動過' },
  { id: 'online_win', icon: '🌐', name: '線上勝利', text: '贏得一場線上對戰' },
  { id: 'daily_1', icon: '📅', name: '每日挑戰首勝', text: '贏下一次每日挑戰' },
  { id: 'daily_3', icon: '🗓️', name: '三天連勝', text: '連續 3 天贏下每日挑戰' },
  { id: 'all_policies', icon: '📜', name: '策略全制霸', text: '8 種競選策略都用過' },
  { id: 'all_venues', icon: '🎪', name: '跑遍全場', text: '7 種場地事件都遇過' },
  { id: 'gallery_all', icon: '📚', name: '圖鑑收集完成', text: '每一張卡都抽到過' },
];

export const getStats = () => stats;
export const unlocked = () => ach;
export const seenCards = () => seen;

function unlock(id, out) {
  if (ach[id]) return;
  ach[id] = Date.now();
  out.push(ACHIEVEMENTS.find((a) => a.id === id));
}
const add = (k, n = 1) => { stats[k] = (stats[k] || 0) + n; };
const addSet = (k, v) => { const a = new Set(stats[k] || []); a.add(v); stats[k] = [...a]; return a.size; };

// 一局內的暫存
let game = null;
export function startGame({ side, mode, daily: isDaily = false, date = null }) {
  game = { side, mode, daily: isDaily, date, traps: 0, maxBehind: 0, myBluff: false };
}
export const noteBluff = (isBluff) => { if (game) game.myBluff = isBluff; };
export function noteScore(me, opp) { if (game) game.maxBehind = Math.max(game.maxBehind, opp - me); }

// 處理一批事件；me＝我方陣營；allCardIds＝圖鑑總數用。回傳新解鎖的成就
export function track(events, me, totalCards) {
  const out = [];
  if (!game) return out;
  for (const ev of events) {
    switch (ev.type) {
      case 'draw': if (ev.side === me && ev.card) { seen.add(ev.card); if (seen.size >= totalCards) unlock('gallery_all', out); } break;
      case 'challenge':
        if (ev.side === me && ev.caught) { add('catches'); if (stats.catches >= 10) unlock('catch_10', out); }
        break;
      case 'pass': if (ev.side !== me && game.myBluff) { add('bluffs'); if (stats.bluffs >= 5) unlock('bluff_5', out); } break;
      case 'combo': if (ev.side === me) { add('combos'); unlock('combo_1', out); if (stats.combos >= 10) unlock('combo_10', out); } break;
      case 'trap': if (ev.side === me) { game.traps += 1; if (game.traps >= 3) unlock('traps_3', out); } break;
      case 'ult': if (ev.side === me && ev.ult) { if (addSet('ults', ev.ult) >= 6) unlock('ult_all', out); } break;
      case 'venue': if (ev.id) { if (addSet('venues', ev.id) >= 7) unlock('all_venues', out); } break;
      case 'policies': if (ev[me]) { if (addSet('policies', ev[me]) >= 8) unlock('all_policies', out); } break;
      default: break;
    }
  }
  persist();
  return out;
}

// 對局結束：result＝'win'|'loss'|'draw'；margin＝我方減對方
export function finishGame(result, margin) {
  const out = [];
  if (!game) return out;
  add('games');
  if (result === 'win') {
    add('wins');
    unlock('first_win', out);
    if (addSet('winSides', game.side) >= 2) unlock('win_both', out);
    if (margin >= 25) unlock('big_win', out);
    if (game.maxBehind >= 15) unlock('comeback', out);
    if (game.mode === 'online') unlock('online_win', out);
  }
  if (game.daily && game.date) {
    const d = daily[game.date] || { tries: 0, won: false, best: null };
    d.tries += 1;
    if (result === 'win') d.won = true;
    d.best = d.best === null ? margin : Math.max(d.best, margin);
    daily[game.date] = d;
    if (result === 'win') {
      unlock('daily_1', out);
      if (dailyStreak(game.date) >= 3) unlock('daily_3', out);
    }
    // 只留最近 60 天
    const keys = Object.keys(daily).sort();
    while (keys.length > 60) delete daily[keys.shift()];
  }
  game = null;
  persist();
  return out;
}

export function dailyRecord(date) { return daily[date] || null; }
// 到 date 為止連續贏下每日挑戰的天數
export function dailyStreak(date) {
  let n = 0;
  const d = new Date(`${date}T12:00:00+08:00`);
  for (;;) {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(d);
    if (!daily[key] || !daily[key].won) break;
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function persist() {
  save('bg_stats', stats);
  save('bg_ach', ach);
  save('bg_seen_cards', [...seen]);
  save('bg_daily', daily);
}

// 每日挑戰的種子：同一天（台北時間）大家都一樣
export function dailySeed(date) {
  let h = 2166136261;
  for (const ch of `bgd-${date}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// 每日挑戰的陣營：依日期輪流，大家同一天打同一邊
export const dailySide = (date) => (Number(date.slice(-2)) % 2 ? 'blue' : 'green');
