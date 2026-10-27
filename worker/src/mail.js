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
  return String(raw || '').split(/[,;\s]+/).map((s) => s.trim()).filter((s) => EMAIL_RE.test(s));
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
  if (labels.includes('urgent')) return '緊急';
  if (labels.includes('press')) return '媒體';
  return '待確認';
}

const CATEGORY = new Set(['urgent', 'takedown', 'official', 'legal', 'conditional-sponsor', 'sponsor', 'bug', 'press', 'abusive', 'other', 'unclassified']);

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
        const why = result.scores
          ? Object.entries(result.scores).filter(([, v]) => v >= 0.5).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('、') || '（無）'
          : 'Jev 判斷失敗，請自行確認';
        fwd = await deliver(env, inbox, id, msg, { tag: tagFor(result.labels), why, labels: result.labels }, 1);
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
