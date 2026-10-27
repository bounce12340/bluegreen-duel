// 藍綠攻防戰連線伺服器：Cloudflare Worker + Durable Objects（WebSocket 休眠 API）
// - Lobby（單一實例）：隨機配對、開房、房間數上限
// - Room（一局一個）：伺服器權威，洗牌、抽牌、計時、結算都在這裡
// 休眠時記憶體會被清掉，所以整局狀態每次都寫進 storage，醒來再讀回來。
import { DurableObject } from 'cloudflare:workers';
import {
  createGame, playCard, endTurn, useUlt, enterBurst, takeEvents, finishByCount, choosePolicy,
  declareCard, respond, hasStatus, RULES,
} from '../../site/js/engine.js';
import { checkName, cleanName } from '../../site/js/names.js';
import { parseFacts, askJev, judgeNickname, nicknameDecision, NICKNAME_QVER, parseMood, judgeMood, judgeMail, REPORT_CONTEXT, botStats, judgeBot } from './jev.js';
import { triageInbox, digestInbox, sendToOwner, formatReport } from './mail.js';
const DIGEST_CRON = '0 13 * * *'; // 要和 wrangler.toml 的 crons 一致

const MAX_ROOMS = 200;
const TURN_MS = 30_000;           // 一回合只出一張牌，30 秒
const GRACE_MS = 1_000;            // 截止前 1 秒內送出的動作仍算數
const RESPOND_MS = RULES.respondSeconds * 1000; // 對手決定要不要質疑的時間（出牌方的回合計時暫停）
const POLICY_MS = RULES.policySeconds * 1000;    // 開局選競選策略的時間，時間到自動選第一張
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

// IP 只存雜湊（每天換鹽，隔天就對不起來），只用來計算「近一小時場數」（換識別碼重開也算得到），不用來擋人
async function ipHash(ip) {
  const data = new TextEncoder().encode(`${ip || 'unknown'}|${taipeiToday()}|bluegreen`);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 機器人閘門：只有被 Jev 判為「像腳本」的玩家才需要處理，一般玩家完全不受影響。
// 有設 Turnstile → 要求做一次真人驗證，通過就解除；沒設 → 線上對戰暫停一段時間（還能跟電腦玩）。
// 回傳 null＝放行；否則 { code, msg }
async function botGate(env, pid, ip, token) {
  try {
    const gate = env.JEV_GATE.get(env.JEV_GATE.idFromName('global'));
    const ih = await ipHash(ip);
    const d = await (await gate.fetch('https://gate/flag/check', { method: 'POST', body: JSON.stringify({ pid, ih }) })).json();
    if (!d.flagged) return null;
    if (env.TURNSTILE_SECRET) {
      if (token && await verifyTurnstile(env, token, ip)) {
        await gate.fetch('https://gate/flag/clear', { method: 'POST', body: JSON.stringify({ pid, ih }) });
        return null;
      }
      return { code: 'verify', msg: '請先完成真人驗證' };
    }
    const hhmm = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d.until));
    return { code: 'cooldown', msg: `系統偵測到不像真人的操作，線上對戰暫停到 ${hhmm}，先跟電腦玩吧` };
  } catch {
    return null; // 檢查本身出錯時放行，不影響一般玩家
  }
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
        online: true, maintenance: !!msg, msg, jev: jevEnabled(env),
        turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
        disabledCards: disabledCards(env), serverNow: Date.now(),
      });
    }
    const msg = closedMessage(env);
    if (msg) return json({ error: 'closed', msg }, 503);

    // 電腦對手的 Jev 判斷：所有請求都經過同一個計數器（頻率限制＋每日上限）
    if ((path === '/ai/read' || path === '/ai/mood') && req.method === 'POST') {
      if (!jevEnabled(env)) return json({ error: 'jev disabled' }, 503);
      return env.JEV_GATE.get(env.JEV_GATE.idFromName('global')).fetch(req);
    }

    // 遊戲內「回報問題」：不論 Jev 有沒有開都收（沒開就全部留到晚上彙整）
    if (path === '/report' && req.method === 'POST') {
      return env.JEV_GATE.get(env.JEV_GATE.idFromName('global')).fetch(req);
    }

    const lobby = env.LOBBY.get(env.LOBBY.idFromName('main'));
    if (path === '/lobby' || path === '/create') return lobby.fetch(req);
    const m = path.match(/^\/room\/([A-Z0-9]{5})$/);
    if (m) return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
    return json({ error: 'not found' }, 404);
  },

  // 排程：每 5 分鐘信箱分流；每天 UTC 13:00（台北 21:00）寄一般來信彙整。沒設定 AgentMail 就不動作。
  async scheduled(event, env, ctx) {
    if (event.cron === DIGEST_CRON) {
      ctx.waitUntil((async () => {
        const gate = env.JEV_GATE.get(env.JEV_GATE.idFromName('global'));
        const { reports = [] } = await (await gate.fetch('https://gate/reports/list')).json();
        const r = await digestInbox(env, { reports });
        // 寄出成功才刪，失敗就留到明天再寄
        if (r.sent && reports.length) {
          await gate.fetch('https://gate/reports/delete', { method: 'POST', body: JSON.stringify({ keys: reports.map((x) => x.key) }) });
        }
        console.log(JSON.stringify({ mail: 'digest', ...r }));
      })().catch((e) => console.log(JSON.stringify({ mail: 'digest-error', error: String(e).slice(0, 300) }))));
      return;
    }
    if (!jevEnabled(env)) return;
    ctx.waitUntil(triageInbox(env, { jevUrl: env.JEV_URL_OVERRIDE || undefined }).then((r) => {
      if (r.checked) console.log(JSON.stringify({ mail: 'run', ...r }));
    }).catch((e) => console.log(JSON.stringify({ mail: 'run-error', error: String(e).slice(0, 300) }))));
  },
};

