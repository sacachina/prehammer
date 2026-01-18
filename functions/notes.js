// functions/notes.js
// Cloudflare Pages Functions (Workers runtime)
// GET /notes?limit=10
// Server-side fetch + lightweight parse of artsaca Auction Notes category page.

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit") || 10)));

  const TARGET = "https://www.artsaca.com/artsaca/categories/auctionnotes";

  try {
    const resp = await fetch(TARGET, {
      headers: {
        // A pragmatic UA helps some sites return normal HTML.
        "User-Agent": "Mozilla/5.0 (compatible; Cloudflare-Worker/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      cf: {
        cacheTtl: 300, // 5 minutes edge cache
        cacheEverything: true,
      },
    });

    if (!resp.ok) {
      return json({ ok: false, error: `upstream status ${resp.status}` }, 502);
    }

    const html = await resp.text();

    // Extract /post/ links (relative or absolute) and best-effort titles.
    const seen = new Set();
    const items = [];

    const linkRe = /href="(https?:\/\/www\.artsaca\.com)?(\/post\/[^"#?]+[^"]*)"/g;
    let m;
    while ((m = linkRe.exec(html)) && items.length < limit) {
      const rel = m[2];
      const full = `https://www.artsaca.com${rel}`;

      if (seen.has(full)) continue;
      seen.add(full);

      // Look ahead for a nearby title.
      const slice = html.slice(m.index, m.index + 900);

      let title =
        pickAttr(slice, "aria-label") ||
        pickAttr(slice, "title") ||
        pickHeading(slice) ||
        "";

      title = cleanText(title);

      if (!title) title = rel.replace(/^\/post\//, "").replace(/[-_]/g, " ");

      items.push({
        title,
        url: full,
      });
    }

    return json(
      {
        ok: true,
        fetchedAt: Date.now(),
        source: TARGET,
        items,
      },
      200,
      {
        "Cache-Control": "public, max-age=300",
      }
    );
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
}

function pickAttr(s, attrName) {
  const re = new RegExp(attrName + '="([^"]+)"');
  const m = re.exec(s);
  return m ? m[1] : "";
}

function pickHeading(s) {
  // Try to capture a nearby <h2> / <h3> title.
  const m = /<h[23][^>]*>([\s\S]{0,200}?)<\/h[23]>/.exec(s);
  if (!m) return "";
  return stripTags(m[1]);
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, " ");
}

function cleanText(s) {
  return stripTags(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}
