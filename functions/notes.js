export async function onRequestGet({ request }) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(20, Number(searchParams.get("limit") || 10)));

    const CATEGORY_URL = "https://www.artsaca.com/artsaca/categories/auctionnotes";

    // 抓分類頁（Wix 通常會根據 UA/Accept 回不同版本，這裡做一點點偽裝更穩）
    const resp = await fetch(CATEGORY_URL, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SACA-NotesFetcher/1.0)",
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.7",
      },
    });

    if (!resp.ok) {
      return json({ ok: false, error: `FETCH_FAILED_${resp.status}` }, 502);
    }

    const html = await resp.text();

    // 1) 先抓所有 /post/ 文章 URL（Wix 分類頁一定會包含）
    // 可能是相對路徑 "/post/xxx" 或絕對路徑 "https://www.artsaca.com/post/xxx"
    const urlSet = new Set();

    // 絕對路徑
    for (const m of html.matchAll(/https:\/\/www\.artsaca\.com\/post\/[a-zA-Z0-9\-_%]+/g)) {
      urlSet.add(m[0]);
    }
    // 相對路徑
    for (const m of html.matchAll(/href="(\/post\/[a-zA-Z0-9\-_%]+)"/g)) {
      urlSet.add("https://www.artsaca.com" + m[1]);
    }

    const urls = Array.from(urlSet);

    // 2) 生成 items：優先用附近的 <img alt="..."> 作為標題
    const items = [];
    for (const url of urls) {
      if (items.length >= limit) break;

      // 在 HTML 中找到這個 url 的出現位置，嘗試向前找 alt
      const idx = html.indexOf(url);
      let title = "";

      if (idx !== -1) {
        const sliceStart = Math.max(0, idx - 800);
        const slice = html.slice(sliceStart, idx + 200);

        // Wix 卡片圖片 alt 常含完整標題（你這頁就有）:contentReference[oaicite:1]{index=1}
        const altMatch = slice.match(/alt="([^"]{3,200})"/);
        if (altMatch) title = decodeHtml(altMatch[1]);
      }

      if (!title) {
        // 退回：用 URL slug 當標題
        title = url.split("/post/")[1].replace(/[-_]/g, " ");
      }

      items.push({ title, url });
    }

    return json({ ok: true, items }, 200);
  } catch (e) {
    return json({ ok: false, error: "UNEXPECTED_ERROR", detail: String(e?.message || e) }, 500);
  }
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

// 簡單 HTML entity decode（足夠用於 alt/title）
function decodeHtml(s) {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