// ── Jev 判斷閘門：頻率限制、每日上限、呼叫 API ─────────
// 開關：JEV_ENABLED 寫在 wrangler.toml；緊急關閉在後台設 JEV_DISABLED=1（不會被部署蓋掉）
const jevEnabled = (env) => env.JEV_ENABLED === '1' && env.JEV_DISABLED !== '1' && !!env.TYPESAFE_API_KEY;

export class JevGate extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.perIp = new Map(); // ip → { minute, n }（休眠後重置，無妨）
  }

  // 頻率限制＋每日上限；通過回傳 null，否則回傳 429
  async admit(ip) {
    const env = this.env;
    const minute = Math.floor(Date.now() / 60_000);
    const rec = this.perIp.get(ip);
    const perMin = Number(env.JEV_PER_IP_PER_MIN || 20);
    if (rec && rec.minute === minute && rec.n >= perMin) return json({ error: 'rate limited' }, 429);
    this.perIp.set(ip, rec && rec.minute === minute ? { minute, n: rec.n + 1 } : { minute, n: 1 });
    if (this.perIp.size > 5000) this.perIp.clear();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    const key = `count:${day}`;
    const used = (await this.ctx.storage.get(key)) || 0;
    if (used >= Number(env.JEV_DAILY_CAP || 50000)) return json({ error: 'daily cap reached' }, 429);
    await this.ctx.storage.put(key, used + 1);
    return null;
  }

  // 遊戲內回報：同一個 IP 10 分鐘最多 3 則、全站每天最多 300 則
  async report(req) {
    const env = this.env;
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    let rep;
    try { rep = parseReport(await req.json()); } catch { rep = null; }
    if (!rep) return json({ error: '內容格式不對，請寫 2～1000 字' }, 400);
    const slot = Math.floor(Date.now() / 600_000);
    const k = `${ip}:${slot}`;
    this.reportRate = this.reportRate || new Map();
    const n = (this.reportRate.get(k) || 0) + 1;
    if (n > 3) return json({ error: '回報太頻繁了，請過幾分鐘再試' }, 429);
    this.reportRate.set(k, n);
    if (this.reportRate.size > 2000) this.reportRate.clear();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    const used = (await this.ctx.storage.get(`reports:${day}`)) || 0;
    if (used >= 300) return json({ error: '今天的回報已經很多了，明天再試，或寄信到聯絡信箱' }, 429);
    await this.ctx.storage.put(`reports:${day}`, used + 1);

    let result = null;
    if (jevEnabled(env) && !(await this.admit(ip))) {
      try {
        result = await judgeMail(env.TYPESAFE_API_KEY, '遊戲內回報', rep.text, env.JEV_URL_OVERRIDE || undefined, { context: REPORT_CONTEXT });
      } catch (e) {
        console.log(JSON.stringify({ report: 'jev-error', error: String(e).slice(0, 300) }));
      }
    }
    // Jev 失敗或沒開：不當成「不重要」，標成待確認、留到晚上彙整（不即時轉寄，避免被灌爆信箱）
    const labels = result ? result.labels : ['unclassified'];
    const level = result ? result.level : 1;
    const item = { text: rep.text, diag: rep.diag, labels, level, at: Date.now() };
    if (level >= 2) {
      const tag = labels.includes('critical') ? '特急' : labels.includes('urgent') ? '緊急' : labels.includes('press') ? '媒體' : '待處理';
      const why = result ? [`緊急度 ${result.scores.urgency.toFixed(1)} / 3`, ...Object.entries(result.scores)
        .filter(([key, v]) => key !== 'urgency' && v >= 0.5).map(([key, v]) => `${key} ${v.toFixed(2)}`)].join('、') : '';
      try {
        await sendToOwner(env, `【${tag}】藍綠攻防戰遊戲內回報：${rep.text.replace(/\s+/g, ' ').slice(0, 30)}`,
          `自動分流結果：${labels.join('、')}\n判斷依據：${why}\n\n${formatReport(item)}`);
        console.log(JSON.stringify({ report: 'forwarded', labels }));
        return json({ ok: true });
      } catch (e) {
        console.log(JSON.stringify({ report: 'forward-error', error: String(e).slice(0, 300) }));
        // 寄不出去就留到彙整，至少不會遺失
      }
    }
    await this.ctx.storage.put(`report:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, item);
    console.log(JSON.stringify({ report: 'stored', labels }));
    return json({ ok: true });
  }

  // 一局線上對戰結束：算反應時間統計 → Jev 判斷 → 0.7 以上就標記（程式決定）
  async botCheck(req) {
    const env = this.env;
    const { pid, ih, rt, timeouts } = await req.json();
    if (!validPid(pid) || !Array.isArray(rt)) return json({ error: 'bad request' }, 400);
    // 近一小時完成的線上場數（同一個識別碼或同一個 IP 雜湊，取多的）；放記憶體，休眠後重算無妨
    const now = Date.now();
    this.recentGames = this.recentGames || new Map();
    const bump = (k) => {
      const list = (this.recentGames.get(k) || []).filter((t) => now - t < 3600_000);
      list.push(now);
      this.recentGames.set(k, list);
      return list.length;
    };
    const gamesLastHour = Math.max(bump(`p:${pid}`), ih ? bump(`i:${ih}`) : 0);
    if (this.recentGames.size > 5000) this.recentGames.clear();
    const stats = botStats(rt.slice(-80).map(Number), { timeouts: Number(timeouts) || 0, gamesLastHour });
    if (!stats) return json({ skipped: 'too few actions' });
    if (await this.admit('bot-check')) return json({ skipped: 'rate' });
    try {
      const r = await judgeBot(env.TYPESAFE_API_KEY, stats, env.JEV_URL_OVERRIDE || undefined);
      console.log(JSON.stringify({ jev: 'bot', scripted: r.scripted, stats, usage: r.usage }));
      if (r.scripted >= 0.7) {
        const until = now + (env.TURNSTILE_SECRET ? 24 * 3600_000 : 30 * 60_000);
        await this.ctx.storage.put(`flag:p:${pid}`, { until, score: r.scripted });
      }
      return json({ scripted: r.scripted });
    } catch (e) {
      // 判斷失敗不標記（不能把失敗當成「是機器人」）
      console.log(JSON.stringify({ jev: 'bot-error', error: String(e).slice(0, 300) }));
      return json({ error: 'jev unavailable' }, 502);
    }
  }

  async fetch(req) {
    const env = this.env;
    const url = new URL(req.url);
    // JEV_URL_OVERRIDE 只給本機測試用（假的 Jev 伺服器）；正式環境不設
    const jevUrl = env.JEV_URL_OVERRIDE || undefined;

    // 遊戲內回報：彙整用的清單與刪除（排程內部呼叫）
    if (url.pathname === '/reports/list') {
      const all = await this.ctx.storage.list({ prefix: 'report:' });
      const cutoff = Date.now() - 7 * 86400_000;
      const reports = [];
      for (const [key, v] of all) {
        if (v.at < cutoff) await this.ctx.storage.delete(key); // 超過 7 天沒寄出就丟掉
        else reports.push({ key, ...v });
      }
      return json({ reports });
    }
    if (url.pathname === '/reports/delete' && req.method === 'POST') {
      const { keys } = await req.json();
      if (Array.isArray(keys) && keys.length) await this.ctx.storage.delete(keys.filter((k) => String(k).startsWith('report:')).slice(0, 128));
      return json({ ok: true });
    }
    if (url.pathname.endsWith('/report') && req.method === 'POST') return this.report(req);

    // 機器人標記：查詢、解除、對局結束後判斷（都是內部呼叫）
    if (url.pathname === '/flag/check') {
      const { pid, ih } = await req.json();
      const now = Date.now();
      // 只看玩家識別碼。不用 IP 擋人：手機網路、學校、公司常常很多人共用同一個 IP，會誤傷真人
      const f = await this.ctx.storage.get(`flag:p:${pid}`);
      if (f && f.until > now) return json({ flagged: true, until: f.until });
      if (f) await this.ctx.storage.delete(`flag:p:${pid}`);
      return json({ flagged: false });
    }
    if (url.pathname === '/flag/clear') {
      const { pid, ih } = await req.json();
      await this.ctx.storage.delete(`flag:p:${pid}`);
      return json({ ok: true });
    }
    if (url.pathname === '/bot/check') return this.botCheck(req);

    // 暱稱審核（大廳與房間內部呼叫）：先查快取，同一個暱稱 7 天內不重問
    if (url.pathname === '/nickname') {
      const { name, ip } = await req.json();
      const ck = `nick:${NICKNAME_QVER}:${name}`;
      const cached = await this.ctx.storage.get(ck);
      if (cached && cached.scores && Date.now() - cached.at < 7 * 86400_000) return json({ ...nicknameDecision(cached.scores), cached: true });
      const blocked = await this.admit(ip || 'unknown');
      if (blocked) return json({ ok: true, unchecked: true, reason: 'rate' }); // 超過頻率就只靠關鍵字
      try {
        const r = await judgeNickname(env.TYPESAFE_API_KEY, name, jevUrl);
        await this.ctx.storage.put(ck, { scores: r.scores, at: Date.now() });
        console.log(JSON.stringify({ jev: 'nickname', ok: r.ok, scores: r.scores, usage: r.usage }));
        return json({ ok: r.ok, msg: r.msg });
      } catch (e) {
        // 失敗不是「通過」也不是「擋下」：記錄錯誤，這次只靠關鍵字過濾，讓玩家能繼續玩
        console.log(JSON.stringify({ jev: 'nickname-error', error: String(e).slice(0, 300) }));
        return json({ ok: true, unchecked: true, reason: 'error' });
      }
    }

    const blocked = await this.admit(req.headers.get('cf-connecting-ip') || 'unknown');
    if (blocked) return blocked;

    // 玩家心情（對戰電腦打完一局後）：Jev 判斷，前端決定電腦要不要放水
    if (url.pathname.endsWith('/ai/mood')) {
      let mood;
      try { mood = parseMood(await req.json()); } catch { mood = null; }
      if (!mood) return json({ error: 'bad request' }, 400);
      try {
        const r = await judgeMood(env.TYPESAFE_API_KEY, mood, jevUrl);
        console.log(JSON.stringify({ jev: 'mood', frustrated: r.frustrated, tooEasy: r.tooEasy, usage: r.usage, payload: r.payload }));
        return json({ frustrated: r.frustrated, tooEasy: r.tooEasy, model: r.model });
      } catch (e) {
        console.log(JSON.stringify({ jev: 'mood-error', error: String(e).slice(0, 300) }));
        return json({ error: 'jev unavailable' }, 502);
      }
    }

    // 電腦對手的吹牛判斷（玩家瀏覽器呼叫）
    let facts;
    try { facts = parseFacts(await req.json()); } catch { facts = null; }
    if (!facts) return json({ error: 'bad request' }, 400);
    try {
      const r = await askJev(env.TYPESAFE_API_KEY, facts, jevUrl);
      // 記錄完整請求內容（不含個資），方便日後重跑與除錯
      console.log(JSON.stringify({ jev: 'ok', model: r.model, bluff: r.bluff, usage: r.usage, payload: r.payload }));
      return json({ bluff: r.bluff, model: r.model });
    } catch (e) {
      console.log(JSON.stringify({ jev: 'error', error: String(e).slice(0, 300), facts }));
      return json({ error: 'jev unavailable' }, 502);
    }
  }
}

// 遊戲內回報的格式檢查：文字 2～1000 字；遊戲狀態只收固定欄位的短字串或數字（不收任何識別資料）
const DIAG_KEYS = ['mode', 'side', 'round', 'blue', 'green', 'over', 'pending', 'viewport', 'browser', 'os', 'inApp', 'ease'];
function parseReport(b) {
  if (!b || typeof b !== 'object' || typeof b.text !== 'string') return null;
  const text = b.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if ([...text].length < 2 || [...text].length > 1000) return null;
  const diag = {};
  if (b.diag && typeof b.diag === 'object') {
    for (const k of DIAG_KEYS) {
      const v = b.diag[k];
      if (typeof v === 'number' && Number.isFinite(v)) diag[k] = Math.round(v);
      else if (typeof v === 'boolean') diag[k] = v;
      else if (typeof v === 'string') diag[k] = v.replace(/[^\w .x:/-]/g, '').slice(0, 24);
    }
  }
  return { text, diag };
}

// 暱稱審核：關鍵字（免費、即時）→ Jev（有開才問）。回傳錯誤訊息，合格回傳 null
async function moderateName(env, name, ip) {
  const err = checkName(name);
  if (err) return err;
  if (!jevEnabled(env)) return null;
  try {
    const r = await env.JEV_GATE.get(env.JEV_GATE.idFromName('global')).fetch('https://gate/nickname', {
      method: 'POST', body: JSON.stringify({ name: cleanName(name), ip }),
    });
    const d = await r.json();
    return d.ok ? null : d.msg;
  } catch {
    return null;
  }
}

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
    if (!validPid(b.pid) || !validSide(b.side)) return json({ error: '資料格式錯誤' }, 400);
    const nameErr = await moderateName(this.env, b.name, req.headers.get('cf-connecting-ip'));
    if (nameErr) return json({ error: nameErr }, 400);
    const bot = await botGate(this.env, b.pid, req.headers.get('cf-connecting-ip'), b.turnstile);
    if (bot) return json({ error: bot.msg, code: bot.code }, 403);
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
    if (!validPid(m.pid) || !validSide(m.side)) { ws.send(JSON.stringify({ t: 'error', msg: '資料格式錯誤' })); return; }
    const err = await moderateName(this.env, m.name, att.ip);
    if (err) { ws.send(JSON.stringify({ t: 'error', msg: err })); return; }
    const bot = await botGate(this.env, m.pid, att.ip, m.turnstile);
    if (bot) { ws.send(JSON.stringify({ t: 'error', msg: bot.msg, code: bot.code })); return; }
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
    const reject = (msg, code) => {
      this.ctx.acceptWebSocket(pair[1], ['reject']);
      pair[1].send(JSON.stringify({ t: 'error', msg, fatal: true, code }));
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
      const err = await moderateName(this.env, name, req.headers.get('cf-connecting-ip'));
      if (err) return reject(err);
      const bot = await botGate(this.env, pid, req.headers.get('cf-connecting-ip'), url.searchParams.get('ts'));
      if (bot) return reject(bot.msg, bot.code);
      if (this.r.status !== 'waiting') return reject('這個房間已經開始或結束了'); // 審核期間被別人搶先
      side = ['blue', 'green'].find((s) => !r.players[s]);
      r.players[side] = { pid, name: cleanName(name) };
      this.startGame();
    }

    // 同一個玩家只保留最新的連線
    for (const old of this.ctx.getWebSockets(side)) { try { old.close(4001, 'replaced'); } catch { /* 忽略 */ } }
    this.ctx.acceptWebSocket(pair[1], [side]);
    pair[1].serializeAttachment({ side });
    if (!r.players[side].ih) r.players[side].ih = await ipHash(req.headers.get('cf-connecting-ip'));
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
    this.r.state = createGame({ seed: randInt(), disabledCards: disabledCards(this.env), today: taipeiToday() });
    takeEvents(this.r.state);
    this.r.status = 'playing';
    // 反應時間紀錄（機器人判斷用）：輪到某一方可以動作的時間點，以及每個動作花了多久
    this.r.rt = { blue: [], green: [] };
    this.r.actStart = { blue: 0, green: 0 };
    this.r.timeouts = { blue: 0, green: 0 };
    this.r.turnDeadline = now + POLICY_MS; // 先選競選策略
    this.r.policyDeadline = now + POLICY_MS;
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
    // 選策略階段：看不到對手可選的策略，也看不到對手選了哪張（只知道選好了沒）
    if (s.phase === 'policy') {
      delete s.offers[other(side)];
      opp.policy = opp.policy ? 'chosen' : null;
    } else delete s.offers;
    return { ...base, state: s, respondDeadline: s.pending ? r.respondDeadline : null, policyDeadline: s.phase === 'policy' ? r.policyDeadline : null };
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

    // 開局選競選策略（雙方同時選）
    if (m.t === 'policy') {
      if (s.phase !== 'policy' || now > r.policyDeadline + GRACE_MS) return;
      if (!choosePolicy(s, side, String(m.id))) return ws.send(JSON.stringify({ t: 'error', msg: '這個動作現在不能做' }));
      if (s.phase === 'play') this.policiesDone(now);
      await this.afterChange(turnBefore);
      return;
    }
    if (s.phase === 'policy') return;

    // 對手回應蓋牌宣告（不是自己的回合也能送）
    if (m.t === 'respond') {
      if (!s.pending || s.pending.side === side || now > r.respondDeadline + GRACE_MS) return;
      this.recordReaction(side, now);
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
    this.recordReaction(side, now);
    if (m.t === 'declare' && r.actStart) r.actStart[other(side)] = now; // 對手開始想要不要質疑
    await this.afterChange(turnBefore);
  }

  // 雙方都選好策略：開始第一回合的計時
  policiesDone(now) {
    const r = this.r;
    r.turnDeadline = now + TURN_MS;
    r.policyDeadline = 0;
    if (r.actStart) r.actStart[r.state.current] = now;
  }

  // 記一個動作的反應時間；同一回合的下一個動作從現在開始算
  recordReaction(side, now) {
    const r = this.r;
    if (!r.rt || !r.actStart) return;
    if (r.actStart[side]) {
      r.rt[side].push(now - r.actStart[side]);
      if (r.rt[side].length > 80) r.rt[side].shift();
    }
    r.actStart[side] = now;
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
    if (s.turnIndex !== turnBefore) {
      r.turnDeadline = Date.now() + TURN_MS;
      if (r.actStart) r.actStart[s.current] = Date.now();
    }
    if (s.over) await this.finish();
    else await this.save();
    this.broadcast(events);
  }

  async finish() {
    const r = this.r;
    const wasPlaying = r.status === 'playing';
    r.status = 'over';
    r.cleanupAt = Date.now() + CLEANUP_MS;
    await this.save();
    // 機器人判斷：在背景送出，不拖慢結算畫面
    if (wasPlaying && r.rt && jevEnabled(this.env)) {
      const gate = this.env.JEV_GATE.get(this.env.JEV_GATE.idFromName('global'));
      for (const side of ['blue', 'green']) {
        const p = r.players[side];
        if (!p?.pid || r.rt[side].length < 6) continue;
        this.ctx.waitUntil(gate.fetch('https://gate/bot/check', {
          method: 'POST', body: JSON.stringify({ pid: p.pid, ih: p.ih || '', rt: r.rt[side], timeouts: r.timeouts[side] }),
        }).catch(() => {}));
      }
    }
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
      } else if (s.phase === 'policy') {
        if (now >= r.policyDeadline + GRACE_MS) {
          for (const sd of ['blue', 'green']) if (!s.players[sd].policy) choosePolicy(s, sd, s.offers[sd][0]);
          this.policiesDone(now);
        }
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
        if (r.timeouts) r.timeouts[s.current] += 1;
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
