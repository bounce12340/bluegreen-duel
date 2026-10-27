// 聯絡信箱分流：每 5 分鐘檢查 AgentMail 收件匣，用 Jev 判斷類別、貼標籤，緊急或媒體來信轉寄作者。
// 需要：AGENTMAIL_API_KEY（祕密）、NOTIFY_EMAIL（轉寄目的地）。缺一就不動作。
//
// 轉寄狀態全部記在信件標籤上（看收件匣就知道發生什麼事，不必翻 Worker 日誌）：
//   needs-forward   要轉寄、還沒成功
//   forwarded       已送達作者（fwd-via-send 表示轉寄失敗、改用另寄新信）
//   fwd-err-<碼>    轉寄 API 失敗的 HTTP 狀態碼；send-err-<碼> 是另寄新信失敗的狀態碼
//   fwd-try-<n>     第幾次嘗試；3 次都失敗 → forward-gave-up，不再重試
//   notify-email-invalid  NOTIFY_EMAIL 格式不對
import { judgeMail } from './jev.js';

const AM = 'https://api.agentmail.to/v0';
const MAX_PER_RUN = 5; // 每次最多處理 5 封，控制費用與執行時間
const MAX_TRIES = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class AgentMailError extends Error {
  constructor(path, status, detail) {
    super(`agentmail ${path} http ${status}: ${detail}`);
    this.status = status;
  }
}

async function am(env, path, init = {}) {
  // AGENTMAIL_URL_OVERRIDE 只給本機測試用（假的 AgentMail）
  const r = await fetch(`${env.AGENTMAIL_URL_OVERRIDE || AM}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.AGENTMAIL_API_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new AgentMailError(path, r.status, (await r.text()).slice(0, 200));
  return r.json();
}

const statusOf = (e) => (e instanceof AgentMailError ? String(e.status) : 'net');

// 祕密可能被貼成「a@x.com, b@y.com」或帶空白換行：拆開、去空白、只留合法地址
export function notifyTargets(raw) {
  const norm = String(raw || '')
    .replace(/＠/g, '@').replace(/[．。]/g, '.').replace(/[，、；]/g, ',') // 全形符號
    .replace(/mailto:/gi, '').replace(/[<>"'“”「」]/g, ' ');           // mailto:、<地址>、引號
  return norm.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => EMAIL_RE.test(s));
}

function addLabels(env, inbox, id, labels) {
  return am(env, `/inboxes/${inbox}/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ add_labels: labels }) });
}

// 送到作者信箱：先用轉寄（保留原信），失敗就另寄一封新信（把原文貼進內文）。回傳要加的標籤。
async function deliver(env, inbox, id, msg, { tag, why, labels }, tries) {
  const to = notifyTargets(env.NOTIFY_EMAIL);
  if (!to.length) return ['notify-email-invalid'];
  const subject = `【${tag}】藍綠攻防戰來信：${(msg.subject || '（無主旨）').slice(0, 120)}`;
  const head = `自動分流結果：${labels.join('、') || '（無）'}\n判斷依據：${why}`;
  const tryLabel = `fwd-try-${tries}`;
  try {
    await am(env, `/inboxes/${inbox}/messages/${id}/forward`, {
      method: 'POST', body: JSON.stringify({ to, subject, text: `${head}\n\n（原信附在下方）` }),
    });
    return ['forwarded', tryLabel];
  } catch (fwdErr) {
    console.log(JSON.stringify({ mail: 'forward-error', error: String(fwdErr).slice(0, 300) }));
    const fwdLabel = `fwd-err-${statusOf(fwdErr)}`;
    try {
      const body = msg.extracted_text || msg.text || msg.preview || '';
      await am(env, `/inboxes/${inbox}/messages/send`, {
        method: 'POST',
        body: JSON.stringify({ to, subject, text: `${head}\n\n——— 原信 ———\n寄件者：${msg.from || '（未知）'}\n主旨：${msg.subject || ''}\n\n${body.slice(0, 8000)}` }),
      });
      return ['forwarded', 'fwd-via-send', fwdLabel, tryLabel];
    } catch (sendErr) {
      console.log(JSON.stringify({ mail: 'send-error', error: String(sendErr).slice(0, 300) }));
      const out = [fwdLabel, `send-err-${statusOf(sendErr)}`, tryLabel];
      if (tries >= MAX_TRIES) out.push('forward-gave-up');
      return out;
    }
  }
}

