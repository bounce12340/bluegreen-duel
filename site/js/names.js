// 暱稱檢查：前端與伺服器共用。只擋明顯的冒充、謾罵與仇恨字眼，不追求完美。
const BLOCK = [
  // 冒充當事人、官方或競選單位
  '蔣萬安', '沈伯洋', '萬安', '伯洋', '官方', '中選會', '選委會', '市政府', '市府', '競選總部', '競總',
  '國民黨', '民進黨', '民眾黨', '管理員', 'admin', 'gm',
  // 英文版：比對時已去掉空白並轉小寫
  'waynechiang', 'chiangwanan', 'pumashen', 'shenpoyang', 'kmt', 'dpp', 'official', 'moderator', 'electioncommission',
  // 謾罵
  '幹你', '幹妳', '操你', '靠北', '靠杯', '雞掰', '機掰', '王八', '白癡', '智障', '去死', '垃圾', 'fuck', 'shit',
  'bitch', 'asshole', 'retard', 'dumbass', 'kys',
  // 仇恨與歧視
  '支那', '426', '綠畜', '藍畜', '台巴子', '覺青', '韓粉', '1450', '五毛', '綠共', '藍共', '綠蛆', '藍蛆', '塔綠班', '白癡', '白痴', '白ㄔ', 'ㄅㄔ',
];

export const NAME_MAX = 12;

export function cleanName(raw) {
  return String(raw || '').replace(/[\u0000-\u001f\u007f<>"'`&]/g, '').replace(/\s+/g, ' ').trim();
}

// 回傳錯誤訊息；合格則回傳 null
export function checkName(raw) {
  const name = cleanName(raw);
  if (!name) return '請輸入暱稱';
  if ([...name].length > NAME_MAX) return `暱稱最多 ${NAME_MAX} 個字`;
  const lower = name.toLowerCase().replace(/\s/g, '');
  if (BLOCK.some((w) => lower.includes(w.toLowerCase()))) return '這個暱稱不能使用，請換一個';
  return null;
}
