// functions/notes.js
// Robust auction notes fetcher for Cloudflare Pages Functions
// - GET /notes?limit=10  -> list (title/url/slug/image)
// - GET /notes?slug=auction314 -> single note summary (for modal, optional)

export async function onRequestGet({ request }) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = clampInt(searchParams.get("limit"), 10, 1, 20);
    const slug = (searchParams.get("slug") || "").trim();

    if (slug) {
      return await fetchSingle(slug);
    }

    const categoryUrl = "https://www.artsaca.com/artsaca/categories/auctionnotes";
    const catRes = await fetch(categoryUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; AuctionNotesFetcher/5.0)",
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.7",
      },
    });

    if (!catRes.ok) {
      return json({ ok: false, error: `FETCH_CATEGORY_${catRes.status}` }, 502);
    }

    const catHtml = await catRes.text();

    // 1) Collect post URLs (prefer /post/auctionNNN; fallback to any /post/<slug>)
    const urlSet = new Set();

    for (const m of catHtml.matchAll(/href="(\/post\/auction\d+)"/gi)) {
      urlSet.add("https://www.artsaca.com" + m[1]);
    }
    if (urlSet.size === 0) {
      for (const m of catHtml.matchAll(/href="(\/post\/[a-zA-Z0-9\-_%]+)"/g)) {
        urlSet.add("https://www.artsaca.com" + m[1]);
      }
    }

    const urls = Array.from(urlSet).slice(0, limit);

    // 2) Fetch each post page to get stable title/image
    const items = await Promise.all(
      urls.map(async (url) => {
        const slug = (url.split("/post/")[1] || "").trim();

        const pRes = await fetch(url, {
          headers: {
            "user-agent": "Mozilla/5.0 (compatible; AuctionNotesFetcher/5.0)",
            "accept": "text/html,application/xhtml+xml",
            "accept-language": "zh-TW,zh;q=0.9,en;q=0.7",
          },
        });

        if (!pRes.ok) {
          return { title: slug || url, url, slug, image: "" };
        }

        const pHtml = await pRes.text();

        const rawTitle =
          getMeta(pHtml, "property", "og:title") ||
          getMeta(pHtml, "name", "twitter:title") ||
          getTitleTag(pHtml) ||
          slug ||
          url;

        const image =
          getMeta(pHtml, "property", "og:image") ||
          getMeta(pHtml, "name", "twitter:image") ||
          "";

        const title = normalizeAuctionTitle(decodeHtml(rawTitle)) || cleanTitle(decodeHtml(rawTitle));

        return { title, url, slug, image };
      })
    );

    // If extraction fails, items will be empty; the frontend shows a clear warning.
    return json({ ok: true, items, debug: { extracted: urls.length } }, 200);
  } catch (e) {
    return json({ ok: false, error: "UNEXPECTED_ERROR", detail: String(e?.message || e) }, 500);
  }
}

async function fetchSingle(slug) {
  const url = `https://www.artsaca.com/post/${encodeURIComponent(slug)}`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) return json({ ok: false, error: `FETCH_POST_${res.status}` }, 502);
  const html = await res.text();

  const rawTitle =
    getMeta(html, "property", "og:title") ||
    getTitleTag(html) ||
    slug;

  const image = getMeta(html, "property", "og:image") || "";

  const excerpt = extractFirstParagraph(html);

  return json({
    ok: true,
    note: {
      slug,
      url,
      title: normalizeAuctionTitle(decodeHtml(rawTitle)) || cleanTitle(decodeHtml(rawTitle)),
      image,
      excerpt,
    },
  });
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

function extractFirstParagraph(html) {
  const m = html.match(/<p[^>]*>([\s\S]{80,900}?)<\/p>/i);
  if (!m) return "";
  return stripHtml(m[1]);
}

function stripHtml(s) {
  return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/* -----------------------
   Title Normalization (B)
------------------------ */
function normalizeAuctionTitle(t) {
  if (!t) return "";

  const vol = (t.match(/vol\.\s*\d+/i) || [])[0] || "";
  const subject = ((t.match(/：([^，,]+)/) || [])[1] || "").trim();

  let house = "";
  const houseMatch = t.match(/(Sotheby’s|Christie’s)\s*([A-Z]{2})?\s*(\d{4})/);
  if (houseMatch) {
    const loc = houseMatch[2] ? ` ${houseMatch[2]}` : "";
    house = `${houseMatch[1]}${loc} ${houseMatch[3]}`.trim();
  } else {
    const zhHouse = t.match(/(蘇富比|佳士得)[^0-9]*(\d{4})/);
    if (zhHouse) {
      const h = zhHouse[1] === "蘇富比" ? "Sotheby’s" : "Christie’s";
      house = `${h} ${zhHouse[2]}`;
    }
  }

  let price = "";
  const mUsd = t.match(/([0-9.]+)\s*萬\s*美元/i);
  const mHkd = t.match(/([0-9.]+)\s*萬\s*港元/i);
  const mGbp = t.match(/([0-9.]+)\s*萬\s*英鎊/i);

  if (mUsd) price = `USD ${toMillionTag(mUsd[1])}`;
  else if (mHkd) price = `HKD ${toMillionTag(mHkd[1])}`;
  else if (mGbp) price = `GBP ${toMillionTag(mGbp[1])}`;
  else {
    const gbp = t.match(/([0-9,]+)\s*GBP/i);
    if (gbp) price = `GBP ${gbp[1]}`;
  }

  const parts = [];
  if (vol) parts.push(vol);
  if (subject) parts.push(subject);
  if (house) parts.push(house);
  if (price) parts.push(price);

  return parts.length >= 2 ? parts.join("｜") : "";
}

function toMillionTag(numStr) {
  const v = Number(numStr);
  if (!Number.isFinite(v)) return numStr;
  return (v / 100).toFixed(1) + "m";
}
