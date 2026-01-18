// functions/notes.js
// Robust auction notes fetcher for Cloudflare Pages Functions
// Strategy:
// 1) Try category page (may be JS-rendered -> no links)
// 2) Fallback to sitemap discovery (usually static and reliable):
//    - fetch https://www.artsaca.com/sitemap.xml
//    - if it's a sitemap index, fetch child sitemaps (bounded)
//    - extract /post/auctionNNN urls, sort by N desc, take limit
// 3) For each url, fetch og:title/og:image for display (optional; safe)

export async function onRequestGet({ request }) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = clampInt(searchParams.get("limit"), 10, 1, 20);

    // 1) Get candidate URLs (category → sitemap fallback)
    let urls = await urlsFromCategory(limit);

    let method = "category";
    if (!urls.length) {
      urls = await urlsFromSitemaps(limit);
      method = "sitemap";
    }

    // If still empty, return diagnostics
    if (!urls.length) {
      return json({ ok: true, items: [], debug: { extracted: 0, method } }, 200);
    }

    // 2) Enrich with og:title / og:image (best-effort)
    const items = await Promise.all(
      urls.slice(0, limit).map(async (url) => {
        const slug = (url.split("/post/")[1] || "").trim();
        try {
          const r = await fetch(url, {
            headers: {
              "user-agent": "Mozilla/5.0 (compatible; AuctionNotesFetcher/6.0)",
              "accept": "text/html,application/xhtml+xml",
              "accept-language": "zh-TW,zh;q=0.9,en;q=0.7",
            },
          });
          if (!r.ok) return { title: slug || url, url, slug, image: "" };

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

          return { title: cleanTitle(decodeHtml(rawTitle)), url, slug, image };
        } catch {
          return { title: slug || url, url, slug, image: "" };
        }
      })
    );

    return json({ ok: true, items, debug: { extracted: urls.length, method } }, 200);
  } catch (e) {
    return json({ ok: false, error: "UNEXPECTED_ERROR", detail: String(e?.message || e) }, 500);
  }
}

/* -----------------------
   URL discovery
------------------------ */

async function urlsFromCategory(limit) {
  try {
    const categoryUrl = "https://www.artsaca.com/artsaca/categories/auctionnotes";
    const catRes = await fetch(categoryUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; AuctionNotesFetcher/6.0)",
        "accept": "text/html,application/xhtml+xml",
      },
    });
    if (!catRes.ok) return [];
    const html = await catRes.text();

    const set = new Set();
    for (const m of html.matchAll(/href="(\/post\/auction\d+)"/gi)) {
      set.add("https://www.artsaca.com" + m[1]);
      if (set.size >= limit) break;
    }
    // fallback: any /post/slug
    if (set.size === 0) {
      for (const m of html.matchAll(/href="(\/post\/[a-zA-Z0-9\-_%]+)"/g)) {
        set.add("https://www.artsaca.com" + m[1]);
        if (set.size >= limit) break;
      }
    }
    return Array.from(set);
  } catch {
    return [];
  }
}

async function urlsFromSitemaps(limit) {
  const root = "https://www.artsaca.com/sitemap.xml";
  const childSitemaps = await discoverSitemaps(root);

  // Fetch up to 10 sitemaps to keep it fast
  const toFetch = childSitemaps.length ? childSitemaps.slice(0, 10) : [root];

  const urlMap = new Map(); // url -> numeric id for sorting
  for (const sm of toFetch) {
    try {
      const r = await fetch(sm, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!r.ok) continue;
      const xml = await r.text();

      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        const u = m[1].trim();
        const mm = u.match(/\/post\/auction(\d+)\b/i);
        if (mm) {
          const id = Number(mm[1]);
          urlMap.set(u, Number.isFinite(id) ? id : 0);
        }
      }
    } catch {
      // ignore
    }
  }

  const urls = Array.from(urlMap.entries())
    .sort((a, b) => (b[1] - a[1])) // highest auction number first
    .map(([u]) => u);

  return urls.slice(0, limit);
}

async function discoverSitemaps(rootUrl) {
  // If root is a sitemapindex, return child sitemap URLs; else return []
  try {
    const r = await fetch(rootUrl, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!r.ok) return [];
    const xml = await r.text();
    const isIndex = /<sitemapindex\b/i.test(xml);
    if (!isIndex) return [];

    const out = [];
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const u = m[1].trim();
      if (u.endsWith(".xml")) out.push(u);
    }
    return out;
  } catch {
    return [];
  }
}

/* -----------------------
   Helpers
------------------------ */

function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function getMeta(html, attr, value) {
  const re = new RegExp(`<meta[^>]+${attr}="${escapeRegExp(value)}"[^>]+content="([^"]+)"`, "i");
  const m = html.match(re);
  return m ? m[1] : "";
}

function getTitleTag(html) {
  const m = html.match(/<title[^>]*>([^<]{1,400})<\/title>/i);
  return m ? m[1] : "";
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanTitle(t) {
  return (t || "").replace(/\s*\|\s*.*$/g, "").trim();
}

function decodeHtml(s) {
  return (s || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
