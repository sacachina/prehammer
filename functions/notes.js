
// notes.js — list + modal summary
export async function onRequestGet({ request }) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(20, Number(searchParams.get("limit") || 10)));
    const slug = searchParams.get("slug");

    if (slug) {
      return await fetchSingle(slug);
    }

    const CATEGORY_URL = "https://www.artsaca.com/artsaca/categories/auctionnotes";
    const resp = await fetch(CATEGORY_URL, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; AuctionNotesBot/1.0)",
        "accept": "text/html",
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.7",
      },
    });
    if (!resp.ok) return json({ ok: false, error: "FETCH_CATEGORY_FAILED" }, 502);
    const html = await resp.text();

    const urlSet = new Set();
    for (const m of html.matchAll(/href="(\/post\/[a-zA-Z0-9\-_%]+)"/g)) {
      urlSet.add("https://www.artsaca.com" + m[1]);
    }
    const urls = Array.from(urlSet).slice(0, limit);

    const items = await Promise.all(urls.map(async (url) => {
      const p = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!p.ok) return { title: fallbackTitle(url), url };
      const h = await p.text();

      const raw =
        getMeta(h, "property", "og:title") ||
        getTitle(h) ||
        fallbackTitle(url);

      const image = getMeta(h, "property", "og:image") || "";

      return {
        title: normalize(raw) || raw,
        url,
        slug: url.split("/post/")[1],
        image,
      };
    }));

    return json({ ok: true, items });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function fetchSingle(slug) {
  const url = `https://www.artsaca.com/post/${slug}`;
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!r.ok) return json({ ok: false, error: "FETCH_POST_FAILED" }, 502);
  const h = await r.text();

  const title =
    getMeta(h, "property", "og:title") ||
    getTitle(h) ||
    slug;

  const image = getMeta(h, "property", "og:image") || "";
  const p = h.match(/<p[^>]*>([\s\S]{80,800}?)<\/p>/i);
  const excerpt = p ? strip(p[1]) : "";

  return json({
    ok: true,
    note: { slug, title: clean(title), image, excerpt, url },
  });
}

function normalize(t) {
  const vol = (t.match(/vol\.\s*\d+/i) || [])[0];
  const subject = (t.match(/：([^，,]+)/) || [])[1];
  const house = (t.match(/(Sotheby’s|Christie’s)[^0-9]*(\d{4})/) || []);
  const price =
    (t.match(/([0-9.]+)\s*萬?美元/i) && `USD ${(Number(RegExp.$1)/100).toFixed(1)}m`) ||
    (t.match(/([0-9.]+)\s*萬?港元/i) && `HKD ${(Number(RegExp.$1)/100).toFixed(1)}m`) ||
    "";

  return [vol, subject, house[0], price].filter(Boolean).join("｜");
}

function getMeta(h, a, v) {
  const m = h.match(new RegExp(`<meta[^>]+${a}="${v}"[^>]+content="([^"]+)"`, "i"));
  return m ? m[1] : "";
}
function getTitle(h) {
  const m = h.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1] : "";
}
function clean(t){ return t.replace(/\s*\|.*$/, "").trim(); }
function fallbackTitle(u){ return u.split("/post/")[1]; }
function strip(s){ return s.replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim(); }
function json(o, s=200){ return new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}}); }
