// 藍綠對決連線伺服器：Cloudflare Worker + Durable Objects（WebSocket 休眠 API）
// - Lobby（單一實例）：隨機配對、開房、房間數上限
// - Room（一局一個）：伺服器權威，洗牌、抽牌、計時、結算都在這裡
// 休眠時記憶體會被清掉，所以整局狀態每次都寫進 storage，醒來再讀回來。
import { DurableObject } from 'cloudflare:workers';
import {
  createGame, playCard, endTurn, useUlt, enterBurst, takeEvents, finishByCount,
  declareCard, respond, hasStatus, RULES,
} from '../../site/js/engine.js';
import { checkName, cleanName } from '../../site/js/names.js';

const MAX_ROOMS = 200;
const TURN_MS = 30_000;           // 一回合只出一張牌，30 秒
const GRACE_MS = 1_000;            // 截止前 1 秒內送出的動作仍算數
const RESPOND_MS = RULES.respondSeconds * 1000; // 對手決定要不要質疑的時間（出牌方的回合計時暫停）
const DISCONNECT_MS = 30_000;      // 斷線超過 30 秒判負
const GAME_MAX_MS = 20 * 60_000;   // 單局最長 20 分鐘
const WAIT_ROOM_MS = 10 * 60_000;  // 開房後等朋友最多 10 分鐘
const CLEANUP_MS = 60_000;         // 結束後 1 分鐘清掉房間資料
const MATCH_FALLBACK_MS = 12_000;  // 等太久就不管陣營偏好，直接配
const CLOSED_DATES = ['2026-11-28'];
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const other = (s) => (s === 'blue' ? 'green' : 'blue');
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const taipeiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const randInt = () => crypto.getRandomValues(new Uint32Array(1))[0];
function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(5));
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}
const disabledCards = (env) => String(env.DISABLED_CARDS || '').split(',').map((s) => s.trim()).filter(Boolean);

function closedMessage(env) {
  if (env.MAINTENANCE === '1' || env.MAINTENANCE === 'true') return env.MAINTENANCE_MSG || '系統維護中，請稍後再來。';
  if (CLOSED_DATES.includes(taipeiToday())) return '依選罷法規定，投票日暫停服務。';
  return null;
}

function originAllowed(req, env) {
  const origin = req.headers.get('origin');
  if (!origin) return true; // 非瀏覽器或同源請求
  try {
    const host = new URL(origin).hostname;
    const allowed = String(env.ALLOWED_HOSTS || 'bluegreen-duel.pages.dev').split(',').map((s) => s.trim());
    return host === 'localhost' || host === '127.0.0.1'
      || allowed.some((h) => host === h || host.endsWith(`.${h}`));
  } catch { return false; }
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true; // 尚未設定驗證就略過
  if (!token) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const d = await r.json();
    return !!d.success;
  } catch { return false; }
}

const validPid = (pid) => typeof pid === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(pid);
const validSide = (s) => s === 'blue' || s === 'green';

// ── 入口 ───────────────────────────────────
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, '');
    if (!originAllowed(req, env)) return json({ error: 'forbidden' }, 403);

    if (path === '/status') {
      const msg = closedMessage(env);
      return json({
        online: true, maintenance: !!msg, msg,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
        disabledCards: disabledCards(env), serverNow: Date.now(),
      });
    }
    const msg = closedMessage(env);
    if (msg) return json({ error: 'closed', msg }, 503);

    const lobby = env.LOBBY.get(env.LOBBY.idFromName('main'));
    if (path === '/lobby' || path === '/create') return lobby.fetch(req);
    const m = path.match(/^\/room\/([A-Z0-9]{5})$/);
    if (m) return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
    return json({ error: 'not found' }, 404);
  },
};

