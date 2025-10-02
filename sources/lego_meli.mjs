// sources/lego_meli.mjs
// Scraper de LEGO (>=25% OFF) en MercadoLibre SIN API.
// Estrategia: descargar HTML y, por cada <a href="...mercadolibre.com.mx/...">,
// buscar cerca el título, precio, precio original y "% OFF".

const MIN_DISCOUNT = Number(process.env.LEGO_MIN_DISCOUNT ?? 25);
const LIST_URL =
  'https://listado.mercadolibre.com.mx/juegos-juguetes/juegos-construccion/bloques-figuras-armar/lego/lego_Discount_5-100_NoIndex_True#applied_filter_id%3Ddiscount%26applied_filter_name%3DDescuentos%26applied_filter_order%3D9%26applied_value_id%3D25-100%26applied_value_name%3DDesde+25%25+OFF%26applied_value_order%3D4%26applied_value_results%3D237%26is_custom%3Dfalse';

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-MX,es;q=0.9',
      'Cache-Control': 'no-cache',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`ML HTML ${res.status}: ${t.slice(0, 180)}`);
  }
  return res.text();
}

function cleanNum(txt) {
  if (txt == null) return null;
  const n = Number(String(txt).replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function decodeEntities(s = '') {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function simpleParse(html) {
  const items = [];
  const seen = new Set();

  // Cazamos anchors a páginas de producto
  const anchorRe = /<a\b[^>]*href="(https:\/\/(?:articulo|www)\.mercadolibre\.com\.mx\/[^"]+)"[^>]*>/gi;
  let m;
  while ((m = anchorRe.exec(html))) {
    let url = decodeEntities(m[1]);
    if (seen.has(url)) continue;
    seen.add(url);

    // Tomamos un "slice" alrededor para extraer título, precio y descuento
    const start = Math.max(0, m.index - 4000);
    const end = Math.min(html.length, m.index + 4000);
    const slice = html.slice(start, end);

    // TÍTULO (varias variantes)
    const tMatch =
      slice.match(/ui-search-item__title[^>]*>([^<]{5,200})</i) ||
      slice.match(/poly-component__title[^>]*>([^<]{5,200})</i) ||
      slice.match(/"title":"([^"]{5,200})"/) ||
      slice.match(/"name":"([^"]{5,200})"/);
    const rawTitle = tMatch ? tMatch[1] : '';
    const title = decodeEntities(rawTitle.replace(/\\"/g, '"')).trim();
    if (!/lego/i.test(title)) continue; // nos quedamos solo con LEGO

    // PRECIO actual (acepta coma o punto)
const fracNow  = slice.match(/andes-money-amount__fraction[^>]*>([\d.,]+)/i);
const centsNow = slice.match(/andes-money-amount__cents[^>]*>(\d{2})/i);
let priceNum   = fracNow ? cleanNum(fracNow[1]) : null;
// (centavos opcionales en centsNow; no los usamos para el %)

// PRECIO original (tachado) – también acepta coma o punto
const fracOrig = slice.match(/andes-money-amount__original[^>]*>[\s\S]*?andes-money-amount__fraction[^>]*>([\d.,]+)/i);
let origNum    = fracOrig ? cleanNum(fracOrig[1]) : null;

    // DESCUENTO explícito
    const off = slice.match(/(\d{1,3})%\s*OFF/i);
    let pct = off ? Number(off[1]) : null;
    if (pct == null && priceNum != null && origNum != null && origNum > 0) {
      pct = Math.round(((origNum - priceNum) / origNum) * 100);
    }

    if (pct == null || pct < MIN_DISCOUNT) continue; // usa el mínimo desde env

    items.push({
      title,
      url,
      price: priceNum != null ? `$${priceNum.toLocaleString('es-MX')}` : '',
      original: origNum != null ? `$${origNum.toLocaleString('es-MX')}` : null,
      pct,
    });
  }

  return items;
}

export async function getLegoDeals(limit = 12) {
  try {
    const html = await fetchHtml(LIST_URL);
    let items = simpleParse(html);

    // Ordenar por mayor % OFF primero
    items.sort((a, b) => {
      if (a.pct == null && b.pct == null) return 0;
      if (a.pct == null) return 1;
      if (b.pct == null) return -1;
      return b.pct - a.pct;
    });

   console.log(`Encontrados con >=${MIN_DISCOUNT}% OFF: ${items.length}`);
    return items.slice(0, limit);
  } catch (e) {
    console.error('❌ Error MercadoLibre:', e);
    return [];
  }
}

// CLI local: `node sources/lego_meli.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const deals = await getLegoDeals(20);
  console.log(`✅ Promos LEGO (>=${MIN_DISCOUNT}% OFF):`);
  console.log(deals);
}
