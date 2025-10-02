// sources/lego_meli.mjs
// Scraper de LEGO (>=25% OFF) en MercadoLibre SIN API.
// Estrategia: descargar HTML y, por cada <a href="...mercadolibre.com.mx/...">,
// buscar cerca el título, precio, precio original y "% OFF".


const PROXY_URL = process.env.PROXY_URL || '';

async function fetchWithProxy(targetUrl, init = {}) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    ...(init.headers || {})
  };
  if (PROXY_URL) {
    const proxied = PROXY_URL + encodeURIComponent(targetUrl);
    return fetch(proxied, { ...init, headers });
  }
  return fetch(targetUrl, { ...init, headers });
}


const MIN_DISCOUNT = Number(process.env.LEGO_MIN_DISCOUNT ?? 25);
const LIST_URL =
  'https://listado.mercadolibre.com.mx/juegos-juguetes/juegos-construccion/bloques-figuras-armar/lego/lego_Discount_5-100_NoIndex_True#applied_filter_id%3Ddiscount%26applied_filter_name%3DDescuentos%26applied_filter_order%3D9%26applied_value_id%3D25-100%26applied_value_name%3DDesde+25%25+OFF%26applied_value_order%3D4%26applied_value_results%3D237%26is_custom%3Dfalse';

async function fetchHtml(url) {
  const res = await fetchWithProxy(url, {
  headers: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-MX,es;q=0.9',
    'Cache-Control': 'no-cache'
  }
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

  // Contadores de diagnóstico
  let aCount = 0, legoCount = 0, priceCount = 0, origCount = 0, pctCount = 0;

  // Cazamos anchors a páginas de producto
  const anchorRe = /<a\b[^>]*href="(https:\/\/(?:articulo|www)\.mercadolibre\.com\.mx\/[^"]+)"[^>]*>/gi;
  let m;
  while ((m = anchorRe.exec(html))) {
    aCount++;

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
    legoCount++;

    // PRECIO actual
    const fracNow  = slice.match(/andes-money-amount__fraction[^>]*>([\d.,]+)/i);
    const centsNow = slice.match(/andes-money-amount__cents[^>]*>(\d{2})/i);
    let priceNum   = fracNow ? cleanNum(fracNow[1]) : null;
    if (priceNum != null) priceCount++;

    // PRECIO original (tachado)
    const fracOrig = slice.match(/andes-money-amount__original[^>]*>[\s\S]*?andes-money-amount__fraction[^>]*>([\d.,]+)/i);
    let origNum    = fracOrig ? cleanNum(fracOrig[1]) : null;
    if (origNum != null) origCount++;

    // DESCUENTO explícito o calculado
    const off = slice.match(/(\d{1,3})%\s*OFF/i);
    let pct = off ? Number(off[1]) : null;
    if (pct == null && priceNum != null && origNum != null && origNum > 0) {
      pct = Math.round(((origNum - priceNum) / origNum) * 100);
    }
    if (pct != null) pctCount++;

    // ⛔️ YA NO filtramos aquí por porcentaje; eso se hace afuera
    items.push({
      title,
      url,
      price: priceNum != null ? `$${priceNum.toLocaleString('es-MX')}` : '',
      original: origNum != null ? `$${origNum.toLocaleString('es-MX')}` : null,
      pct,
    });
  }

  console.log('parse stats:', { anchors: aCount, legoTitles: legoCount, price: priceCount, original: origCount, pct: pctCount, pushed: items.length });
  return items;
}

// Fallback: usar la API pública cuando el HTML trae captcha/bloqueo
async function fetchDealsViaAPI(minPct = MIN_DISCOUNT, max = 200) {
  const url = new URL('https://api.mercadolibre.com/sites/MLM/search');
  url.searchParams.set('q', 'lego');
  url.searchParams.set('limit', String(max));

  // Buscar por API (pasando por el proxy)
  const r = await fetchWithProxy(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
      'Referer': 'https://www.mercadolibre.com.mx/'
    }
  });
  if (!r.ok) throw new Error(`ML API ${r.status}`);
  const j = await r.json();
  const results = Array.isArray(j.results) ? j.results : [];

  // Mapeo preliminar
  let prelim = results.map(x => {
    const price = x.price ?? null;
    const orig  = x.original_price ?? null;
    let pct = null;
    if (orig && price && orig > price) {
      pct = Math.round(((orig - price) / orig) * 100);
    }
    return {
      id: x.id,
      title: x.title,
      url: x.permalink || '',
      price: price != null ? `$${Number(price).toLocaleString('es-MX')}` : '',
      original: orig  != null ? `$${Number(orig ).toLocaleString('es-MX')}` : null,
      pct,
      _priceNum: price,
      _origNum:  orig
    };
  });

  // Enriquecer con la API de items para rellenar original_price si falta
  async function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
  const toEnrich = prelim.filter(d => d.pct == null && d.id).slice(0, 80); // limita peticiones

  for (const d of toEnrich) {
    try {
      const ri = await fetchWithProxy(`https://api.mercadolibre.com/items/${d.id}`, {
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
          'Referer': 'https://www.mercadolibre.com.mx/'
        }
      });
      if (!ri.ok) continue;
      const ji = await ri.json();

      const price = ji.price ?? d._priceNum ?? null;
      const orig  = ji.original_price ?? d._origNum ?? null;

      let pct = d.pct;
      if ((pct == null) && orig && price && orig > price) {
        pct = Math.round(((orig - price) / orig) * 100);
      }

      d.pct = pct ?? d.pct;
      d.price    = price != null ? `$${Number(price).toLocaleString('es-MX')}` : d.price;
      d.original = orig  != null ? `$${Number(orig ).toLocaleString('es-MX')}` : d.original;
      d.url = ji.permalink || d.url;
    } catch {
      // ignorar y seguir
    }
    await sleep(80); // suaviza rate limit
  }

  // Filtrar por mínimo solicitado
  const items = prelim.filter(d => (d.pct ?? 0) >= minPct);
  console.log(`API ML resultados: ${results.length}, enriquecidos: ${toEnrich.length}, con >=${minPct}%: ${items.length}`);
  return items;
}

export async function getLegoDeals(limit = 12) {
  try {
    const html = await fetchHtml(LIST_URL);
    console.log('ML html length:', html.length);

    const usingProxy = !!PROXY_URL;

let items;
if (usingProxy) {
  // Con proxy: intentamos primero la API (más confiable)
  try {
    items = await fetchDealsViaAPI(MIN_DISCOUNT, 200);
    console.log(`API vía proxy OK. Items: ${items.length}`);
    if (items.length === 0) {
      // Si la API no trajo nada, probamos HTML como respaldo
      const html2 = await fetchHtml(LIST_URL);
      console.log('HTML backup length:', html2.length);
      items = simpleParse(html2);
    }
  } catch (e) {
    console.error('⚠️ API vía proxy falló, usando HTML:', e?.message || e);
    const html2 = await fetchHtml(LIST_URL);
    items = simpleParse(html2);
  }
} else {
  // Sin proxy: mantenemos la lógica anterior
  const blocked = /captcha|robot|access denied|automated/i.test(html);
  console.log(blocked ? '⚠️ posible bloqueo o captcha' : 'OK contenido');
  if (blocked) {
    console.log('⚠️ Bloqueo detectado: usando API pública');
    items = await fetchDealsViaAPI(MIN_DISCOUNT, 200);
  } else {
    items = simpleParse(html);
  }
}
    // Ordenar por mayor % OFF
    items.sort((a, b) => {
      const ap = a.pct ?? -1;
      const bp = b.pct ?? -1;
      return bp - ap;
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