function tagFor(labels) {
  if (labels.includes('critical')) return '特急';
  if (labels.includes('urgent')) return '緊急';
  if (labels.includes('press')) return '媒體';
  if (labels.includes('unclassified')) return '待確認';
  return '待處理';
}

// 轉寄信裡寫給作者看的判斷依據：觸發的是非題＋緊急度分數
function explain(scores) {
  if (!scores) return 'Jev 判斷失敗，請自行確認';
  const hits = Object.entries(scores).filter(([k, v]) => k !== 'urgency' && v >= 0.5).map(([k, v]) => `${k} ${v.toFixed(2)}`);
  return [`緊急度 ${scores.urgency.toFixed(1)} / 3`, ...hits].join('、');
}

const CATEGORY = new Set(['critical', 'prio-0', 'prio-1', 'prio-2', 'prio-3', 'urgent', 'takedown', 'official', 'legal', 'conditional-sponsor', 'sponsor', 'bug', 'press', 'abusive', 'other', 'unclassified']);

export async function triageInbox(env, { jevUrl } = {}) {
  if (!env.AGENTMAIL_API_KEY || !env.NOTIFY_EMAIL) return { skipped: 'not configured' };
  const inbox = encodeURIComponent(env.MAIL_INBOX || 'bluegreen-duel@agentmail.to');
  const after = new Date(Date.now() - 3 * 86400_000).toISOString();
  const list = await am(env, `/inboxes/${inbox}/messages?limit=30&after=${encodeURIComponent(after)}`);
  const has = (m, l) => (m.labels || []).includes(l);
  const fresh = (list.messages || []).filter((m) => !has(m, 'triaged') && !has(m, 'sent'));
  const retry = (list.messages || []).filter((m) => has(m, 'needs-forward') && !has(m, 'forwarded') && !has(m, 'forward-gave-up'));
  const done = [];

  for (const item of fresh.slice(0, MAX_PER_RUN)) {
    const id = encodeURIComponent(item.message_id);
    try {
      const msg = await am(env, `/inboxes/${inbox}/messages/${id}`);
      const body = msg.extracted_text || msg.text || msg.preview || '';
      let result;
      try {
        result = await judgeMail(env.TYPESAFE_API_KEY, msg.subject, body, jevUrl);
      } catch (e) {
        // 判斷失敗不代表不重要：轉寄給作者自己看
        console.log(JSON.stringify({ mail: 'jev-error', error: String(e).slice(0, 200) }));
        result = { labels: ['unclassified'], forward: true, urgent: false, scores: null };
      }
      // 先標記「已分流」，轉寄失敗也不會重複花 Jev 判斷費；轉寄另外靠 needs-forward 重試
      await addLabels(env, inbox, id, ['triaged', ...result.labels, ...(result.forward ? ['needs-forward'] : [])]);
      let fwd = [];
      if (result.forward) {
        fwd = await deliver(env, inbox, id, msg, { tag: tagFor(result.labels), why: explain(result.scores), labels: result.labels }, 1);
        await addLabels(env, inbox, id, fwd);
      }
      console.log(JSON.stringify({ mail: 'triaged', labels: result.labels, forward: fwd, scores: result.scores }));
      done.push({ labels: result.labels, forward: fwd });
    } catch (e) {
      console.log(JSON.stringify({ mail: 'error', error: String(e).slice(0, 300) }));
    }
  }

  for (const item of retry.slice(0, Math.max(0, MAX_PER_RUN - done.length))) {
    const id = encodeURIComponent(item.message_id);
    try {
      const msg = await am(env, `/inboxes/${inbox}/messages/${id}`);
      const labels = (msg.labels || item.labels || []).filter((l) => CATEGORY.has(l));
      const tries = (item.labels || []).filter((l) => l.startsWith('fwd-try-')).length + 1;
      const fwd = await deliver(env, inbox, id, msg, { tag: tagFor(labels), why: '（重試轉寄，依原分流標籤）', labels }, tries);
      await addLabels(env, inbox, id, fwd);
      console.log(JSON.stringify({ mail: 'retry', forward: fwd }));
      done.push({ retry: true, forward: fwd });
    } catch (e) {
      console.log(JSON.stringify({ mail: 'error', error: String(e).slice(0, 300) }));
    }
  }
  return { checked: fresh.length + retry.length, done };
}

