// 聯絡信箱分流：每 5 分鐘檢查 AgentMail 收件匣，用 Jev 判斷類別、貼標籤，緊急或媒體來信轉寄作者。
// 需要：AGENTMAIL_API_KEY（祕密）、NOTIFY_EMAIL（轉寄目的地）。缺一就不動作。
import { judgeMail } from './jev.js';

const AM = 'https://api.agentmail.to/v0';
const MAX_PER_RUN = 5; // 每次最多處理 5 封，控制費用與執行時間

async function am(env, path, init = {}) {
  // AGENTMAIL_URL_OVERRIDE 只給本機測試用（假的 AgentMail）
  const r = await fetch(`${env.AGENTMAIL_URL_OVERRIDE || AM}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.AGENTMAIL_API_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`agentmail ${path} http ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function triageInbox(env, { jevUrl } = {}) {
  if (!env.AGENTMAIL_API_KEY || !env.NOTIFY_EMAIL) return { skipped: 'not configured' };
  const inbox = encodeURIComponent(env.MAIL_INBOX || 'bluegreen-duel@agentmail.to');
  const after = new Date(Date.now() - 3 * 86400_000).toISOString();
  const list = await am(env, `/inboxes/${inbox}/messages?limit=30&after=${encodeURIComponent(after)}`);
  const todo = (list.messages || [])
    .filter((m) => !(m.labels || []).includes('triaged') && !(m.labels || []).includes('sent'))
    .slice(0, MAX_PER_RUN);
  const done = [];
  for (const item of todo) {
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
      await am(env, `/inboxes/${inbox}/messages/${id}`, {
        method: 'PATCH', body: JSON.stringify({ add_labels: ['triaged', ...result.labels] }),
      });
      if (result.forward) {
        const tag = result.urgent ? '緊急' : result.labels.includes('press') ? '媒體' : '待確認';
        const why = result.scores
          ? Object.entries(result.scores).filter(([, v]) => v >= 0.5).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('、')
          : 'Jev 判斷失敗，請自行確認';
        await am(env, `/inboxes/${inbox}/messages/${id}/forward`, {
          method: 'POST',
          body: JSON.stringify({
            to: [env.NOTIFY_EMAIL],
            subject: `【${tag}】藍綠對決來信：${(msg.subject || '（無主旨）').slice(0, 120)}`,
            text: `自動分流結果：${result.labels.join('、')}\n判斷依據：${why}\n\n（原信附在下方）`,
          }),
        });
      }
      console.log(JSON.stringify({ mail: 'triaged', labels: result.labels, forwarded: result.forward, scores: result.scores }));
      done.push({ labels: result.labels, forwarded: result.forward });
    } catch (e) {
      console.log(JSON.stringify({ mail: 'error', error: String(e).slice(0, 300) }));
    }
  }
  return { checked: todo.length, done };
}
