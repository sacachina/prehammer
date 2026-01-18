// functions/notes.js
// Auction Notes API (Wix site) for Cloudflare Pages Functions
// - GET /notes?limit=6 -> list items with normalized titles + cover image
// - GET /notes?slug=auction314 -> research summary (normalized title + first paragraph + key fields)
//
// IMPORTANT: If you use SPA fallback via _redirects (/* /index.html 200),
// you MUST exempt /notes (and /state /vote /comment) from the catch-all.

export async function onRequestGet({ request }) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = clampInt(searchParams.get("limit"), 6, 1, 20);
    const slug = (searchParams.get("slug") || "").trim();

    if (slug) {
      const note = await fetchOne(slug);
      return json({ ok: true, note }, 200);
    }

    const urls = await latestAuctionUrls(limit);
    const items = await Promise.all(urls.slice(0, limit).map(fetchListItem));
    return json({ ok: true, items, debug: { extracted: urls.length, method: "sitemap" } }, 200);
  } catch (e) {
    return json({ ok: false, error: "UNEXPECTED_ERROR", detail: String(e?.message || e) }, 500);
  }
}

/* ---------------------------
   Core fetchers
---------------------------- */
async function fetchListItem(url){
  const slug = (url.split("/post/")[1] || "").trim();
  const html = await fetchHtml(url);
  const rawTitle =
    getMeta(html, "property", "og:title") ||
    getMeta(html, "name", "twitter:title") ||
    getTitleTag(html) ||
    slug;

  const image =
    getMeta(html, "property", "og:image") ||
    getMeta(html, "name", "twitter:image") ||
    "";

  const titleText = decodeHtml(rawTitle);
  const parsed = parseAuctionTitle(titleText);

  return {
    slug,
    url,
    title: cleanTitle(titleText) || slug,
    normTitle: parsed.normTitle || (cleanTitle(titleText) || slug),
    image,
    house: parsed.house || "",
    year: parsed.year || "",
    status: parsed.status || "",
    price: parsed.price || "",
  };
}

async function fetchOne(slug){
  const url = `https://www.artsaca.com/post/${encodeURIComponent(slug)}`;
  const html = await fetchHtml(url);

  const rawTitle =
    getMeta(html, "property", "og:title") ||
    getTitleTag(html) ||
    slug;

  const image =
    getMeta(html, "property", "og:image") ||
    "";

  const titleText = decodeHtml(rawTitle);
  const parsed = parseAuctionTitle(titleText);
  const excerpt = extractFirstParagraph(html);

  return {
    slug,
    url,
    title: cleanTitle(titleText) || slug,
    normTitle: parsed.normTitle || (cleanTitle(titleText) || slug),
    excerpt,
    image,
    house: parsed.house || "",
    year: parsed.year || "",
    status: parsed.status || "",
    price: parsed.price || "",
  };
}

/* ---------------------------
   Sitemap: get latest auction### posts
---------------------------- */
async function latestAuctionUrls(limit){
  // Wix sitemap index -> child sitemaps -> locate /post/auction(\d+)
  const root = "https://www.artsaca.com/sitemap.xml";
  const sitemaps = await discoverSitemaps(root);

  const candidates = (sitemaps && sitemaps.length) ? sitemaps.slice(0, 12) : [root];

  const urlMap = new Map(); // url -> numeric id
  for(const sm of candidates){
    try{
      const xml = await fetchText(sm);
      for(const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)){
        const u = m[1].trim();
        const mm = u.match(/\/post\/auction(\d+)\b/i);
        if(mm) urlMap.set(u, Number(mm[1]));
      }
    }catch(_){}
  }

  return Array.from(urlMap.entries())
    .sort((a,b)=>b[1]-a[1])
    .map(([u])=>u)
    .slice(0, limit);
}

async function discoverSitemaps(rootUrl){
  try{
    const xml = await fetchText(rootUrl);
    if(!/<sitemapindex\b/i.test(xml)) return [];
    const out = [];
    for(const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)){
      const u = m[1].trim();
      if(u.endsWith(".xml")) out.push(u);
    }
    return out;
  }catch{
    return [];
  }
}

