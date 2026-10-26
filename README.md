# 藍綠對決

政治諷刺娛樂網頁卡牌遊戲。非任何候選人、政黨或競選團隊製作，內容不代表當事人言行；角色為原創 Q 版人偶，美術由 AI 生成。

## 目錄
- `site/`：網站本體（純靜態），Cloudflare Pages 的輸出目錄
- `tools/sim.mjs`：電腦對電腦平衡模擬（`npm run sim`）
- `tools/cutout.py`：角色圖去背
- `tools/shot.py`：手機尺寸自動試玩截圖

## 部署到 Cloudflare Pages（連 GitHub）
Workers & Pages → Create → Pages → Connect to Git → 選這個 repo
- Framework preset：None
- Build command：留空
- Build output directory：`site`

## 營運設定（site/js/config.js）
- `MAINTENANCE: true`：全站維護頁
- `CLOSED_DATES`：自動關站日期（已含 2026-11-28 投票日）
- `disabledCards`：停用單張卡牌（卡牌 id 見 site/js/cards.js）
- `SPONSOR_URL`：綠界實況主收款頁網址
