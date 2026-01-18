export async function onRequestGet({ request }) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(20, Number(searchParams.get("limit") || 10)));

    const CATEGORY_URL = "https://www.artsaca.com/artsaca/categories/auctionnotes";

    const resp = await fetch(CATEGORY_URL, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SACA-NotesFetcher/2.0)",
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.7",
      },
    });

    if (!resp.ok) return json({ ok: false, error: `FETCH_CATEGORY_${resp.status}` }, 502);

    const html = await resp.text();

    // 1) Collect unique post URLs
    const urlSet = new Set();

    for (const m of html.matchAll(/https:\/\/www\.artsaca\.com\/post\/[a-zA-Z0-9\-_%]+/g)) {
      urlSet.add(m[0]);
    }
    for (const m of html.matchAll(/href="(\/post\/[a-zA-Z0-9\-_%]+)"/g)) {
      urlSet.add("https://www.artsaca.com" + m[1]);
    }

    const urls = Array.from(urlSet).slice(0, limit);

    // 2) Fetch each post page to extract a real title
    const items = await Promise.all(
      urls.map(async (url) => {
        const page = await fetch(url, {
          headers: {
            "user-agent": "Mozilla/5.0 (compatible; SACA-NotesFetcher/2.0)",
            "accept": "text/html,application/xhtml+xml",
            "accept-language": "zh-TW,zh;q=0.9,en;q=0.7",
          },
        });

        if (!page.ok) {
          return { title: slugToTitle(url), url, note: `FETCH_POST_${page.status}` };
        }

        const postHtml = await page.text();

        // Prefer og:title (Wix usually has it)
        let title =
          getMeta(postHtml, "property", "og:title") ||
          getMeta(postHtml, "name", "twitter:title") ||
          getTitleTag(postHtml) ||
          getJsonLdHeadline(postHtml) ||
          slugToTitle(url);

        title = cleanTitle(decodeHtml(title));

        return { title, url };
      })
    );

    return json({ ok: true, items }, 200);
  } catch (e) {
    return json({ ok: false, error: "UNEXPECTED_ERROR", detail: String(e?.message || e) }, 500);
  }
}

function getMeta(html, attr, value) {
  // e.g. <meta property="og:title" content="...">
  const re = new RegExp(`<meta[^>]+${attr}="${escapeRegExp(value)}"[^>]+content="([^"]+)"`, "i");
  const m = html.match(re);
  return m ? m[1] : "";
}

function getTitleTag(html) {
  const m = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  return m ? m[1] : "";
}

function getJsonLdHeadline(html) {
  // Many sites embed JSON-LD with "headline":"..."
  const m = html.match(/"headline"\s*:\s*"([^"]{3,300})"/i);
  return m ? m[1] : "";
}

function slugToTitle(url) {
  const slug = url.split("/post/")[1] || url;
  // Keep the original slug if you prefer; here we make it readable.
  return slug.replace(/[-_]/g, " ");
}

function cleanTitle(t) {
  // Remove common suffixes like " | SACA學會" / " | artsaca"
  return t
    .replace(/\s*\|\s*artsaca\.com\s*$/i, "")
    .replace(/\s*\|\s*SACA.*$/i, "")
    .trim();
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

function decodeHtml(s) {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

