export async function onRequestGet({ request }) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(20, Number(searchParams.get("limit") || 10)));

    const CATEGORY_URL = "https://www.artsaca.com/artsaca/categories/auctionnotes";

    const resp = await fetch(CATEGORY_URL, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SACA-NotesFetcher/3.0)",
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.7",
      },
    });
    if (!resp.ok) return json({ ok: false, error: "FETCH_CATEGORY_FAILED" }, 502);

    const html = await resp.text();

    // 1) Collect post URLs
    const urlSet = new Set();
    for (const m of html.matchAll(/href="(\/post\/[a-zA-Z0-9\-_%]+)"/g)) {
      urlSet.add("https://www.artsaca.com" + m[1]);
    }
    const urls = Array.from(urlSet).slice(0, limit);

    // 2) Fetch each post page and normalize title
    const items = await Promise.all(
      urls.map(async (url) => {
        const page = await fetch(url, {
          headers: {
            "user-agent": "Mozilla/5.0 (compatible; SACA-NotesFetcher/3.0)",
            "accept": "text/html,application/xhtml+xml",
            "accept-language": "zh-TW,zh;q=0.9,en;q=0.7",
          },
        });

        if (!page.ok) {
          return { title: fallbackTitle(url), url };
        }

        const postHtml = await page.text();

        const rawTitle =
          getMeta(postHtml, "property", "og:title") ||
          getMeta(postHtml, "name", "twitter:title") ||
          getTitleTag(postHtml) ||
          "";

        const normalized = normalizeAuctionTitle(rawTitle);

        return {
          title: normalized || cleanTitle(rawTitle) || fallbackTitle(url),
          url,
        };
      })
    );

    return json({ ok: true, items }, 200);
  } catch (e) {
    return json({ ok: false, error: "UNEXPECTED_ERROR", detail: String(e) }, 500);
  }
}

/* =========================
   Title normalization logic
   ========================= */

function normalizeAuctionTitle(t) {
  if (!t) return "";

  // vol.xxx
  const vol = (t.match(/vol\.\s*\d+/i) || [])[0];

  // 拍品关键词（冒号后到第一个逗号）
  const subjectMatch = t.match(/：([^，,]+)/);
  const subject = subjectMatch ? subjectMatch[1].trim() : "";

  // 拍卖行 + 年份
  const houseMatch = t.match(/(蘇富比|佳士得|Sotheby’s|Christie’s)[^0-9]*(\d{4})/);
  let house = "";
  if (houseMatch) {
    house = `${houseMatch[1].replace("蘇富比", "Sotheby’s").replace("佳士得", "Christie’s")} ${houseMatch[2]}`;
  }

  // 成交金额（优先 USD / HKD / GBP）
  let price = "";
  const priceMatch =
    t.match(/([0-9.]+)\s*萬?美元/i) ||
    t.match(/([0-9.]+)\s*萬?港元/i) ||
    t.match(/([0-9.]+)\s*萬?英鎊/i);

  if (priceMatch) {
    const v = Number(priceMatch[1]);
    if (!isNaN(v)) {
      if (/美元/i.test(priceMatch[0])) price = `USD ${formatMillion(v)}`;
      if (/港元/i.test(priceMatch[0])) price = `HKD ${formatMillion(v)}`;
      if (/英鎊/i.test(priceMatch[0])) price = `GBP ${formatMillion(v)}`;
    }
  }

  const parts = [];
  if (vol) parts.push(vol);
  if (subject) parts.push(subject);
  if (house) parts.push(house);
  if (price) parts.push(price);

  return parts.length ? parts.join("｜") : "";
}

/* ========================= */

function formatMillion(v) {
  return v >= 100 ? (v / 100).toFixed(1) + "m" : v.toFixed(1) + "m";
}

function getMeta(html, attr, value) {
  const re = new RegExp(`<meta[^>]+${attr}="${escapeRegExp(value)}"[^>]+content="([^"]+)"`, "i");
  const m = html.match(re);
  return m ? m[1] : "";
}

function getTitleTag(html) {
  const m = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  return m ? m[1] : "";
}

function cleanTitle(t) {
  return t.replace(/\s*\|.*$/, "").trim();
}

function fallbackTitle(url) {
  return url.split("/post/")[1]?.replace(/[-_]/g, " ") || "auction note";
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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
