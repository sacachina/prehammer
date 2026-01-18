const PROFANITY = ["傻","蠢","垃圾","廢物","滾","去死","媽的","他媽","操","屌","婊","畜生"];
const POL_TITLE = ["總統","主席","總書記","國家主席","首相","總理"];

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body) return resp({ ok:false, error:"BAD_JSON" }, 400);

  const { lot, name, text } = body;
  if (!["lot1","lot2","all"].includes(lot)) return resp({ ok:false, error:"BAD_LOT" }, 400);

  const n = String(name || "").trim();
  if (!n) return resp({ ok:false, error:"NAME_REQUIRED" }, 400);
  if (n.length > 30) return resp({ ok:false, error:"NAME_TOO_LONG" }, 400);
  if (containsAny(n, PROFANITY) || containsAny(n, POL_TITLE)) return resp({ ok:false, error:"NAME_DISALLOWED" }, 400);

  const t = String(text || "").trim();
  if (t.length < 3) return resp({ ok:false, error:"COMMENT_TOO_SHORT" }, 400);
  if (t.length > 800) return resp({ ok:false, error:"COMMENT_TOO_LONG" }, 400);
  if (containsAny(t, PROFANITY) || containsAny(t, POL_TITLE)) return resp({ ok:false, error:"COMMENT_DISALLOWED" }, 400);

  const raw = await env.HS_KV.get("state");
  const state = raw ? JSON.parse(raw) : {
    updatedAt: Date.now(),
    lots: { lot1:{unsold:0,prices:[],series:[]}, lot2:{unsold:0,prices:[],series:[]} },
    comments:[]
  };

  state.comments.push({ id: rid(), ts: Date.now(), lot, name: n, text: t });
  if (state.comments.length > 200) state.comments = state.comments.slice(-200);

  state.updatedAt = Date.now();
  await env.HS_KV.put("state", JSON.stringify(state));

  return resp({ ok:true, state });
}

function containsAny(t, arr){ return arr.some(x=>x && t.includes(x)); }
function rid(){
  const a=new Uint8Array(6); crypto.getRandomValues(a);
  return [...a].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function resp(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
  });
}
