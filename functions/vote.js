const ADMIN_NAME = "王秋生";
const PROFANITY = ["傻","蠢","垃圾","廢物","滾","去死","媽的","他媽","操","屌","婊","畜生"];
const POL_TITLE = ["總統","主席","總書記","國家主席","首相","總理"];

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body) return resp({ ok:false, error:"BAD_JSON" }, 400);

  const { lot, type, price, name } = body;
  if (!["lot1","lot2"].includes(lot)) return resp({ ok:false, error:"BAD_LOT" }, 400);
  if (!["UNSOLD","PRICE"].includes(type)) return resp({ ok:false, error:"BAD_TYPE" }, 400);

  const n = String(name || "").trim();
  const nc = validateName(n);
  if (!nc.ok) return resp({ ok:false, error:nc.error }, 400);

  if (type === "PRICE") {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return resp({ ok:false, error:"BAD_PRICE" }, 400);
    if (p > 5000000) return resp({ ok:false, error:"PRICE_TOO_HIGH" }, 400);
  }

  const { token, setCookie } = await ensureToken(request);

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ua = request.headers.get("User-Agent") || "";
  const fp = await sha256(`${ip}|${ua}|${token}`);
  const lockKey = `lock:${lot}:${fp}`;

  const isAdmin = (n === ADMIN_NAME);
  if (!isAdmin) {
    const locked = await env.HS_KV.get(lockKey);
    if (locked) return resp({ ok:false, error:"ALREADY_VOTED" }, 409, setCookie ? { "set-cookie": setCookie } : {});
  }

  const raw = await env.HS_KV.get("state");
  const state = raw ? JSON.parse(raw) : {
    updatedAt: Date.now(),
    lots: { lot1:{unsold:0,prices:[],series:[]}, lot2:{unsold:0,prices:[],series:[]} },
    comments:[]
  };

  const ls = state.lots[lot];
  if (type === "UNSOLD") ls.unsold += 1;
  else {
    ls.prices.push(Number(price));
    if (ls.prices.length > 400) ls.prices = ls.prices.slice(-400);
  }

  const total = ls.unsold + ls.prices.length;
  const settleProb = total ? (100 - (ls.unsold/total)*100) : 0;
  ls.series.push({ ts: Date.now(), v: settleProb });
  if (ls.series.length > 500) ls.series = ls.series.slice(-500);

  state.updatedAt = Date.now();
  await env.HS_KV.put("state", JSON.stringify(state));

  if (!isAdmin) await env.HS_KV.put(lockKey, "1");

  return resp({ ok:true, state }, 200, setCookie ? { "set-cookie": setCookie } : {});
}

function validateName(n){
  if(!n) return {ok:false,error:"NAME_REQUIRED"};
  if(n.length>30) return {ok:false,error:"NAME_TOO_LONG"};
  if(containsAny(n, PROFANITY)) return {ok:false,error:"NAME_PROFANITY"};
  if(containsAny(n, POL_TITLE)) return {ok:false,error:"NAME_DISALLOWED"};
  return {ok:true};
}
function containsAny(t, arr){ return arr.some(x=>x && t.includes(x)); }

async function ensureToken(request){
  const cookie = request.headers.get("Cookie") || "";
  const found = cookie.match(/hsid=([a-zA-Z0-9_-]+)/);
  if(found && found[1]) return { token:found[1], setCookie:null };

  const token = randomToken(24);
  const setCookie = `hsid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
  return { token, setCookie };
}
function randomToken(len){
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g,"").slice(0,len);
}
async function sha256(str){
  const buf = new TextEncoder().encode(str);
  const dig = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(dig)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function resp(obj, status=200, extraHeaders={}){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", ...extraHeaders }
  });
}
