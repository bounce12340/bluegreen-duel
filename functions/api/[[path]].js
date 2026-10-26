// 把 /api/* 原封不動轉給連線伺服器（含 WebSocket）
export const onRequest = ({ request, env }) => {
  if (!env.GAME) return new Response(JSON.stringify({ online: false }), { status: 503, headers: { 'content-type': 'application/json' } });
  return env.GAME.fetch(request);
};
