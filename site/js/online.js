// 連線用的小工具：伺服器狀態、玩家識別碼、WebSocket 網址、Turnstile 真人驗證。

export async function fetchStatus() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const r = await fetch('/api/status', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!r.ok) return { online: false };
    const d = await r.json();
    return { online: !!d.online, ...d };
  } catch {
    return { online: false };
  }
}

// 玩家識別碼存在這個分頁的 sessionStorage：重新整理後還能用它回到同一局
export function getPid() {
  let pid = null;
  try { pid = sessionStorage.getItem('bg_pid'); } catch { /* 忽略 */ }
  if (!pid) {
    pid = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9-]/g, '');
    try { sessionStorage.setItem('bg_pid', pid); } catch { /* 忽略 */ }
  }
  return pid;
}

export function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api${path}`;
}

let tsLoading = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!tsLoading) {
    tsLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { tsLoading = null; reject(new Error('turnstile load failed')); };
      document.head.appendChild(s);
    });
  }
  return tsLoading;
}

// 沒設定 site key 時直接回傳 null（伺服器那邊也會略過驗證）
export async function getTurnstileToken(siteKey, container) {
  if (!siteKey) return null;
  await loadTurnstile();
  return new Promise((resolve, reject) => {
    window.turnstile.render(container, {
      sitekey: siteKey,
      language: 'zh-tw',
      callback: (token) => resolve(token),
      'error-callback': () => reject(new Error('turnstile failed')),
      'expired-callback': () => reject(new Error('turnstile expired')),
    });
  });
}
