# 藍綠對決

政治諷刺娛樂網頁卡牌遊戲。非任何候選人、政黨或競選團隊製作，內容不代表當事人言行；角色為原創 Q 版人偶，美術由 AI 生成。

## 目錄
- `site/`：網站本體，Cloudflare Pages 的輸出目錄
- `functions/api/`：Pages Function，把 `/api/*`（含 WebSocket）轉給連線伺服器
- `worker/`：連線伺服器（Worker + Durable Objects 休眠 API）：配對大廳、房間、伺服器權威計時與結算
- `tools/sim.mjs`：電腦對電腦平衡模擬（`npm run sim`）
- `tools/cutout.py`：角色圖去背
- `tools/shot.py`：手機尺寸自動試玩截圖

## 部署
推到 `main` 會由 GitHub Actions 自動部署（先跑平衡模擬，勝率超出 40–60% 就中止）：
1. `worker/` → Worker `bluegreen-duel-server`
2. 網站 → Pages 專案 `bluegreen-duel`

repo secrets：`CLOUDFLARE_API_TOKEN`（Pages Edit、Workers Scripts Edit）、`CLOUDFLARE_ACCOUNT_ID`

## 不用重新部署的開關（Cloudflare 後台 → Workers & Pages → bluegreen-duel-server → Settings → Variables）
- `MAINTENANCE` = `1`：全站維護頁、停止新對局（改回 `0` 或刪除即恢復）
- `MAINTENANCE_MSG`：維護頁文字
- `DISABLED_CARDS`：停用卡牌 id，逗號分隔，例如 `s_gaffe,g_question`
- `TURNSTILE_SITE_KEY`＋祕密 `TURNSTILE_SECRET`：設了才啟用真人驗證

## 連線規則
- 隨機配對優先配不同陣營，等 12 秒以上改為不分陣營；畫面倒數 30 秒，沒配到自動改跟電腦對戰（`site/js/config.js` 的 `MATCH_SECONDS`）
- 被配對但 30 秒內沒連進房間的玩家判負，避免對手對著空位玩
- 朋友房 5 碼房號，10 分鐘沒人加入自動關閉
- 每回合 60 秒（伺服器計時，截止後 1 秒寬限）；斷線 30 秒判負；單局最長 20 分鐘
- 同時房間上限 200，額滿排隊；每個連線每秒最多 8 則訊息
- 對手手牌、蓋牌、亂數狀態不會傳到前端

## 本機測試
```
cd worker && npx wrangler dev --port 8787
npx wrangler pages dev site --port 8788
python3 tools/pvp_test.py           # 雙人配對、重連、朋友房
python3 tools/pvp_timeout_test.py   # 逾時與斷線判負（約 100 秒）
python3 tools/match_timeout_test.py # 配對倒數改電腦、幽靈對手判負（約 80 秒）
```

## 單機版備用設定（site/js/config.js，需重新部署）
- `MAINTENANCE: true`：全站維護頁
- `CLOSED_DATES`：自動關站日期（已含 2026-11-28 投票日）
- `disabledCards`：停用單張卡牌（卡牌 id 見 site/js/cards.js）
- `SPONSOR_URL`：綠界實況主收款頁網址
