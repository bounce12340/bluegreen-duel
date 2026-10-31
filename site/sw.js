// 離線快取（PWA）。這個檔案由 tools/gen_sw.mjs 產生，請勿手改；改了 site/ 的檔案要重跑一次。
// 策略：網頁、程式、樣式「先網路、失敗才用快取」（關站日、時事卡下架都以最新版為準）；
// 圖片、音效「先快取」。/api（連線對戰）一律不快取。
const VERSION = 'e148c7a37671';
const CACHE = `bgd-${VERSION}`;
const FILES = [
  './',
  './assets/audio/bgm.mp3',
  './assets/audio/boo.mp3',
  './assets/audio/cheer.mp3',
  './assets/audio/ooh.mp3',
  './assets/bg_cityhall.webp',
  './assets/bg_cityhall_wide.webp',
  './assets/blue_back.webp',
  './assets/blue_back_happy.webp',
  './assets/blue_back_hurt.webp',
  './assets/blue_back_lose.webp',
  './assets/blue_back_win.webp',
  './assets/blue_happy.webp',
  './assets/blue_hurt.webp',
  './assets/blue_idle.webp',
  './assets/blue_lose.webp',
  './assets/blue_panic.webp',
  './assets/blue_smug.webp',
  './assets/blue_special.webp',
  './assets/blue_win.webp',
  './assets/cards/b_briefing.webp',
  './assets/cards/b_dodge.webp',
  './assets/cards/b_editor.webp',
  './assets/cards/b_encircle.webp',
  './assets/cards/b_news.webp',
  './assets/cards/b_rally.webp',
  './assets/cards/b_service.webp',
  './assets/cards/b_vision.webp',
  './assets/cards/g_encircle.webp',
  './assets/cards/g_flash.webp',
  './assets/cards/g_folder.webp',
  './assets/cards/g_question.webp',
  './assets/cards/g_rally.webp',
  './assets/cards/g_speech.webp',
  './assets/cards/g_volunteer.webp',
  './assets/cards/g_youth.webp',
  './assets/cards/news.webp',
  './assets/cards/s_buzz.webp',
  './assets/cards/s_early.webp',
  './assets/cards/s_expose.webp',
  './assets/cards/s_flip.webp',
  './assets/cards/s_forum.webp',
  './assets/cards/s_gaffe.webp',
  './assets/cards/s_market.webp',
  './assets/cards/s_rain.webp',
  './assets/cards/s_staff.webp',
  './assets/cards/s_street.webp',
  './assets/fx/bag.webp',
  './assets/fx/ballot.webp',
  './assets/fx/bento.webp',
  './assets/fx/bird.webp',
  './assets/fx/chart.webp',
  './assets/fx/chat.webp',
  './assets/fx/check.webp',
  './assets/fx/clipboard.webp',
  './assets/fx/cross.webp',
  './assets/fx/cyclone.webp',
  './assets/fx/dizzy.webp',
  './assets/fx/fire.webp',
  './assets/fx/hardhat.webp',
  './assets/fx/heart.webp',
  './assets/fx/laptop.webp',
  './assets/fx/laugh.webp',
  './assets/fx/magnify.webp',
  './assets/fx/megaphone.webp',
  './assets/fx/mic.webp',
  './assets/fx/mirror.webp',
  './assets/fx/people.webp',
  './assets/fx/phone.webp',
  './assets/fx/plead.webp',
  './assets/fx/question.webp',
  './assets/fx/repost.webp',
  './assets/fx/shield.webp',
  './assets/fx/siren.webp',
  './assets/fx/sparkle.webp',
  './assets/fx/sun.webp',
  './assets/fx/swap.webp',
  './assets/fx/tools.webp',
  './assets/fx/train.webp',
  './assets/fx/trophy.webp',
  './assets/fx/vest.webp',
  './assets/fx/wind.webp',
  './assets/fx/zip.webp',
  './assets/green_back.webp',
  './assets/green_back_happy.webp',
  './assets/green_back_hurt.webp',
  './assets/green_back_lose.webp',
  './assets/green_back_win.webp',
  './assets/green_happy.webp',
  './assets/green_hurt.webp',
  './assets/green_idle.webp',
  './assets/green_lose.webp',
  './assets/green_panic.webp',
  './assets/green_smug.webp',
  './assets/green_special.webp',
  './assets/green_win.webp',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-48.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './css/style.css',
  './index.html',
  './js/ai.js',
  './js/cards.js',
  './js/chatter.js',
  './js/config.js',
  './js/crowd.js',
  './js/engine.js',
  './js/fx.js',
  './js/i18n.js',
  './js/main.js',
  './js/names.js',
  './js/news_cards.js',
  './js/online.js',
  './js/progress.js',
  './js/share.js',
  './js/sound.js',
  './manifest.webmanifest',
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
  const isCode = isPage || /\.(js|css|html|webmanifest)$/.test(url.pathname);
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