// ── 配對大廳 ───────────────────────────────
export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async rooms() {
    const rooms = (await this.ctx.storage.get('rooms')) || {};
    // 自我修復：超過 35 分鐘的紀錄一定已經結束了
    const cutoff = Date.now() - (GAME_MAX_MS + WAIT_ROOM_MS + 5 * 60_000);
    for (const [k, t] of Object.entries(rooms)) if (t < cutoff) delete rooms[k];
    return rooms;
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/closed') && req.method === 'POST') {
      const { code } = await req.json();
      const rooms = await this.rooms();
      delete rooms[code];
      await this.ctx.storage.put('rooms', rooms);
      return json({ ok: true });
    }
    if (url.pathname.endsWith('/create') && req.method === 'POST') return this.createPrivate(req);
    if (req.headers.get('upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ waiting: false, ip: req.headers.get('cf-connecting-ip') || '' });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return json({ error: 'bad request' }, 400);
  }

  async createPrivate(req) {
    let b;
    try { b = await req.json(); } catch { return json({ error: '資料格式錯誤' }, 400); }
    const nameErr = checkName(b.name);
    if (nameErr) return json({ error: nameErr }, 400);
    if (!validPid(b.pid) || !validSide(b.side)) return json({ error: '資料格式錯誤' }, 400);
    if (!(await verifyTurnstile(this.env, b.turnstile, req.headers.get('cf-connecting-ip')))) return json({ error: '真人驗證失敗，請重試' }, 403);
    const rooms = await this.rooms();
    if (Object.keys(rooms).length >= MAX_ROOMS) return json({ error: '目前房間已滿，請稍後再試' }, 503);
    let code = newCode();
    while (rooms[code]) code = newCode();
    const room = this.env.ROOM.get(this.env.ROOM.idFromName(code));
    await room.fetch('https://room/setup', {
      method: 'POST',
      body: JSON.stringify({ code, mode: 'private', host: { pid: b.pid, name: cleanName(b.name), side: b.side } }),
    });
    rooms[code] = Date.now();
    await this.ctx.storage.put('rooms', rooms);
    return json({ code });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 4000) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t !== 'join') return;
    const att = ws.deserializeAttachment() || {};
    if (att.waiting) return;
    const err = checkName(m.name);
    if (err) { ws.send(JSON.stringify({ t: 'error', msg: err })); return; }
    if (!validPid(m.pid) || !validSide(m.side)) { ws.send(JSON.stringify({ t: 'error', msg: '資料格式錯誤' })); return; }
    if (!(await verifyTurnstile(this.env, m.turnstile, att.ip))) { ws.send(JSON.stringify({ t: 'error', msg: '真人驗證失敗，請重試' })); return; }
    ws.serializeAttachment({ waiting: true, pid: m.pid, name: cleanName(m.name), pref: m.side, joinedAt: Date.now() });
    ws.send(JSON.stringify({ t: 'waiting' }));
    await this.tryMatch(false);
  }

  waitingSockets() {
    return this.ctx.getWebSockets()
      .map((ws) => ({ ws, a: ws.deserializeAttachment() || {} }))
      .filter((x) => x.a.waiting)
      .sort((x, y) => x.a.joinedAt - y.a.joinedAt);
  }

  async tryMatch(fallback) {
    let list = this.waitingSockets();
    const now = Date.now();
    while (list.length >= 2) {
      const rooms = await this.rooms();
      if (Object.keys(rooms).length >= MAX_ROOMS) {
        for (const x of list) x.ws.send(JSON.stringify({ t: 'queue', msg: '目前房間已滿，排隊中…' }));
        break;
      }
      const a = list[0];
      let b = list.find((x) => x !== a && x.a.pref !== a.a.pref && x.a.pid !== a.a.pid);
      if (!b && fallback && now - a.a.joinedAt > MATCH_FALLBACK_MS) b = list.find((x) => x !== a && x.a.pid !== a.a.pid);
      if (!b) {
        // 第一位找不到對手，換下一位試
        const rest = list.slice(1);
        const pairable = rest.some((x) => rest.some((y) => y !== x && y.a.pref !== x.a.pref));
        if (!pairable) break;
        list = rest;
        continue;
      }
      // 陣營：先排隊的人照偏好
      const sideA = a.a.pref;
      const players = { [sideA]: { pid: a.a.pid, name: a.a.name }, [other(sideA)]: { pid: b.a.pid, name: b.a.name } };
      let code = newCode();
      while (rooms[code]) code = newCode();
      await this.env.ROOM.get(this.env.ROOM.idFromName(code)).fetch('https://room/setup', {
        method: 'POST', body: JSON.stringify({ code, mode: 'match', players }),
      });
      rooms[code] = Date.now();
      await this.ctx.storage.put('rooms', rooms);
      for (const [x, side] of [[a, sideA], [b, other(sideA)]]) {
        x.ws.serializeAttachment({ waiting: false });
        x.ws.send(JSON.stringify({ t: 'matched', code, side }));
        x.ws.close(1000, 'matched');
      }
      list = this.waitingSockets();
    }
    if (this.waitingSockets().length) await this.ctx.storage.setAlarm(Date.now() + 4000);
  }

  async alarm() { await this.tryMatch(true); }
  async webSocketClose(ws) { try { ws.close(); } catch { /* 已關閉 */ } }
  async webSocketError(ws) { try { ws.close(); } catch { /* 已關閉 */ } }
}

