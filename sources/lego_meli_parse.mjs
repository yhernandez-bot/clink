// sources/lego_meli_parse.mjs
import { readFile } from 'fs/promises';
import { load } from 'cheerio';

function parsePercent(txt) {
  if (!txt) return null;
  const m = String(txt).match(/(\d+)\s*%/);
  return m ? parseInt(m[1], 10) : null;
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    const k = keyFn(it);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it);
    }
  }
  return out;
}

function tryPreloadedState($) {
  const scripts = $('script')
    .toArray()
    .map(s => $(s).html() || '');

  let jsonText = null;
  for (const txt of scripts) {
    const m =
      txt &&
      txt.match(/__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (m) {
      jsonText = m[1];
      break;
    }
  }
  if (!jsonText) return [];

  let state;
  try {
    state = JSON.parse(jsonText);
  } catch {
    return [];
  }

  // Recorremos todo el objeto buscando objetos con {permalink, title}
  const results = [];
  const stack = [state];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
    } else if (cur && typeof cur === 'object') {
      const url = cur.permalink || cur.permaLink || cur.url || null;
      const title = cur.title || cur.name || null;
      const price =
        cur.price?.amount ??
        cur.price ??
        cur.prices?.prices?.[0]?.amount ??
        null;
      const discount =
        cur.discount ??
        cur.discount_rate ??
        cur.price?.discount_rate ??
        null;
      if (url && title) {
        results.push({
          title: String(title).trim(),
          price: price ?? null,
          discount,
          url,
        });
      }
      for (const k in cur) stack.push(cur[k]);
    }
  }

  return uniqBy(
    results.filter(r => /mercadolibre\.com\.mx/i.test(r.url)),
    r => r.url
  );
}

function tryDom($) {
  const items = [];
  $('li.ui-search-layout__item, div.ui-search-layout__item, li.ui-search-layout__item--stack')
    .each((_, el) => {
      const $el = $(el);

      const $a =
        $el.find('a.ui-search-link').first().length
          ? $el.find('a.ui-search-link').first()
          : $el.find('a.ui-search-item__group__element.ui-search-link__title-card').first().length
          ? $el.find('a.ui-search-item__group__element.ui-search-link__title-card').first()
          : $el.find('a[data-testid="item-title"]').first().length
          ? $el.find('a[data-testid="item-title"]').first()
          : $el.find('a').first();

      const url = ($a.attr('href') || '').trim();
      const title =
        $el.find('h2.ui-search-item__title').first().text().trim() ||
        $a.attr('title')?.trim() ||
        $a.text().trim() ||
        $el.find('h2').first().text().trim();

      let frac = $el.find('.andes-money-amount__fraction').first().text().trim();
      frac = frac.replace(/\./g, '').replace(/\s/g, '');
      const cents = $el.find('.andes-money-amount__cents').first().text().trim();
      const price = frac ? ('$' + frac + (cents ? '.' + cents : '')) : null;

      const discountTxt =
        $el.find('.ui-search-price__discount, .ui-search-item__discount, [class*="discount"]').first().text().trim() ||
        null;

      if (url && title) {
        items.push({
          title,
          price,
          discount: discountTxt,
          url,
        });
      }
    });
  return items;
}

try {
  const html = await readFile('ml_dump.html', 'utf8');
  const $ = load(html);

  // 1) Intento por estado pre-cargado (más confiable)
  let items = tryPreloadedState($);

  // 2) Fallback por DOM si lo anterior no trae nada
  if (!items.length) {
    items = tryDom($);
  }

  // 3) Filtrar por LEGO y (si hay dato) >=25%
  let lego = items.filter(it => /lego/i.test(it.title || ''));
  lego = lego.filter(it => {
    const d = parsePercent(it.discount);
    return d == null || d >= 25; // mantenemos sin descuento explícito (la URL ya filtró 25%+)
  });

  // 4) Limpieza / normalización
  lego = uniqBy(lego, it => it.url || it.title);
  lego = lego.map(it => ({
    title: it.title,
    price: it.price,
    discount: typeof it.discount === 'number' ? `${it.discount}% OFF` : it.discount || null,
    url: it.url,
  }));

  console.log(`Total LEGO encontrados: ${lego.length}`);
  console.log(lego.slice(0, 15));
} catch (err) {
  console.error('❌ Error parseando ml_dump.html:', err?.message || err);
}