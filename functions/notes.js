export async function onRequestGet() {
  try {
    const limit = 10;
    const url = "https://www.artsaca.com/artsaca/categories/auctionnotes";

    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0" }
    });
    const html = await res.text();

    const items = [];
    const regex = /<a[^>]+href="(\/post\/auction\d+)"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/g;

    let m;
    while ((m = regex.exec(html)) && items.length < limit) {
      items.push({
        title: m[2].replace(/<[^>]+>/g, "").trim(),
        url: "https://www.artsaca.com" + m[1]
      });
    }

    return new Response(JSON.stringify({ ok: true, items }), {
      headers: { "content-type": "application/json;charset=utf-8" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { "content-type": "application/json;charset=utf-8" }
    });
  }
}