// ── 對局房間 ───────────────────────────────
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.r = null;
    this.rate = new Map(); // 每個連線每秒的訊息數（休眠後重置，無妨）
    // 心跳由執行環境直接回覆，不喚醒房間，也不計費
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async load() {
    if (!this.r) this.r = (await this.ctx.storage.get('r')) || null;
    return this.r;
  }

  async save() {
    await this.ctx.storage.put('r', this.r);
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    const r = this.r;
    const times = [];
    if (r.status === 'waiting') times.push(r.waitDeadline);
    if (r.status === 'playing') {
      if (r.state?.pending) times.push(r.respondDeadline + GRACE_MS, r.endAt);
      else times.push(r.turnDeadline + GRACE_MS, r.endAt);
      for (const t of Object.values(r.disconnects)) if (t) times.push(t + DISCONNECT_MS);
    }
    if (r.status === 'over') times.push(r.cleanupAt);
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/setup' && req.method === 'POST') {
      const b = await req.json();
      const now = Date.now();
      this.r = {
        code: b.code, mode: b.mode, createdAt: now, status: 'waiting', state: null,
        players: { blue: null, green: null }, disconnects: { blue: null, green: null },
        waitDeadline: now + WAIT_ROOM_MS, turnDeadline: 0, endAt: 0, cleanupAt: 0,
      };
      if (b.mode === 'match') { this.r.players = b.players; this.startGame(); }
      else this.r.players[b.host.side] = { pid: b.host.pid, name: b.host.name };
      await this.save();
      return json({ ok: true });
    }

    if (req.headers.get('upgrade') !== 'websocket') return json({ error: 'bad request' }, 400);
    const r = await this.load();
    const pid = url.searchParams.get('pid');
    const pair = new WebSocketPair();
    const reject = (msg) => {
      this.ctx.acceptWebSocket(pair[1], ['reject']);
      pair[1].send(JSON.stringify({ t: 'error', msg, fatal: true }));
      pair[1].close(4003, 'rejected');
      return new Response(null, { status: 101, webSocket: pair[0] });
    };
    if (!r) return reject('找不到這個房號');
    if (!validPid(pid)) return reject('資料格式錯誤');

    let side = ['blue', 'green'].find((s) => r.players[s] && r.players[s].pid === pid);
    if (!side) {
      // 新玩家加入朋友房
      if (r.status !== 'waiting') return reject('這個房間已經開始或結束了');
      const name = url.searchParams.get('name');
      const err = checkName(name);
      if (err) return reject(err);
      side = ['blue', 'green'].find((s) => !r.players[s]);
      r.players[side] = { pid, name: cleanName(name) };
      this.startGame();
    }

    // 同一個玩家只保留最新的連線
    for (const old of this.ctx.getWebSockets(side)) { try { old.close(4001, 'replaced'); } catch { /* 忽略 */ } }
    this.ctx.acceptWebSocket(pair[1], [side]);
    pair[1].serializeAttachment({ side });
    r.joined = r.joined || { blue: false, green: false };
    const wasAway = r.joined[side] && !!r.disconnects[side]; // 第一次連進來不算「回來」
    r.joined[side] = true;
    r.disconnects[side] = null;
    await this.save();
    // 101 回應送出後再推畫面
    this.ctx.waitUntil((async () => {
      this.sendView(side, []);
      if (wasAway) this.sendTo(other(side), { t: 'opp', status: 'back' });
      if (r.status === 'playing' && !wasAway) this.broadcast([]);
    })());
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  startGame() {
    const now = Date.now();
    // 還沒連進來的玩家先當作斷線：30 秒內沒出現就判負，避免對手對著空位玩 20 分鐘
    this.r.joined = this.r.joined || { blue: false, green: false };
    for (const side of ['blue', 'green']) {
      if (!this.ctx.getWebSockets(side).length) this.r.disconnects[side] = now;
    }
    this.r.state = createGame({ seed: randInt(), disabledCards: disabledCards(this.env) });
    takeEvents(this.r.state);
    this.r.status = 'playing';
    this.r.turnDeadline = now + TURN_MS;
    this.r.endAt = now + GAME_MAX_MS;
  }

  // 給某一方看的畫面：藏住對手手牌、蓋牌與亂數狀態
  view(side) {
    const r = this.r;
    const base = {
      code: r.code, status: r.status, you: side, serverNow: Date.now(),
      deadline: r.turnDeadline, names: { blue: r.players.blue?.name || null, green: r.players.green?.name || null },
      oppAway: r.disconnects[other(side)] ? r.disconnects[other(side)] + DISCONNECT_MS : null,
    };
    if (!r.state) return base;
    const s = structuredClone(r.state);
    delete s.rngState; delete s.seed; delete s.events; delete s.log; // log 可能含對手棄牌名稱
    const opp = s.players[other(side)];
    opp.hand = opp.hand.map(() => ({ hidden: true }));
    if (!hasStatus(opp, 'exposed')) opp.traps = opp.traps.map(() => ({ hidden: true }));
    if (s.pending && s.pending.side !== side) delete s.pending.cardId;
    return { ...base, state: s, respondDeadline: s.pending ? r.respondDeadline : null };
  }

  filterEvents(events, side) {
    return events.map((ev) => {
      if ((ev.type === 'draw' || ev.type === 'discard') && ev.side !== side) return { type: ev.type, side: ev.side };
      return ev;
    });
  }

  sendTo(side, msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(side)) { try { ws.send(data); } catch { /* 對方剛斷線 */ } }
  }
  sendView(side, events) { this.sendTo(side, { t: 'view', view: this.view(side), events: this.filterEvents(events, side) }); }
  broadcast(events) { for (const s of ['blue', 'green']) this.sendView(s, events); }

  allow(side) {
    const now = Math.floor(Date.now() / 1000);
    const k = `${side}:${now}`;
    const n = (this.rate.get(k) || 0) + 1;
    this.rate.set(k, n);
    if (this.rate.size > 20) for (const key of this.rate.keys()) if (!key.endsWith(`:${now}`)) this.rate.delete(key);
    return n <= 8;
  }

  async webSocketMessage(ws, raw) {
    const att = ws.deserializeAttachment() || {};
    const side = att.side;
    if (!validSide(side) || typeof raw !== 'string' || raw.length > 500) return;
    if (!this.allow(side)) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'ping') { ws.send(JSON.stringify({ t: 'pong', now: Date.now() })); return; }

    const r = await this.load();
    if (!r || r.status !== 'playing') return;
    const s = r.state;
    const now = Date.now();
    const turnBefore = s.turnIndex;

    // 對手回應蓋牌宣告（不是自己的回合也能送）
    if (m.t === 'respond') {
      if (!s.pending || s.pending.side === side || now > r.respondDeadline + GRACE_MS) return;
      respond(s, side, !!m.challenge);
      this.resumeTurnClock(now);
      await this.afterChange(turnBefore);
      return;
    }

    if (s.current !== side) return ws.send(JSON.stringify({ t: 'error', msg: '還沒輪到你' }));
    if (s.pending) return ws.send(JSON.stringify({ t: 'error', msg: '等對手決定要不要質疑' }));
    if (now > r.turnDeadline + GRACE_MS) return; // 已逾時，等鬧鐘自動結束回合

    let ok = false;
    if (m.t === 'play') ok = playCard(s, side, Number(m.uid));
    else if (m.t === 'declare') {
      ok = declareCard(s, side, Number(m.uid), String(m.as));
      if (ok) { r.respondDeadline = now + RESPOND_MS; r.pauseAt = now; }
    } else if (m.t === 'end') { endTurn(s); ok = true; }
    else if (m.t === 'ult') ok = useUlt(s, side, String(m.id));
    else if (m.t === 'burst') ok = enterBurst(s, side);
    if (!ok) return ws.send(JSON.stringify({ t: 'error', msg: '這個動作現在不能做' }));
    await this.afterChange(turnBefore);
  }

  // 等待質疑的時間不算在出牌方的 60 秒裡
  resumeTurnClock(now) {
    const r = this.r;
    if (r.pauseAt) r.turnDeadline += now - r.pauseAt;
    r.pauseAt = 0;
    r.respondDeadline = 0;
  }

  async afterChange(turnBefore) {
    const r = this.r;
    const s = r.state;
    const events = takeEvents(s);
    if (s.turnIndex !== turnBefore) r.turnDeadline = Date.now() + TURN_MS;
    if (s.over) await this.finish();
    else await this.save();
    this.broadcast(events);
  }

  async finish() {
    const r = this.r;
    r.status = 'over';
    r.cleanupAt = Date.now() + CLEANUP_MS;
    await this.save();
    try {
      await this.env.LOBBY.get(this.env.LOBBY.idFromName('main')).fetch('https://lobby/closed', {
        method: 'POST', body: JSON.stringify({ code: r.code }),
      });
    } catch { /* 大廳會自己清掉過期紀錄 */ }
  }

  async alarm() {
    const r = await this.load();
    if (!r) return;
    const now = Date.now();
    if (r.status === 'waiting' && now >= r.waitDeadline) {
      this.sendTo('blue', { t: 'error', msg: '等太久了，房間已關閉', fatal: true });
      this.sendTo('green', { t: 'error', msg: '等太久了，房間已關閉', fatal: true });
      await this.finish();
      return;
    }
    if (r.status === 'playing') {
      const s = r.state;
      const turnBefore = s.turnIndex;
      const gone = ['blue', 'green'].find((x) => r.disconnects[x] && now >= r.disconnects[x] + DISCONNECT_MS);
      if (gone) {
        s.over = true; s.winner = other(gone); s.reason = '對手未連線或斷線超過 30 秒';
        s.events.push({ type: 'gameOver', winner: s.winner });
      } else if (s.pending && now >= r.respondDeadline + GRACE_MS) {
        respond(s, other(s.pending.side), false);
        s.events.push({ type: 'timeout', side: other(s.current), msg: '沒有回應，視同放行' });
        this.resumeTurnClock(now);
      } else if (s.pending) {
        // 還在等回應，什麼都不做
      } else if (now >= r.endAt) {
        finishByCount(s);
        s.reason = `對局超過 20 分鐘，${s.reason}`;
      } else if (now >= r.turnDeadline + GRACE_MS) {
        s.events.push({ type: 'timeout', side: s.current, msg: '時間到，自動結束回合' });
        endTurn(s);
      }
      await this.afterChange(turnBefore);
      return;
    }
    if (r.status === 'over' && now >= r.cleanupAt) {
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, 'room closed'); } catch { /* 忽略 */ } }
      await this.ctx.storage.deleteAll();
      this.r = null;
      return;
    }
    await this.scheduleAlarm();
  }

  async webSocketClose(ws) {
    const att = ws.deserializeAttachment() || {};
    const side = att.side;
    if (!validSide(side)) return;
    const r = await this.load();
    if (!r || r.status !== 'playing') return;
    const stillHere = this.ctx.getWebSockets(side).some((x) => x !== ws && x.readyState === 1);
    if (stillHere) return;
    r.disconnects[side] = Date.now();
    await this.save();
    this.sendTo(other(side), { t: 'opp', status: 'left', until: r.disconnects[side] + DISCONNECT_MS });
  }

  async webSocketError(ws) { await this.webSocketClose(ws); }
}