/* ---------------------------
   Parsing helpers
---------------------------- */
function parseAuctionTitle(t){
  const out = { normTitle:"", house:"", year:"", status:"", price:"" };
  if(!t) return out;

  // vol
  const vol = (t.match(/vol\.\s*\d+/i)||[])[0] || "";

  // status
  if(/流拍|Unsold/i.test(t)) out.status = "流拍";
  else if(/售出|Sold/i.test(t)) out.status = "成交";

  // subject (Chinese after ： until comma/，)
  const subject = ((t.match(/：([^，,]+)/)||[])[1]||"").trim();

  // house+loc+year
  let house = "";
  let year = "";
  const en = t.match(/(Sotheby’s|Sotheby's|Christie’s|Christie's)\s*([A-Z]{2})?\s*(\d{4})/);
  if(en){
    const brand = en[1].replace("Sotheby's","Sotheby’s").replace("Christie's","Christie’s");
    const loc = en[2] ? ` ${en[2]}` : "";
    house = `${brand}${loc}`.trim();
    year = en[3];
  }else{
    const zh = t.match(/(蘇富比|佳士得)([^0-9]{0,8})?(\d{4})/);
    if(zh){
      house = (zh[1]==="蘇富比") ? "Sotheby’s" : "Christie’s";
      year = zh[3];
      if(/紐約/.test(t)) house += " NY";
      else if(/倫敦/.test(t)) house += " London";
      else if(/香港/.test(t)) house += " HK";
    }
  }
  out.house = house;
  out.year = year;

  // price (normalize to m if 万)
  let price = "";
  const usdWan = t.match(/([0-9.]+)\s*萬\s*美元/i);
  const hkdWan = t.match(/([0-9.]+)\s*萬\s*港元/i);
  const gbpWan = t.match(/([0-9.]+)\s*萬\s*英鎊/i);

  if(usdWan) price = `USD ${(Number(usdWan[1])/100).toFixed(1)}m`;
  else if(hkdWan) price = `HKD ${(Number(hkdWan[1])/100).toFixed(1)}m`;
  else if(gbpWan) price = `GBP ${(Number(gbpWan[1])/100).toFixed(1)}m`;
  else{
    const gbp = t.match(/([0-9,]+)\s*GBP/i);
    if(gbp) price = `GBP ${gbp[1]}`;
    const usd = t.match(/([0-9,]+)\s*USD/i);
    if(usd) price = `USD ${usd[1]}`;
    const usdM = t.match(/USD\s*([0-9.]+)\s*m/i);
    if(usdM) price = `USD ${usdM[1]}m`;
  }
  out.price = price;

  const parts = [];
  if(vol) parts.push(vol);
  if(subject) parts.push(subject);
  if(house && year) parts.push(`${house} ${year}`.trim());
  else if(house) parts.push(house);
  if(price) parts.push(price);

  out.normTitle = parts.length >= 2 ? parts.join("｜") : "";
  return out;
}

function extractFirstParagraph(html){
  // best-effort: first <p> with enough text, strip tags
  const m = html.match(/<p[^>]*>([\s\S]{60,1200}?)<\/p>/i);
  if(!m) return "";
  return stripHtml(m[1]);
}

function stripHtml(s){
  return (s||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
}

/* ---------------------------
   HTTP helpers
---------------------------- */
async function fetchHtml(url){
  const r = await fetch(url, { headers: baseHeaders() });
  if(!r.ok) throw new Error(`FETCH_${r.status}`);
  return await r.text();
}
async function fetchText(url){
  const r = await fetch(url, { headers: baseHeaders() });
  if(!r.ok) throw new Error(`FETCH_${r.status}`);
  return await r.text();
}

function baseHeaders(){
  return {
    "user-agent": "Mozilla/5.0 (compatible; PrehammerNotes/1.0)",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "zh-TW,zh;q=0.9,en;q=0.7",
  };
}

function json(obj,status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

function clampInt(v, def, min, max){
  const n = Number(v);
  if(!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function getMeta(html, attr, value){
  const re = new RegExp(`<meta[^>]+${attr}="${escapeRegExp(value)}"[^>]+content="([^"]+)"`, "i");
  const m = html.match(re);
  return m ? m[1] : "";
}
function getTitleTag(html){
  const m = html.match(/<title[^>]*>([^<]{1,400})<\/title>/i);
  return m ? m[1] : "";
}
function escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
function cleanTitle(t){ return (t||"").replace(/\s*\|\s*.*$/g,"").trim(); }
function decodeHtml(s){
  return (s||"")
    .replaceAll("&amp;","&")
    .replaceAll("&quot;",'"')
    .replaceAll("&#x27;","'")
    .replaceAll("&#39;","'")
    .replaceAll("&lt;","<")
    .replaceAll("&gt;",">");
}
