// 群眾留言：遊戲裡發生事情時，從群眾裡冒出一則匿名網友留言——鄉民推文（推／噓／→）或脆文（threads）。
// 原則：雙方通用（不分陣營）、不用攻擊陣營或族群的稱呼、不指稱任何人收錢。部署前會用 Jev 檢查（tools/content_check.mjs）。
export const CHATTER = {
  pull: [['push', '這波可以'], ['push', '中間選民動搖了'], ['arrow', '又多幾個人'], ['threads', '這波我給過✅'], ['threads', '中間選民被說服了嗎🤔']],
  bigPull: [['push', '神操作'], ['push', '太神啦'], ['threads', '直接起飛🚀'], ['threads', '這也太扯了吧😳']],
  poach: [['arrow', '說走就走 XD'], ['push', '挖角成功'], ['threads', '說走就走 太真實🤣'], ['threads', '人呢？？']],
  status: [['push', '笑死'], ['arrow', '躺著也中槍'], ['threads', '破防了😭'], ['threads', '被戳到了吧']],
  trap: [['arrow', '是在哈囉'], ['boo', '母湯喔'], ['threads', '誰懂這種被陰的感覺🫠']],
  ult: [['push', '大絕招！'], ['push', '前排卡位'], ['threads', '大絕招！！我先截圖📸']],
  rally: [['push', '雞皮疙瘩'], ['push', '現場人好多'], ['threads', '有被燈光療癒到✨']],
  miss: [['boo', '打歪了 XD'], ['threads', '打歪 笑死🤣']],
  caught: [['push', '抓到了！'], ['push', '有圖有真相'], ['push', '鄉民的眼睛是雪亮的'], ['threads', '抓包現場📸'], ['threads', '我就說吧🙄']],
  wrong: [['arrow', '認真你就輸了'], ['push', '冤枉啊'], ['threads', '認真就輸了🫠']],
  skip: [['arrow', '存錢中…'], ['threads', '先觀望 不急']],
};

export function pickChatter(kind) {
  const pool = CHATTER[kind];
  if (!pool) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export const TONE_TAG = { push: '推', boo: '噓', arrow: '→', threads: '脆' };
