// sources/mercadolibre.mjs
// Lee la página pública filtrada (>=25% OFF) y extrae título, precio y url.
// No requiere token.

const LIST_URL =
  "https://listado.mercadolibre.com.mx/juegos-juguetes/juegos-construccion/bloques-figuras-armar/lego/lego_Discount_25-100_NoIndex_True#applied_filter_id=discount&applied_filter_name=Descuentos&applied_filter_order=9&applied_value_id=25-100&applied_value_name=Desde%2025%25%20OFF&applied_value_order=4&applied_value_results=237&is_custom=false";

export async function getLegoPromos(limit = 5) {
  try {
    const res = await fetch(LIST_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // 1) Intento principal: JSON-LD tipo ItemList
    const itemsFromLd = extractFromJsonLd(html);
    let items = itemsFromLd;

    // 2) Respaldo sencillo si no hubo JSON-LD
    if (!items.length) {
      items = extractFromAnchors(html);
    }

    // Limpieza y recorte
    const seen = new Set();
    const out = [];
    for (const it of items) {
      const url = absolutize(it.url || "");
      const title = (it.title || "").trim();
      const price = it.price ? formatPrice(it.price) : "";

      // Filtro dominio MX y deduplicación por URL base
      if (
        !/^https?:\/\/(?:www\.|articulo\.|producto\.)?mercadolibre\.com\.mx/i.test(
          url
        )
      )
        continue;
      const key = url.split("?")[0];
      if (!title || seen.has(key)) continue;
      seen.add(key);
      out.push({ title, url, price });
      if (out.length >= limit) break;
    }

    return out;
  } catch (e) {
    console.error("❌ Error MercadoLibre (HTML):", e?.message || e);
    return [];
  }
}

function extractFromJsonLd(html) {
  const out = [];
  const re =
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  const blocks = [...html.matchAll(re)];
  for (const m of blocks) {
    try {
      const data = JSON.parse(m[1].trim());
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        if (
          (d["@type"] === "ItemList" || d["@type"] === "List") &&
          Array.isArray(d.itemListElement)
        ) {
          for (const li of d.itemListElement) {
            const prod = li.item || li;
            const url = prod?.url || "";
            const title = prod?.name || prod?.title || "";
            const price =
              prod?.offers?.price ??
              prod?.offers?.lowPrice ??
              prod?.price ??
              "";
            if (url && title) out.push({ url, title: decode(title), price });
          }
        }
      }
    } catch {
      // ignorar bloques inválidos
    }
  }
  return out;
}

function extractFromAnchors(html) {
  const out = [];
  // intento simple: <a ... href="https://articulo.mercadolibre.com.mx/..."><h2>Nombre</h2>
  const re =
    /<a[^>]+href="(https?:\/\/(?:articulo|producto)\.mercadolibre\.com\.mx[^"]+)"[^>]*>[\s\S]*?(?:<h2[^>]*>([^<]{3,200})<\/h2>)/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1];
    const title = decode(m[2] || "");
    if (url && title) out.push({ url, title, price: "" });
  }
  return out;
}

function absolutize(u = "") {
  if (!u) return u;
  if (u.startsWith("//")) return `https:${u}`;
  if (/^https?:\/\//i.test(u)) return u;
  return `https://www.mercadolibre.com.mx${u.startsWith("/") ? "" : "/"}${u}`;
}

function formatPrice(p) {
  // p puede venir como string o número
  const num = Number(String(p).replace(/[^\d.]/g, ""));
  if (!isFinite(num)) return "";
  return num.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
}

function decode(s = "") {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export default { getLegoPromos };