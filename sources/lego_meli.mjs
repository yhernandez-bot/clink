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

const PROXY_URL_API = process.env.PROXY_URL_API || '';

async function fetchWithProxyApi(targetUrl, init = {}) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    ...(init.headers || {})
  };
  if (PROXY_URL_API) {
    const proxied = PROXY_URL_API + encodeURIComponent(targetUrl);
    return fetch(proxied, { ...init, headers });
  }
  return fetch(targetUrl, { ...init, headers });
}


const MIN_DISCOUNT = Number(process.env.LEGO_MIN_DISCOUNT ?? 25);
const LIST_URL = 'https://listado.mercadolibre.com.mx/lego#D[A:lego]';

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

function extractMLMIds(html) {
  const ids = new Set();
  const re = /MLM\d{6,}/g; // IDs tipo MLM123456
  let m;
  while ((m = re.exec(html))) ids.add(m[0]);
  const arr = [...ids];
  console.log('mlm id stats:', { total: arr.length, sample: arr.slice(0, 10) });
  return arr;
}

function simpleParse(html) {
  const items = [];
  const seen = new Set();

  // Contadores de diagnóstico
  let aCount = 0, legoCount = 0, priceCount = 0, origCount = 0, pctCount = 0;

  // Cazamos anchors a páginas de producto (soporta https://, // y rutas relativas /p/MLMxxxxx o /MLMxxxxx)
const anchorRe = /<a\b[^>]*href="((?:https?:)?\/\/(?:[^"\/]+\.)?mercadolibre\.com\.mx\/[^"]*|\/(?:p\/)?MLM\d+[^"]*)"[^>]*>/gi;
  let m;
  while ((m = anchorRe.exec(html))) {
    aCount++;

    let url = decodeEntities(m[1]);
    
    // Normaliza URL: // -> https:, rutas relativas -> dominio completo
if (url.startsWith('//')) url = 'https:' + url;
if (url.startsWith('/'))  url = 'https://www.mercadolibre.com.mx' + url;

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

  // Buscar por API (pasando por el proxy de API, sin render)
 const r = await fetchWithProxyApi(url.toString(), {
  headers: {
    'Accept': 'application/json',
    'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
    'Referer': 'https://www.mercadolibre.com.mx/',
    'Origin': 'https://www.mercadolibre.com.mx'
  }
});
if (!r.ok) {
  const body = await r.text().catch(() => '');
  console.error('ML API fail:', r.status, body.slice(0, 400));
  throw new Error(`ML API ${r.status}`);
}
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
      const ri = await fetchWithProxyApi(`https://api.mercadolibre.com/items/${d.id}`, {
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
// Extrae ofertas desde el JSON embebido (Next.js) si existe
function extractDealsFromNextData(html) {
  const items = [];
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return items;

  let j;
  try {
    j = JSON.parse(m[1]);
  } catch {
    return items;
  }

  // Buscamos recursivamente objetos que parezcan items con permalink/price
  const stack = [j];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
    } else if (typeof node === 'object') {
      // Heurística: objeto con permalink y price/original_price
      const permalink = node.permalink || node.url || null;
      const title = node.title || node.name || null;
      const price = node.price ?? node.sale_price ?? null;
      const orig  = node.original_price ?? node.list_price ?? null;

      if (permalink && /mercadolibre\.com\.mx/i.test(permalink) && title) {
        let pct = null;
        if (orig && price && orig > price) {
          pct = Math.round(((orig - price) / orig) * 100);
        }
        items.push({
          title: String(title),
          url: String(permalink),
          price: price != null ? `$${Number(price).toLocaleString('es-MX')}` : '',
          original: orig  != null ? `$${Number(orig ).toLocaleString('es-MX')}` : null,
          pct
        });
      }

      for (const k of Object.keys(node)) {
        if (node[k] && (typeof node[k] === 'object' || Array.isArray(node[k]))) {
          stack.push(node[k]);
        }
      }
    }
  }

  // Dedup por URL
  const seen = new Set();
  const dedup = [];
  for (const it of items) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    dedup.push(it);
  }
  console.log('next_data stats:', { raw: items.length, dedup: dedup.length });
  return dedup;
}

