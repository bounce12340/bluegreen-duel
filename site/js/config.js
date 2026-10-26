// 營運設定：改這裡後重新部署即可生效。
export const CONFIG = {
  // true：全站顯示維護頁，關閉所有對戰
  MAINTENANCE: false,
  MAINTENANCE_MSG: '系統維護中，請稍後再來。',

  // 依選罷法規定，投票日全天暫停服務（以台北時間判斷）
  CLOSED_DATES: ['2026-11-28'],
  CLOSED_MSG: '依選罷法規定，投票日暫停服務。',

  // 停用單張卡牌：填入卡牌 id，例如 ['s_gaffe']
  disabledCards: [],

  CONTACT_EMAIL: 'bluegreen-duel@agentmail.to',

  // 綠界實況主收款頁網址；留空則不顯示贊助按鈕
  SPONSOR_URL: '',

  TURN_SECONDS: 60,

  // 隨機配對最多等幾秒，時間到自動改跟電腦對戰
  MATCH_SECONDS: 30,
};
