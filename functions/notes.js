
// functions/notes.js — list + modal summary
export async function onRequestGet({ request }) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(20, Number(searchParams.get("limit") || 10)));
    const slug = searchParams.get("slug");

    if (slug) return await fetchSingle(slug);

    const CATEGORY_URL = "https://www.artsaca.com/artsaca/categories/auctionnotes";
    const resp = await fetch(CATEGORY_URL, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!resp.ok) return json({ ok:false }, 502);
    const html = await resp.text();

    const urls = [...new Set([...html.matchAll(/href="(\/post\/[^"]+)"/g)].map(m=>"https://www.artsaca.com"+m[1]))].slice(0,limit);

    const items = await Promise.all(urls.map(async url=>{
      const p = await fetch(url);
      const h = await p.text();
      return {
        slug: url.split("/post/")[1],
        url,
        title: getMeta(h,"property","og:title") || url,
        image: getMeta(h,"property","og:image") || ""
      };
    }));

    return json({ ok:true, items });
  } catch(e){ return json({ ok:false, error:String(e) },500);}
}

async function fetchSingle(slug){
  const url = `https://www.artsaca.com/post/${slug}`;
  const r = await fetch(url);
  const h = await r.text();
  const p = h.match(/<p[^>]*>([\s\S]{80,800})<\/p>/i);
  return json({
    ok:true,
    note:{
      slug,
      url,
      title:getMeta(h,"property","og:title")||slug,
      image:getMeta(h,"property","og:image")||"",
      excerpt:p?p[1].replace(/<[^>]+>/g,""):""
    }
  });
}

function getMeta(h,a,v){
  const m = h.match(new RegExp(`<meta[^>]+${a}="${v}"[^>]+content="([^"]+)"`,"i"));
  return m?m[1]:"";
}
function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});}
