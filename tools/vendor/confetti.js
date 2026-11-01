import confetti from 'canvas-confetti';
// 只用 create()：預設實例會開 Blob Worker，被網站的 CSP 擋下
export const create = confetti.create;