// Lee un detalle de producto por ID intentando 2 URLs y calcula %OFF
async function fetchDealFromId(id) {
  const tryUrls = [
    `https://articulo.mercadolibre.com.mx/${id}`,
    `https://www.mercadolibre.com.mx/p/${id}`
  ];
  for (const u of tryUrls) {
    try {
      const r = await fetchWithProxy(u, {
        headers: { 'Accept-Language': 'es-MX,es;q=0.9' }
      });
      if (!r.ok) continue;
      const html = await r.text();

      // Título
      let title =
        (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]) ||
        (html.match(/"name":"([^"]{5,200})"/)?.[1]) ||
        null;

      // Precio actual y original desde HTML
      const fracNow  = html.match(/andes-money-amount__fraction[^>]*>([\d.,]+)/i);
      let priceNum   = fracNow ? cleanNum(fracNow[1]) : null;

      const fracOrig = html.match(/andes-money-amount__original[^>]*>[\s\S]*?andes-money-amount__fraction[^>]*>([\d.,]+)/i);
      let origNum    = fracOrig ? cleanNum(fracOrig[1]) : null;

      // Fallback: JSON-LD (application/ld+json)
      if (priceNum == null) {
        const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let m;
        while ((m = ldRe.exec(html))) {
          try {
            const data = JSON.parse(m[1]);
            const stack = [data];
            while (stack.length) {
              const node = stack.pop();
              if (!node) continue;
              if (Array.isArray(node)) {
                for (const v of node) stack.push(v);
              } else if (typeof node === 'object') {
                if (node.offers && (node.offers.price || node.offers.lowPrice)) {
                  const p0 = node.offers.price ?? node.offers.lowPrice;
                  priceNum = cleanNum(p0);
                }
                if (node.priceSpecification && node.priceSpecification.price) {
                  const p1 = cleanNum(node.priceSpecification.price);
                  if (p1 && !origNum) origNum = p1;
                }
                if (node.name && !title) title = String(node.name);
                for (const k of Object.keys(node)) {
                  const v = node[k];
                  if (v && (typeof v === 'object' || Array.isArray(v))) stack.push(v);
                }
              }
            }
          } catch { /* ignore */ }
          if (priceNum != null) break;
        }
      }

      if (!title) title = `LEGO ${id}`;

      let pct = null;
      if (origNum && priceNum && origNum > priceNum) {
        pct = Math.round(((origNum - priceNum) / origNum) * 100);
      }

      return {
        title,
        url: u,
        price: priceNum != null ? `$${Number(priceNum).toLocaleString('es-MX')}` : '',
        original: origNum != null ? `$${Number(origNum).toLocaleString('es-MX')}` : null,
        pct
      };
    } catch {
      // intenta con la siguiente URL
    }
  }
  return null;
}


export async function getLegoDeals(limit = 12) {
  try {
    const html = await fetchHtml(LIST_URL);
    console.log('ML html length:', html.length);

    const usingProxy = !!PROXY_URL;
    let items;

    if (usingProxy) {
      // 1) Intentar API vía proxy (si falla, caemos a HTML)
      try {
        items = await fetchDealsViaAPI(MIN_DISCOUNT, 200);
        console.log(`API vía proxy OK. Items (previo filtro): ${items.length}`);
      } catch (e) {
        console.error('⚠️ API vía proxy falló, usando HTML:', e?.message || e);
        items = simpleParse(html);

        // 2) Si HTML listado no trajo nada, intenta __NEXT_DATA__
        if (!items.length) {
          const itemsFromNext = extractDealsFromNextData(html);
          if (itemsFromNext.length) {
            items = itemsFromNext;
            console.log('usando __NEXT_DATA__');
          }
        }

        // 3) Si sigue vacío, usa IDs (MLM…) del HTML para ir a detalle
        if (!items.length) {
          const ids = extractMLMIds(html);
          console.log('fetching details for ids:', ids.length);
          const picked = ids.slice(0, 20); // limita llamadas
          const details = [];
          for (const id of picked) {
            const d = await fetchDealFromId(id);
            if (d) details.push(d);
            await new Promise(r => setTimeout(r, 120)); // suaviza rate limit
          }
          items = details;
        }
      }
    } else {
      // Sin proxy: lógica original (con detección de bloqueo)
      const blocked = /captcha|robot|access denied|automated/i.test(html);
      console.log(blocked ? '⚠️ posible bloqueo o captcha' : 'OK contenido');

      if (blocked) {
        items = await fetchDealsViaAPI(MIN_DISCOUNT, 200);
      } else {
        items = simpleParse(html);
        if (!items.length) {
          const itemsFromNext = extractDealsFromNextData(html);
          if (itemsFromNext.length) {
            items = itemsFromNext;
            console.log('usando __NEXT_DATA__');
          }
        }
      }
    }

    // Orden + filtro final + límite
    items = items || [];
    items.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
    const filtered = items.filter(x => (x.pct ?? 0) >= MIN_DISCOUNT);
    console.log(`Encontrados con >=${MIN_DISCOUNT}% OFF: ${filtered.length}`);
    return filtered.slice(0, limit);
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
