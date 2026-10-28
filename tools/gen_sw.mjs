// 產生 site/sw.js（PWA 離線快取）：列出 site/ 底下所有檔案，版本號是全部內容的雜湊。
// 任何檔案改了 → 版本號跟著變 → 瀏覽器更新快取。
// 用法：node tools/gen_sw.mjs          重新產生
//      node tools/gen_sw.mjs --check  只檢查是否最新（CI 用，不是最新就失敗）
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const SITE = new URL('../site/', import.meta.url).pathname;
const SKIP = new Set(['sw.js', '_headers']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (!SKIP.has(relative(SITE, p)) && !name.startsWith('.') && !relative(SITE, p).startsWith('assets/promo/')) out.push(p);  // 宣傳影片不放離線快取
  }
  return out;
}
const files = walk(SITE);
const h = createHash('sha256');
for (const f of files) { h.update(relative(SITE, f)); h.update(readFileSync(f)); }
const version = h.digest('hex').slice(0, 12);
const list = files.map((f) => `  './${relative(SITE, f).split('\\').join('/')}',`).join('\n');

const src = `// 離線快取（PWA）。這個檔案由 tools/gen_sw.mjs 產生，請勿手改；改了 site/ 的檔案要重跑一次。
// 策略：網頁、程式、樣式「先網路、失敗才用快取」（關站日、時事卡下架都以最新版為準）；
// 圖片、音效「先快取」。/api（連線對戰）一律不快取。
const VERSION = '${version}';
const CACHE = \`bgd-\${VERSION}\`;
const FILES = [
  './',
${list}
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bgd-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function fresh(req) {
  // 網路太慢（4 秒）就先用快取，免得收訊差時卡在白畫面
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 4000);
    fetch(req).then((res) => {
      clearTimeout(timer);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      resolve(res);
    }, (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const isPage = req.mode === 'navigate';
  const isCode = isPage || /\\.(js|css|html|webmanifest)$/.test(url.pathname);
  if (isCode) {
    e.respondWith(fresh(req).catch(() => caches.match(req, { ignoreSearch: isPage })
      .then((hit) => hit || (isPage ? caches.match('./index.html') : Response.error()))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
`;

const target = join(SITE, 'sw.js');
if (process.argv.includes('--check')) {
  const cur = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (cur !== src) {
    console.error('site/sw.js 不是最新的：請執行 node tools/gen_sw.mjs 後再提交');
    process.exit(1);
  }
  console.log(`sw.js 最新（版本 ${version}，${files.length + 1} 個檔案）`);
} else {
  writeFileSync(target, src);
  console.log(`已產生 site/sw.js（版本 ${version}，${files.length + 1} 個檔案）`);
}
