// 戰績分享圖卡：結算時在瀏覽器裡用 canvas 畫一張 1080×1350（4:5，適合 Threads／IG／LINE）的圖。
// 不上傳任何東西；能用系統分享就直接分享圖片，不行就下載。

const W = 1080, H = 1350;
const FONT = '"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Microsoft JhengHei", system-ui, sans-serif';
const COLORS = { blue: '#2f6fd6', green: '#1f9a55', ink: '#23324a', gold: '#f2b52c', paper: '#fffdf8' };

function img(src) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}
function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fitText(ctx, text, maxW, size, weight = 900) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 1; } while (ctx.measureText(text).width > maxW && s > 13);
}

// d：{ side, won, draw, blue, green, title, reason, sideName, policy, best:{name,art,n}, date, daily, url, labels:{...} }
export async function drawShareCard(d) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const L = d.labels;
  // 背景：市府廣場模糊＋陣營色漸層
  const bg = await img('assets/bg_cityhall.webp');
  if (bg) {
    ctx.filter = 'blur(6px) saturate(1.1)';
    const r = Math.max(W / bg.width, H / bg.height);
    ctx.drawImage(bg, (W - bg.width * r) / 2, (H - bg.height * r) / 2, bg.width * r, bg.height * r);
    ctx.filter = 'none';
  } else { ctx.fillStyle = '#cfe6ff'; ctx.fillRect(0, 0, W, H); }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,253,248,.25)');
  g.addColorStop(1, d.side === 'blue' ? 'rgba(47,111,214,.55)' : 'rgba(31,154,85,.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // 卡片
  ctx.fillStyle = COLORS.paper;
  ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
  rounded(ctx, 70, 70, W - 140, H - 140, 48); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 10; ctx.strokeStyle = COLORS[d.side]; rounded(ctx, 70, 70, W - 140, H - 140, 48); ctx.stroke();

  ctx.textAlign = 'center';
  // 遊戲名稱
  ctx.font = `900 64px ${FONT}`;
  const parts = L.titleParts; // [[text,color],...]
  const tw = parts.reduce((a, [t]) => a + ctx.measureText(t).width, 0);
  let x = W / 2 - tw / 2;
  ctx.textAlign = 'left';
  for (const [t, col] of parts) { ctx.fillStyle = COLORS[col] || COLORS.ink; ctx.fillText(t, x, 170); x += ctx.measureText(t).width; }
  ctx.textAlign = 'center';
  if (d.daily) { ctx.fillStyle = COLORS.gold; ctx.font = `900 34px ${FONT}`; ctx.fillText(d.daily, W / 2, 222); }

  // 人偶
  const mascot = await img(`assets/${d.side}_${d.draw ? 'idle' : d.won ? 'win' : 'lose'}.webp`);
  if (mascot) {
    const mh = 420, mw = mascot.width * (mh / mascot.height);
    ctx.drawImage(mascot, W / 2 - mw / 2, 245, mw, mh);
  }
  // 勝負與比分
  ctx.fillStyle = COLORS.ink; fitText(ctx, d.title, W - 220, 76); ctx.fillText(d.title, W / 2, 740);
  const sb = `${L.blue} ${d.blue}`, sg = `${d.green} ${L.green}`;
  let fs = 96;
  const measure = () => { ctx.font = `900 ${fs}px ${FONT}`; return ctx.measureText(sb).width + ctx.measureText(' : ').width + ctx.measureText(sg).width; };
  while (measure() > W - 260 && fs > 50) fs -= 4;
  const wb = ctx.measureText(sb).width, wc = ctx.measureText(' : ').width;
  const total = measure();
  ctx.textAlign = 'left';
  let sx = W / 2 - total / 2;
  ctx.fillStyle = COLORS.blue; ctx.fillText(sb, sx, 860); sx += wb;
  ctx.fillStyle = COLORS.ink; ctx.fillText(' : ', sx, 860); sx += wc;
  ctx.fillStyle = COLORS.green; ctx.fillText(sg, sx, 860);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6b7385'; ctx.font = `700 32px ${FONT}`; ctx.fillText(d.reason, W / 2, 912);

  // 陣營、策略、本局最佳一手
  let y = 975;
  const row = (label, value) => {
    ctx.font = `700 30px ${FONT}`; ctx.fillStyle = '#6b7385'; ctx.fillText(label, W / 2, y);
    fitText(ctx, value, W - 260, 40); ctx.fillStyle = COLORS.ink; ctx.fillText(value, W / 2, y + 48);
    y += 112;
  };
  row(L.played, d.sideName + (d.policy ? `・${d.policy}` : ''));
  if (d.best) row(L.best, d.best);

  // 網址與聲明
  ctx.fillStyle = COLORS.ink; rounded(ctx, 190, 1168, W - 380, 70, 35); ctx.fill();
  ctx.fillStyle = '#fff'; fitText(ctx, d.url, W - 440, 36, 700); ctx.fillText(d.url, W / 2, 1215);
  ctx.fillStyle = '#8a91a0'; fitText(ctx, L.disclaimer, W - 240, 22, 400); ctx.fillText(L.disclaimer, W / 2, 1262);

  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

// 分享或下載。回傳 'shared'｜'downloaded'｜'cancelled'
export async function shareImage(blob, filename, text) {
  const file = new File([blob], filename, { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}