// 直接寄一封通知給作者（遊戲內回報的緊急件用）
export async function sendToOwner(env, subject, text) {
  if (!env.AGENTMAIL_API_KEY) throw new Error('agentmail not configured');
  const to = notifyTargets(env.NOTIFY_EMAIL);
  if (!to.length) throw new Error('notify-email-invalid');
  const inbox = encodeURIComponent(env.MAIL_INBOX || 'bluegreen-duel@agentmail.to');
  return am(env, `/inboxes/${inbox}/messages/send`, { method: 'POST', body: JSON.stringify({ to, subject, text }) });
}

// 遊戲內回報的文字版（彙整信與即時通知共用）
export function formatReport(rep) {
  const d = rep.diag || {};
  const diag = Object.keys(d).length ? Object.entries(d).map(([k, v]) => `${k}=${v}`).join('、') : '（玩家沒有附上）';
  return `${rep.text}\n   分類：${(rep.labels || []).filter((l) => !l.startsWith('prio-')).join('、') || 'other'}｜遊戲狀態：${diag}`;
}

// 每日彙整（台北時間 21:00）：1 級的一般來信＋遊戲內回報整理成一封寄給作者；0 級垃圾只報數量。處理過的貼 digested。
export async function digestInbox(env, { reports = [] } = {}) {
  if (!env.AGENTMAIL_API_KEY || !env.NOTIFY_EMAIL) return { skipped: 'not configured' };
  const to = notifyTargets(env.NOTIFY_EMAIL);
  if (!to.length) return { skipped: 'notify-email-invalid' };
  const inbox = encodeURIComponent(env.MAIL_INBOX || 'bluegreen-duel@agentmail.to');
  const after = new Date(Date.now() - 3 * 86400_000).toISOString();
  const list = await am(env, `/inboxes/${inbox}/messages?limit=100&after=${encodeURIComponent(after)}`);
  const has = (m, l) => (m.labels || []).includes(l);
  const pending = (list.messages || []).filter((m) => has(m, 'triaged') && !has(m, 'digested') && !has(m, 'sent'));
  const normal = pending.filter((m) => has(m, 'prio-1'));
  const junk = pending.filter((m) => has(m, 'prio-0'));
  const repNormal = reports.filter((r) => r.level !== 0);
  const repJunk = reports.length - repNormal.length;
  if (!normal.length && !junk.length && !reports.length) return { sent: false };
  const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(5, 10).replace('-', '/');
  const lines = normal.map((m, i) => {
    const cats = (m.labels || []).filter((l) => CATEGORY.has(l) && !l.startsWith('prio-'));
    const preview = String(m.preview || '').replace(/\s+/g, ' ').slice(0, 120);
    return `${i + 1}. ${m.subject || '（無主旨）'}\n   寄件者：${m.from || '（未知）'}｜分類：${cats.join('、') || 'other'}\n   ${preview}`;
  });
  const repLines = repNormal.map((r, i) => `${i + 1}. ${formatReport(r)}`);
  const text = [
    `今天（${day}）有 ${normal.length} 封一般來信、${repNormal.length} 則遊戲內回報，不急，有空再看：`,
    ...(normal.length ? ['', '【來信】', ...lines] : []),
    ...(repNormal.length ? ['', '【遊戲內回報】', ...repLines] : []),
    ...(junk.length || repJunk ? ['', `另有 ${junk.length + repJunk} 則判定為垃圾或廣告，只記錄沒有轉寄。`] : []),
    '', '（完整原信在 bluegreen-duel@agentmail.to 信箱。2 級以上的來信會即時轉寄，不會出現在彙整裡。）',
  ].join('\n');
  await am(env, `/inboxes/${inbox}/messages/send`, {
    method: 'POST', body: JSON.stringify({ to, subject: `【每日彙整】藍綠攻防戰來信 ${normal.length} 封、回報 ${repNormal.length} 則（${day}）`, text }),
  });
  for (const m of [...normal, ...junk]) {
    try { await addLabels(env, inbox, encodeURIComponent(m.message_id), ['digested']); }
    catch (e) { console.log(JSON.stringify({ mail: 'digest-label-error', error: String(e).slice(0, 200) })); }
  }
  return { sent: true, normal: normal.length, junk: junk.length, reports: reports.length };
}
