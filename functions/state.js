export async function onRequestGet({ env }) {
  const raw = await env.HS_KV.get("state");
  const state = raw ? JSON.parse(raw) : {
    updatedAt: Date.now(),
    lots: {
      lot1: { unsold: 0, prices: [], series: [] },
      lot2: { unsold: 0, prices: [], series: [] }
    },
    comments: []
  };
  return new Response(JSON.stringify({ ok: true, state }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
