// functions/notes.js
// Sitemap-based auction notes API for Cloudflare Pages Functions
// - GET /notes?limit=6 -> list {title(norm), url, slug, image}
// - GET /notes?slug=auction314 -> note {title, normTitle, excerpt, house, year, status, price, url, image}
//
// This avoids Wix JS-rendered category pages by using sitemap.xml.

export async function onRequestGet({ request }) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = clampInt(searchParams.get("limit"), 6, 1, 20);
    const slug = (searchParams.get("slug") || "").trim();

    if (slug) return await fetchSingle(slug);

    const urls = await urlsFromSitemaps(limit);
    const items = await Promise.all(urls.slice(0, limit).map(enrichListItem));
    return json({ ok: true, items, debug: { extracted: urls.length, method: "sitemap" } }, 200);
  } catch (e) {
    return json({ ok: false, error: "UNEXPECTED_ERROR", detail: String(e?.message || e) }, 500);
  }
}

async function enrichListItem(url){
  const slug = (url.split("/post/")[1] || "").trim();
  try{
    const r = await fetch(url, { headers: baseHeaders() });
    if(!r.ok) return { title: slug || url, url, slug, image:"" };
    const h = await r.text();

    const rawTitle =
      getMeta(h, "property", "og:title") ||
      getMeta(h, "name", "twitter:title") ||
      getTitleTag(h) ||
      slug ||
      url;

    const image =
      getMeta(h, "property", "og:image") ||
      getMeta(h, "name", "twitter:image") ||
      "";

    const titleText = decodeHtml(rawTitle);
    const parsed = parseAuctionTitle(titleText);

    return {
      title: parsed.normTitle || cleanTitle(titleText) || slug,
      url, slug, image
    };
  }catch{
    return { title: slug || url, url, slug, image:"" };
  }
}

async function fetchSingle(slug){
  const url = `https://www.artsaca.com/post/${encodeURIComponent(slug)}`;
  const r = await fetch(url, { headers: baseHeaders() });
  if(!r.ok) return json({ ok:false, error:`FETCH_POST_${r.status}` }, 502);
  const h = await r.text();

  const rawTitle =
    getMeta(h, "property", "og:title") ||
    getTitleTag(h) ||
    slug;

  const image =
    getMeta(h, "property", "og:image") ||
    "";

  const titleText = decodeHtml(rawTitle);
  const parsed = parseAuctionTitle(titleText);

  const excerpt = extractFirstParagraph(h);

  return json({
    ok:true,
    note:{
      slug,
      url,
      title: cleanTitle(titleText) || slug,
      normTitle: parsed.normTitle || cleanTitle(titleText) || slug,
      excerpt,
      house: parsed.house || "",
      year: parsed.year || "",
      status: parsed.status || "",
      price: parsed.price || "",
      image
    }
  }, 200);
}

/* -----------------------
   Sitemap discovery
------------------------ */
async function urlsFromSitemaps(limit){
  const root = "https://www.artsaca.com/sitemap.xml";
  const children = await discoverSitemaps(root);
  const toFetch = children.length ? children.slice(0, 10) : [root];

  const urlMap = new Map(); // url -> numeric id
  for(const sm of toFetch){
    try{
      const r = await fetch(sm, { headers: baseHeaders() });
      if(!r.ok) continue;
      const xml = await r.text();
      for(const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)){
        const u = m[1].trim();
        const mm = u.match(/\/post\/auction(\d+)\b/i);
        if(mm){
          urlMap.set(u, Number(mm[1]));
        }
      }
    }catch{}
  }

  return Array.from(urlMap.entries())
    .sort((a,b)=>b[1]-a[1])
    .map(([u])=>u)
    .slice(0, limit);
}

async function discoverSitemaps(rootUrl){
  try{
    const r = await fetch(rootUrl, { headers: baseHeaders() });
    if(!r.ok) return [];
    const xml = await r.text();
    if(!/<sitemapindex\b/i.test(xml)) return [];
    const out = [];
    for(const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)){
      const u = m[1].trim();
      if(u.endsWith(".xml")) out.push(u);
    }
    return out;
  }catch{ return []; }
}

/* -----------------------
   Parsing & helpers
------------------------ */
function parseAuctionTitle(t){
  const out = { normTitle:"", house:"", year:"", status:"", price:"" };
  if(!t) return out;

  const vol = (t.match(/vol\.\s*\d+/i)||[])[0] || "";

  // status
  if(/流拍|Unsold/i.test(t)) out.status = "流拍";
  else if(/售出|Sold/i.test(t)) out.status = "成交";

  // subject: Chinese after colon until comma
  const subject = ((t.match(/：([^，,]+)/)||[])[1]||"").trim();

  // house + location + year
  let house = "";
  let year = "";
  const h1 = t.match(/(Sotheby’s|Christie’s)\s*([A-Z]{2})?\s*(\d{4})/);
  if(h1){
    const loc = h1[2] ? ` ${h1[2]}` : "";
    house = `${h1[1]}${loc}`.trim();
    year = h1[3];
  }else{
    const h2 = t.match(/(蘇富比|佳士得)([^0-9]{0,6})?(\d{4})/);
    if(h2){
      house = h2[1] === "蘇富比" ? "Sotheby’s" : "Christie’s";
      year = h2[3];
      // Try location in Chinese
      if(/紐約/.test(t)) house += " NY";
      else if(/倫敦/.test(t)) house += " London";
      else if(/香港/.test(t)) house += " HK";
    }
  }
  out.house = house;
  out.year = year;

  // price: convert 万→m
  let price = "";
  const mUsd = t.match(/([0-9.]+)\s*萬\s*美元/i);
  const mHkd = t.match(/([0-9.]+)\s*萬\s*港元/i);
  const mGbp = t.match(/([0-9.]+)\s*萬\s*英鎊/i);
  if(mUsd) price = `USD ${(Number(mUsd[1])/100).toFixed(1)}m`;
  else if(mHkd) price = `HKD ${(Number(mHkd[1])/100).toFixed(1)}m`;
  else if(mGbp) price = `GBP ${(Number(mGbp[1])/100).toFixed(1)}m`;
  else{
    // Already million or exact
    const gbp = t.match(/([0-9,]+)\s*GBP/i);
    if(gbp) price = `GBP ${gbp[1]}`;
    const usd = t.match(/([0-9.]+)\s*million\s*USD/i);
    if(usd) price = `USD ${usd[1]}m`;
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
  const m = html.match(/<p[^>]*>([\s\S]{80,900}?)<\/p>/i);
  if(!m) return "";
  return stripHtml(m[1]);
}
function stripHtml(s){
  return (s||"").replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim();
}

function baseHeaders(){
  return {
    "user-agent": "Mozilla/5.0 (compatible; AuctionNotesFetcher/7.0)",
    "accept": "text/html,application/xhtml+xml",
    "accept-language": "zh-TW,zh;q=0.9,en;q=0.7",
  };
}
function json(obj,status=200){
  return new Response(JSON.stringify(obj),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}
function clampInt(v,def,min,max){
  const n = Number(v);
  if(!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
function getMeta(html, attr, value) {
  const re = new RegExp(`<meta[^>]+${attr}="${escapeRegExp(value)}"[^>]+content="([^"]+)"`, "i");
  const m = html.match(re);
  return m ? m[1] : "";
}
function getTitleTag(html){
  const m = html.match(/<title[^>]*>([^<]{1,400})<\/title>/i);
  return m ? m[1] : "";
}
function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
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
