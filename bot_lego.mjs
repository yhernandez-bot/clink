// bot_lego.mjs — Bot minimalista solo LEGO (MercadoLibre)
import { Telegraf } from 'telegraf';
import 'dotenv/config';
import { getLegoDeals } from './sources/lego_meli.mjs';

const MIN_DISCOUNT = Number(process.env.LEGO_MIN_DISCOUNT ?? 25);
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID   = process.env.CHAT_ID;

// 👇 Afiliados (opcionales)
const AFF_PREFIX = process.env.AFF_PREFIX || ''; // ej: 'https://tudominio/ir?url=' o 'https://tudominio/ir?target={url}'
const AFF_PARAM  = process.env.AFF_PARAM  || ''; // ej: 'utm_source=clink'

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('Faltan BOT_TOKEN o CHAT_ID en las variables de entorno.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ————————————————————————————————
// Utilidades
// ————————————————————————————————

/**
 * Acorta/normaliza un URL de MercadoLibre eliminando query y hash,
 * y usando /p/MLMxxxxx cuando hay un id de producto.
 */
function shortMeliUrl(u) {
  try {
    const url = new URL(u);
    // Intentamos detectar id (wid o /MLMxxxxx en el path)
    const wid = url.searchParams.get('wid');
    const idMatch = url.pathname.match(/(MLM\d+)/i);
    const id = wid || (idMatch ? idMatch[1] : null);

    // Base sin query ni hash
    const base = `${url.origin}${url.pathname}`.replace(/[#?].*$/, '');

    if (id) {
      // Prefiere formato /p/MLMxxxxx (página de producto canónica)
      return `${url.origin}/p/${id}`;
    }
    return base;
  } catch {
    return u;
  }
}

/**
 * Convierte un enlace en afiliado (si hay variables configuradas).
 * - Si hay AFF_PARAM (k=v), lo agrega a la URL.
 * - Si hay AFF_PREFIX, envuelve la URL (soporta {url}).
 */
function affiliateLink(u) {
  try {
    const url = new URL(u);

    if (AFF_PARAM) {
      const [k, v = ''] = AFF_PARAM.split('=');
      if (k) url.searchParams.set(k, v);
    }

    const withParam = url.toString();

    if (AFF_PREFIX) {
      if (AFF_PREFIX.includes('{url}')) {
        return AFF_PREFIX.replace('{url}', encodeURIComponent(withParam));
      }
      return AFF_PREFIX + encodeURIComponent(withParam);
    }

    return withParam;
  } catch {
    // Si no parseó, intentamos igual envolver
    if (AFF_PREFIX) {
      if (AFF_PREFIX.includes('{url}')) {
        return AFF_PREFIX.replace('{url}', encodeURIComponent(u));
      }
      return AFF_PREFIX + encodeURIComponent(u);
    }
    return u;
  }
}

// Devuelve la URL de imagen a partir de una URL de Meli.
// Soporta: ?wid=MLMxxxxx (ítem), /MLMxxxxx en el path (ítem)
// y /p/MLMxxxxx (producto). Fallback: og:image del HTML.
async function getMeliImageFromUrl(u) {
  try {
    const url = new URL(u);
    const wid = url.searchParams.get('wid');               // ID de ítem/listing
    const pathMatch = url.pathname.match(/\/(p\/)?(MLM\d+)/i);
    const pathIsProduct = Boolean(pathMatch?.[1]);         // hay prefijo p/
    const idFromPath = pathMatch?.[2] || null;             // MLMxxxxx detectado

    // 1) si hay wid, es el ID de ítem correcto
    const itemId = wid || (!pathIsProduct ? idFromPath : null);
    if (itemId) {
      const r = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (r.ok) {
        const j = await r.json();
        return j.pictures?.[0]?.secure_url || j.thumbnail || null;
      }
    }

    // 2) si el path era /p/MLMxxxxx (producto), intenta API de products
    const productId = pathIsProduct ? idFromPath : null;
    if (productId) {
      const rp = await fetch(`https://api.mercadolibre.com/products/${productId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (rp.ok) {
        const jp = await rp.json();
        // products suele tener pictures / components.main_picture, etc.
        return (
          jp.pictures?.[0]?.secure_url ||
          jp.pictures?.[0]?.url ||
          jp.components?.main_picture?.url ||
          null
        );
      }
    }

    // 3) Último recurso: leer HTML y tomar <meta property="og:image">
    const rh = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (rh.ok) {
      const html = await rh.text();
      const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      if (m) return m[1];
    }
  } catch {
    // ignore
  }
  return null;
}

function discountBadge(pct) {
  const p = Number(pct) || 0;
  if (p >= 60) return '🔥';
  if (p >= 40) return '💥';
  if (p >= 25) return '✅';
  return '💸';
}

// ————————————————————————————————
// Envío principal
// ————————————————————————————————

async function sendLegoNow() {
  try {
    // Trae ofertas (todas) y filtra por el mínimo desde env
const allDeals = await getLegoDeals();
const filtradas = allDeals.filter(x => (x.pct ?? x.discount ?? 0) >= MIN_DISCOUNT);

// Ordena y limita
const MAX_ITEMS = Number(process.env.LEGO_MAX_ITEMS ?? 12);
const deals = filtradas
  .sort((a, b) => (b.pct ?? b.discount ?? 0) - (a.pct ?? a.discount ?? 0))
  .slice(0, MAX_ITEMS);

if (!deals.length) {
  console.log(`ℹ️ No hay promos LEGO con ≥${MIN_DISCOUNT}% OFF`);
  return;
}

// ————————————————————————————————
// HTTP Trigger (para correr en Railway)
// ————————————————————————————————
async function startHttpTrigger() {
  const http = await import('http');
  const PORT  = process.env.PORT || 3000;
  const TOKEN = process.env.HTTP_TRIGGER_TOKEN || '';

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && u.pathname === '/lego/send') {
        if (!TOKEN || u.searchParams.get('token') !== TOKEN) {
          res.statusCode = 401;
          res.end('unauthorized');
          return;
        }
        res.end('ok'); // respondemos rápido y corremos en background
        try {
          await sendLegoNow();
        } catch (e) {
          console.error('❌ Error en trigger:', e?.stack || e);
        }
        return;
      }
      res.statusCode = 200;
      res.end('ok');
    } catch (e) {
      res.statusCode = 500;
      res.end('error');
    }
  });

  server.listen(PORT, () =>
    console.log(`🌐 HTTP trigger escuchando en :${PORT} — GET /lego/send?token=***`)
  );
}
    
// Cabecera
await bot.telegram.sendMessage(
  CHAT_ID,
  `🧱 LEGO con ≥${MIN_DISCOUNT}% OFF — Top ${deals.length} de ${filtradas.length}`
);

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Cada item: foto + caption limpia + botón
    for (const d of deals) {
      const shortUrl = shortMeliUrl(d.url);
      const img = await getMeliImageFromUrl(d.url);   // <-- ORIGINAL, no el short
      const badge = discountBadge(d.pct);
      const link = affiliateLink(shortUrl);

      // Log opcional si no se consigue imagen
      if (!img) console.log('⚠️ sin imagen:', d.title, shortUrl);

      // Caption sin markdown (evita errores con caracteres)
      const caption = [
        `🧱 ${d.title}`,
        `${badge} ${d.price} • -${d.pct}%`
      ].join('\n').slice(0, 900); // margen (<1024)

      const extra = {
        disable_web_page_preview: false,
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Ver en Mercado Libre', url: link }]
          ]
        }
      };

      try {
        if (img) {
          await bot.telegram.sendPhoto(CHAT_ID, img, { caption, ...extra });
        } else {
          await bot.telegram.sendMessage(CHAT_ID, caption + `\n${link}`, extra);
        }
      } catch (e) {
        console.error('⚠️ Error enviando item:', d.title, e?.message || e);
      }

      await sleep(700); // evita rate limits
    }

    console.log(`✅ Enviadas ${deals.length} promos LEGO con imagen/botón`);
  } catch (err) {
    console.error('❌ Error en sendLegoNow:', err?.stack || err);
  }
}


// ————————————————————————————————
// Modo CLI vs HTTP trigger (inline)
// ————————————————————————————————
const mode = process.argv[2];

if (mode === 'send') {
  await sendLegoNow();
  process.exit(0);
} else if (process.env.ENABLE_HTTP_TRIGGER === '1') {
  const http = await import('http');
  const PORT  = process.env.PORT || 3000;
  const TOKEN = process.env.HTTP_TRIGGER_TOKEN || '';

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && u.pathname === '/lego/send') {
        if (!TOKEN || u.searchParams.get('token') !== TOKEN) {
          res.statusCode = 401;
          res.end('unauthorized');
          return;
        }
        res.end('ok'); // respondemos rápido
        try {
          await sendLegoNow();
        } catch (e) {
          console.error('❌ Error en trigger:', e?.stack || e);
        }
        return;
      }
      res.statusCode = 200;
      res.end('ok');
    } catch (e) {
      res.statusCode = 500;
      res.end('error');
    }
  });

  server.listen(PORT, () =>
    console.log(`🌐 HTTP trigger escuchando en :${PORT} — GET /lego/send?token=***`)
  );
} else {
  console.log('ℹ️ Sin HTTP trigger. Saliendo.');
  process.exit(0);
}


// Apagado limpio
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
