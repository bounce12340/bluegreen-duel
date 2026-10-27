# 藍綠攻防戰

政治諷刺娛樂網頁卡牌遊戲。非任何候選人、政黨或競選團隊製作，內容不代表當事人言行；角色為原創 Q 版人偶，美術由 AI 生成。

## 目錄
- `site/`：網站本體，Cloudflare Pages 的輸出目錄
- `functions/api/`：Pages Function，把 `/api/*`（含 WebSocket）轉給連線伺服器
- `worker/`：連線伺服器（Worker + Durable Objects 休眠 API）：配對大廳、房間、伺服器權威計時與結算
- `tools/sim.mjs`：電腦對電腦平衡模擬（`npm run sim`）
- `tools/cutout.py`：角色圖去背
- `site/assets/cards/`：26 張卡圖（Higgsfield GPT Image 2.5 生成，320×240 WebP）
- `tools/shot.py`：手機尺寸自動試玩截圖

## 部署
推到 `main` 會由 GitHub Actions 自動部署（先跑平衡模擬，勝率超出 40–60% 就中止）：
1. `worker/` → Worker `bluegreen-duel-server`
2. 網站 → Pages 專案 `bluegreen-duel`

repo secrets：`CLOUDFLARE_API_TOKEN`（Pages Edit、Workers Scripts Edit）、`CLOUDFLARE_ACCOUNT_ID`、`TYPESAFE_API_KEY`（Jev）

## 不用重新部署的開關（Cloudflare 後台 → Workers & Pages → bluegreen-duel-server → Settings → Variables）
- `MAINTENANCE` = `1`：全站維護頁、停止新對局（改回 `0` 或刪除即恢復）
- `MAINTENANCE_MSG`：維護頁文字
- `DISABLED_CARDS`：停用卡牌 id，逗號分隔，例如 `s_gaffe,g_question`
- `TURNSTILE_SITE_KEY`＋祕密 `TURNSTILE_SECRET`：設了才啟用真人驗證
- `JEV_DISABLED` = `1`：關閉 Jev 判斷，電腦只用歷史紀錄；`JEV_DAILY_CAP`（預設 50000）、`JEV_PER_IP_PER_MIN`（預設 20）

## 電腦對手（site/js/ai.js）
- 期望值決策：出牌、跳過存行程點、吹牛、質疑都比較期望值
- 記住玩家習慣（瀏覽器 localStorage `bg_profile`）：被抓過幾次吹牛、多常質疑，跨局累積
- 質疑時請伺服器問 TypeSafe Jev「這次像不像吹牛」（`worker/src/jev.js`，問題與狀態都在這個檔案），與歷史紀錄加權；Jev 失敗或逾時就只用歷史紀錄
- 送給 Jev 的只有遊戲數字與卡牌效果，不含暱稱、IP 或個人資料；伺服器只接受固定格式的數字，不接受自由文字
- 適應力測試：`node tools/adapt_test.mjs`

## Jev 的其他用途（問題與規則都在 worker/src/jev.js）
- **暱稱審核**：關鍵字清單先擋（免費）→ Jev 問 5 個是非題（冒充政治人物、冒充官方、拉票門檻 0.5；罵人、歧視門檻 0.7）。結果快取 7 天。Jev 失敗時只靠關鍵字，不擋玩家
- **聯絡信箱分流**（worker/src/mail.js）：每 5 分鐘檢查 AgentMail 收件匣，Jev 判斷 8 個是非題，貼標籤；下架要求、官方來信、提到法律、附條件贊助 → 標「urgent」並轉寄作者；媒體來信也轉寄；Jev 失敗的信一律轉寄。需要 repo secrets `AGENTMAIL_API_KEY`、`NOTIFY_EMAIL`
- **卡牌內容檢查**（tools/content_check.mjs，部署前自動跑）：每張卡與大絕招問 5 條合規規則＋「酸到哪一邊、有多酸」；合規機率 ≥ 0.7 不合格（停止部署）、0.3–0.7 請人工看；藍綠被酸總量差距 > 30% 提出警告。報告寫在 tools/content_report.md

## 連線規則
- 隨機配對優先配不同陣營，等 12 秒以上改為不分陣營；畫面倒數 30 秒，沒配到自動改跟電腦對戰（`site/js/config.js` 的 `MATCH_SECONDS`）
- 被配對但 30 秒內沒連進房間的玩家判負，避免對手對著空位玩
- 朋友房 5 碼房號，10 分鐘沒人加入自動關閉
- 一回合一個動作（打一張主牌或蓋牌宣告後自動換人；魔法卡、大絕招不佔回合）；每回合 30 秒（伺服器計時，截止後 1 秒寬限）；斷線 30 秒判負；單局最長 20 分鐘
- 同時房間上限 200，額滿排隊；每個連線每秒最多 8 則訊息
- 對手手牌、蓋牌、亂數狀態不會傳到前端；蓋牌宣告的真牌只有出牌方收得到
- 蓋牌宣告：對手 8 秒內決定質疑或放行，這段時間出牌方的 60 秒暫停；沒回應視同放行

## 本機測試
```
cd worker && npx wrangler dev --port 8787
npx wrangler pages dev site --port 8788
python3 tools/pvp_test.py           # 雙人配對、重連、朋友房
python3 tools/pvp_timeout_test.py   # 逾時與斷線判負（約 100 秒）
python3 tools/match_timeout_test.py # 配對倒數改電腦、幽靈對手判負（約 80 秒）
python3 tools/challenge_test.py     # 質疑：對電腦、連線吹牛被抓、說實話逾時放行、真牌不外洩
python3 tools/fx_test.py            # 一回合一張牌、出牌演出、卡圖、打完整局
python3 tools/jev_client_test.py    # Jev 判斷與失敗時改用歷史紀錄（本機用假 Jev 伺服器）
```

## 單機版備用設定（site/js/config.js，需重新部署）
- `MAINTENANCE: true`：全站維護頁
- `CLOSED_DATES`：自動關站日期（已含 2026-11-28 投票日）
- `disabledCards`：停用單張卡牌（卡牌 id 見 site/js/cards.js）
- `SPONSOR_URL`：綠界實況主收款頁網址
